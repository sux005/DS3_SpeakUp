"""Audio decoding and output helpers."""

from __future__ import annotations

from pathlib import Path
import shutil
import subprocess

import numpy as np
import soundfile as sf


class AudioDecodeError(ValueError):
    """Raised when an uploaded file cannot be decoded safely."""


def _decode_with_pyav(source: Path) -> tuple[np.ndarray, int] | None:
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
            frames: list[np.ndarray] = []
            resampler = None
            for frame in container.decode(stream):
                if resampler is None:
                    resampler = av.AudioResampler(
                        format="fltp",
                        layout=frame.layout.name,
                        rate=sample_rate,
                    )
                for converted in resampler.resample(frame):
                    frames.append(converted.to_ndarray().astype(np.float32))
            if resampler is not None:
                for converted in resampler.resample(None):
                    frames.append(converted.to_ndarray().astype(np.float32))
            if not frames:
                raise AudioDecodeError("Uploaded file contains no decodable audio")
            return np.concatenate(frames, axis=1).T, sample_rate
    except AudioDecodeError:
        raise
    except (OSError, ValueError, av.error.FFmpegError):
        return None


def decode_audio(path: str | Path) -> tuple[np.ndarray, int]:
    """Decode with libsndfile, falling back to FFmpeg for M4A and other codecs."""

    source = Path(path)
    try:
        audio, sample_rate = sf.read(source, dtype="float32", always_2d=True)
        return np.asarray(audio, dtype=np.float32), int(sample_rate)
    except (RuntimeError, sf.LibsndfileError) as soundfile_error:
        pyav_result = _decode_with_pyav(source)
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
            "-y",
            "-i",
            str(source),
            "-vn",
            "-acodec",
            "pcm_f32le",
            str(decoded),
        ]
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
        if completed.returncode != 0:
            raise AudioDecodeError("FFmpeg could not decode the uploaded audio") from soundfile_error
        try:
            audio, sample_rate = sf.read(decoded, dtype="float32", always_2d=True)
            return np.asarray(audio, dtype=np.float32), int(sample_rate)
        finally:
            decoded.unlink(missing_ok=True)


def write_pcm16(path: str | Path, y: np.ndarray, sample_rate: int) -> None:
    """Write a mono PCM WAV suitable for transcription and diagnostics."""

    sf.write(Path(path), y, sample_rate, subtype="PCM_16", format="WAV")
