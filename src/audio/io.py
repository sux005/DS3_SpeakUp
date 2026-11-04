"""Audio decoding and output helpers."""

from __future__ import annotations

from pathlib import Path
import shutil
import subprocess
import tempfile
import threading

import numpy as np
import soundfile as sf


class AudioDecodeError(ValueError):
    """Raised when an uploaded file cannot be decoded safely."""


DEFAULT_MAX_DURATION_SECONDS = 600.0
DEFAULT_MAX_CHANNELS = 8
DEFAULT_MAX_DECODED_BYTES = 268_435_456
FFMPEG_TIMEOUT_SECONDS = 120


def _run_ffmpeg_bounded(command: list[str], destination: Path, max_bytes: int) -> None:
    """Stream decoded output to disk with a hard byte and wall-time limit."""

    process = subprocess.Popen(
        command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
    )
    total = 0
    stream_errors: list[Exception] = []

    def copy_output() -> None:
        nonlocal total
        try:
            assert process.stdout is not None
            with destination.open("wb") as output:
                while chunk := process.stdout.read(1024 * 1024):
                    total += len(chunk)
                    if total > max_bytes + 4096:
                        raise AudioDecodeError("Decoded audio exceeds the memory limit")
                    output.write(chunk)
        except Exception as error:
            stream_errors.append(error)

    reader = threading.Thread(target=copy_output, name="ffmpeg-output", daemon=True)
    try:
        reader.start()
        reader.join(FFMPEG_TIMEOUT_SECONDS)
        if reader.is_alive():
            raise AudioDecodeError("FFmpeg decoding timed out")
        if stream_errors:
            raise stream_errors[0]
        if process.wait(timeout=1.0) != 0:
            raise AudioDecodeError("FFmpeg could not decode the uploaded audio")
    except subprocess.TimeoutExpired as error:
        raise AudioDecodeError("FFmpeg decoding timed out") from error
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        if reader.is_alive():
            reader.join(timeout=1.0)
        if process.stdout is not None:
            process.stdout.close()


def _check_stream_bounds(
    frames: int,
    sample_rate: int,
    channels: int,
    *,
    max_duration_seconds: float,
    max_channels: int,
    max_decoded_bytes: int,
) -> None:
    """Reject streams whose decoded shape would exceed resource limits."""

    if sample_rate <= 0 or channels < 1:
        raise AudioDecodeError("Uploaded file has invalid audio metadata")
    if channels > max_channels:
        raise AudioDecodeError("Uploaded file has too many audio channels")
    if frames > int(max_duration_seconds * sample_rate):
        raise AudioDecodeError("Uploaded audio exceeds the duration limit")
    if frames * channels * np.dtype(np.float32).itemsize > max_decoded_bytes:
        raise AudioDecodeError("Decoded audio exceeds the memory limit")


def _decode_with_pyav(
    source: Path,
    *,
    max_duration_seconds: float,
    max_channels: int,
    max_decoded_bytes: int,
) -> tuple[np.ndarray, int] | None:
    """Decode compressed audio with the optional pinned PyAV runtime."""

    try:
        import av
    except ImportError:
        return None
    try:
        with av.open(str(source), mode="r") as container:
            if not container.streams.audio:
                raise AudioDecodeError("Uploaded file contains no audio stream")
            stream = container.streams.audio[0]
            sample_rate = int(stream.codec_context.sample_rate)
            channels = int(stream.codec_context.channels or 0)
            if channels > max_channels:
                raise AudioDecodeError("Uploaded file has too many audio channels")
            decoded_samples = 0
            resampler = None
            with tempfile.TemporaryDirectory() as decoded_directory:
                decoded_path = Path(decoded_directory) / "decoded.wav"
                writer = None
                try:
                    for frame in container.decode(stream):
                        if resampler is None:
                            resampler = av.AudioResampler(
                                format="fltp",
                                layout=frame.layout.name,
                                rate=sample_rate,
                            )
                        for converted in resampler.resample(frame):
                            chunk = converted.to_ndarray().astype(np.float32)
                            decoded_samples += int(chunk.shape[1])
                            _check_stream_bounds(
                                decoded_samples,
                                sample_rate,
                                int(chunk.shape[0]),
                                max_duration_seconds=max_duration_seconds,
                                max_channels=max_channels,
                                max_decoded_bytes=max_decoded_bytes,
                            )
                            if writer is None:
                                import soundfile as sf_module

                                writer = sf_module.SoundFile(
                                    decoded_path,
                                    mode="w",
                                    samplerate=sample_rate,
                                    channels=int(chunk.shape[0]),
                                    subtype="FLOAT",
                                    format="WAV",
                                )
                            writer.write(chunk.T)
                    if resampler is not None:
                        for converted in resampler.resample(None):
                            chunk = converted.to_ndarray().astype(np.float32)
                            decoded_samples += int(chunk.shape[1])
                            _check_stream_bounds(
                                decoded_samples,
                                sample_rate,
                                int(chunk.shape[0]),
                                max_duration_seconds=max_duration_seconds,
                                max_channels=max_channels,
                                max_decoded_bytes=max_decoded_bytes,
                            )
                            if writer is None:
                                import soundfile as sf_module

                                writer = sf_module.SoundFile(
                                    decoded_path,
                                    mode="w",
                                    samplerate=sample_rate,
                                    channels=int(chunk.shape[0]),
                                    subtype="FLOAT",
                                    format="WAV",
                                )
                            writer.write(chunk.T)
                finally:
                    if writer is not None:
                        writer.close()
                if decoded_samples == 0:
                    raise AudioDecodeError("Uploaded file contains no decodable audio")
                audio, decoded_rate = sf.read(
                    decoded_path, dtype="float32", always_2d=True
                )
                return np.asarray(audio, dtype=np.float32), int(decoded_rate)
    except AudioDecodeError:
        raise
    except (OSError, ValueError, av.error.FFmpegError):
        return None


