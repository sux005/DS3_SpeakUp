"""Browser recording containers must reach the shared audio decoder."""

import math
from pathlib import Path
import shutil
import struct
import subprocess
import wave

import pytest

from src.audio.io import decode_audio
from src.audio import io as audio_io


@pytest.mark.parametrize("extension", ("webm", "ogg"))
def test_opus_recording_container_decodes_for_audio_preparation(tmp_path: Path, extension: str, monkeypatch):
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        pytest.skip("FFmpeg is required by the audio-prep runtime")

    source = tmp_path / "source.wav"
    sample_rate = 16_000
    samples = [
        int(0.25 * 32767 * math.sin(2 * math.pi * 440 * index / sample_rate))
        for index in range(sample_rate // 4)
    ]
    with wave.open(str(source), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(struct.pack(f"<{len(samples)}h", *samples))

    recorded = tmp_path / f"recorded.{extension}"
    subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(source),
         "-c:a", "libopus", "-y", str(recorded)],
        check=True,
        capture_output=True,
    )
    audio, decoded_rate = decode_audio(recorded)
    assert decoded_rate > 0
    assert audio.ndim == 2 and audio.shape[1] == 1
    assert audio.shape[0] > 0
    monkeypatch.setattr(audio_io, "_decode_with_pyav", lambda *args, **kwargs: None)
    fallback_audio, fallback_rate = decode_audio(recorded)
    assert fallback_rate == decoded_rate
    assert fallback_audio.shape[0] > 0
