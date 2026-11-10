"""Acoustic inputs for pause detection: energy silences and Silero speech segments.

    from src.audio.pause_detection import detect_pauses
    acoustic = detect_pauses("prepared.wav")
    score_transcribe_items(transcribe_items, acoustic=acoustic)

In the AWS pipeline the audio-prep step runs ``pause_inputs`` on the transcription audio and
stores the result as ``pause_inputs`` in its report; the processor passes it to the rubric.

Energy: 30 ms frame loudness (dB) compared with a per-recording threshold placed 30% of the way
from the noise floor (10th percentile) to typical speech loudness (90th percentile); quiet runs of
0.25 s or more are kept (the scorer then applies the 0.3 s rubric floor).
Silero: silero-vad (threshold 0.5, 100 ms minimum silence, no padding) on 16 kHz mono. It is
optional: install requirements-pauses.txt. Without it, ``silero_speech`` is None and the scorer
uses energy only.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

FRAME_SECONDS = 0.03
MIN_SILENCE_SECONDS = 0.25
THRESHOLD_FRACTION = 0.3
SILERO_RATE = 16_000


def _mono(path: str | Path) -> tuple[np.ndarray, int]:
    audio, rate = sf.read(str(path), dtype="float32", always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    return audio, rate


def energy_silences(audio: np.ndarray, rate: int, fraction: float = THRESHOLD_FRACTION) -> list[tuple[float, float]]:
    size = int(FRAME_SECONDS * rate)
    if size <= 0 or len(audio) < size:
        return []
    frames = audio[: len(audio) // size * size].reshape(-1, size)
    # One float32 value per 30 ms frame; no full-length float64 copy of the waveform.
    loudness = 20 * np.log10(np.sqrt(np.einsum("ij,ij->i", frames, frames, dtype="float32") / size) + 1e-9)
    floor, speech = np.percentile(loudness, 10), np.percentile(loudness, 90)
    quiet = loudness < floor + fraction * (speech - floor)
    out, start = [], None
    for index, is_quiet in enumerate(np.append(quiet, False)):
        if is_quiet and start is None:
            start = index
        elif not is_quiet and start is not None:
            if (index - start) * FRAME_SECONDS >= MIN_SILENCE_SECONDS:
                out.append((round(start * FRAME_SECONDS, 3), round(index * FRAME_SECONDS, 3)))
            start = None
    return out


@lru_cache(maxsize=1)
def _silero_model() -> Any:
    """Load Silero once per process so warm Lambda invocations reuse it."""

    from silero_vad import load_silero_vad

    return load_silero_vad()


def silero_speech(audio: np.ndarray, rate: int) -> list[tuple[float, float]] | None:
    """Speech segments from Silero VAD, or None when silero-vad is not installed."""

    try:
        import torch
        from silero_vad import get_speech_timestamps
    except ImportError:
        return None
    if rate != SILERO_RATE:
        audio = resample_poly(audio, SILERO_RATE, rate).astype("float32")
    model = _silero_model()
    stamps = get_speech_timestamps(torch.from_numpy(np.ascontiguousarray(audio)), model,
                                   sampling_rate=SILERO_RATE, threshold=0.5,
                                   min_silence_duration_ms=100, speech_pad_ms=0, return_seconds=True)
    return [(float(item["start"]), float(item["end"])) for item in stamps]


def pause_inputs(audio: np.ndarray, rate: int) -> dict[str, Any]:
    """Acoustic pause inputs for ``score_transcribe_items(items, acoustic=...)`` from mono audio."""

    audio = np.asarray(audio, dtype="float32")
    return {"energy_silences": energy_silences(audio, rate),
            "silero_speech": silero_speech(audio, rate),
            "duration_seconds": round(len(audio) / rate, 3)}


def detect_pauses(path: str | Path) -> dict[str, Any]:
    """Same as ``pause_inputs`` for an audio file."""

    return pause_inputs(*_mono(path))