def decode_audio(
    path: str | Path,
    *,
    max_duration_seconds: float = DEFAULT_MAX_DURATION_SECONDS,
    max_channels: int = DEFAULT_MAX_CHANNELS,
    max_decoded_bytes: int = DEFAULT_MAX_DECODED_BYTES,
) -> tuple[np.ndarray, int]:
    """Decode with libsndfile, falling back to FFmpeg for M4A and other codecs."""

    source = Path(path)
    try:
        try:
            info = sf.info(source)
            _check_stream_bounds(
                int(info.frames),
                int(info.samplerate),
                int(info.channels),
                max_duration_seconds=max_duration_seconds,
                max_channels=max_channels,
                max_decoded_bytes=max_decoded_bytes,
            )
        except AudioDecodeError:
            raise
        except (RuntimeError, sf.LibsndfileError):
            # Compressed formats may not expose metadata through libsndfile;
            # the PyAV/FFmpeg paths enforce bounds while decoding.
            pass
        audio, sample_rate = sf.read(source, dtype="float32", always_2d=True)
        _check_stream_bounds(
            int(audio.shape[0]),
            int(sample_rate),
            int(audio.shape[1]),
            max_duration_seconds=max_duration_seconds,
            max_channels=max_channels,
            max_decoded_bytes=max_decoded_bytes,
        )
        return np.asarray(audio, dtype=np.float32), int(sample_rate)
    except (RuntimeError, sf.LibsndfileError) as soundfile_error:
        pyav_result = _decode_with_pyav(
            source,
            max_duration_seconds=max_duration_seconds,
            max_channels=max_channels,
            max_decoded_bytes=max_decoded_bytes,
        )
        if pyav_result is not None:
            return pyav_result
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise AudioDecodeError(
                "Audio codec is unsupported and FFmpeg is unavailable"
            ) from soundfile_error
        decoded = source.with_name(source.name + ".decoded.wav")
        command = [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(source),
            "-vn",
            "-acodec",
            "pcm_f32le",
            "-f",
            "wav",
            "pipe:1",
        ]
        try:
            _run_ffmpeg_bounded(command, decoded, max_decoded_bytes)
            audio, sample_rate = sf.read(decoded, dtype="float32", always_2d=True)
            _check_stream_bounds(
                int(audio.shape[0]),
                int(sample_rate),
                int(audio.shape[1]),
                max_duration_seconds=max_duration_seconds,
                max_channels=max_channels,
                max_decoded_bytes=max_decoded_bytes,
            )
            return np.asarray(audio, dtype=np.float32), int(sample_rate)
        finally:
            decoded.unlink(missing_ok=True)


def write_pcm16(path: str | Path, y: np.ndarray, sample_rate: int) -> None:
    """Write a mono PCM WAV suitable for transcription and diagnostics."""

    sf.write(Path(path), y, sample_rate, subtype="PCM_16", format="WAV")
