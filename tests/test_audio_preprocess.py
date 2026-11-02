"""Tests for the deterministic dual-path audio preparation pipeline."""

from __future__ import annotations

import json

import numpy as np
import pytest
import soundfile as sf

from src.audio.config import AudioPrepConfig
from src.audio.preprocess import prepare_audio, process_audio_file


def speech_like_signal(sample_rate: int = 16_000, seconds: float = 3.0) -> np.ndarray:
    """Create deterministic voiced bursts with pauses for signal-processing tests."""

    samples = int(sample_rate * seconds)
    time = np.arange(samples, dtype=np.float64) / sample_rate
    fundamental = 135.0 + 12.0 * np.sin(2.0 * np.pi * 0.7 * time)
    phase = 2.0 * np.pi * np.cumsum(fundamental) / sample_rate
    voiced = np.zeros(samples, dtype=np.float64)
    for harmonic in range(1, 9):
        voiced += np.sin(harmonic * phase) / harmonic
    envelope = np.zeros(samples, dtype=np.float64)
    for start, end in ((0.15, 0.8), (1.0, 1.75), (2.0, 2.85)):
        begin = int(start * sample_rate)
        finish = min(samples, int(end * sample_rate))
        if finish <= begin:
            continue
        window = np.hanning(finish - begin)
        envelope[begin:finish] = window
    return (0.22 * voiced * envelope).astype(np.float32)


def degraded_signal(sample_rate: int = 16_000) -> np.ndarray:
    """Add stationary noise, mains hum, and a small echo to the test voice."""

    clean = speech_like_signal(sample_rate)
    delayed = np.zeros_like(clean)
    delay = int(0.08 * sample_rate)
    delayed[delay:] = clean[:-delay] * 0.22
    random = np.random.default_rng(7)
    noise = random.normal(0.0, 0.025, len(clean))
    time = np.arange(len(clean)) / sample_rate
    hum = 0.018 * np.sin(2.0 * np.pi * 60.0 * time)
    return np.clip(clean + delayed + noise + hum, -0.95, 0.95).astype(np.float32)


def test_prepare_audio_preserves_timeline_and_generates_report() -> None:
    source = degraded_signal()
    prepared = prepare_audio(
        source,
        16_000,
        AudioPrepConfig(enhancement_backend="none"),
    )

    assert prepared.sample_rate == 16_000
    assert len(prepared.reference) == len(source)
    assert len(prepared.enhanced) == len(source)
    assert np.all(np.isfinite(prepared.enhanced))
    assert np.max(np.abs(prepared.enhanced)) <= 10 ** (-3.0 / 20.0) + 1e-5
    assert prepared.report["output"]["timeline_preserved"] is True
    assert prepared.report["output"]["dereverberation_applied"] is False
    assert prepared.report["output"]["selected_for_transcription"] in {
        "reference",
        "enhanced_model",
        "enhanced_blended",
    }
    assert prepared.report["output"]["enhancement"]["applied"] is False
    assert "candidate_comparisons" in prepared.report
    assert prepared.report["config_fingerprint"]


def test_prepare_audio_resamples_stereo() -> None:
    mono = speech_like_signal(sample_rate=24_000, seconds=1.5)
    stereo = np.column_stack([mono, mono * 0.8])
    prepared = prepare_audio(
        stereo,
        24_000,
        AudioPrepConfig(enhancement_backend="none"),
    )

    assert prepared.reference.ndim == 1
    assert prepared.sample_rate == 16_000
    assert abs(len(prepared.reference) - 24_000) <= 1


def test_duration_limit_is_enforced() -> None:
    config = AudioPrepConfig(max_duration_seconds=0.1)
    with pytest.raises(ValueError, match="exceeds"):
        prepare_audio(np.zeros(3_200, dtype=np.float32), 16_000, config)


def test_process_audio_file_writes_reproducible_artifacts(tmp_path) -> None:
    source_path = tmp_path / "source.wav"
    output_path = tmp_path / "prepared"
    sf.write(source_path, degraded_signal(), 16_000, subtype="PCM_16")

    artifacts = process_audio_file(
        source_path,
        output_path,
        AudioPrepConfig(enhancement_backend="none"),
        source_metadata={"fixture": "degraded-speech"},
    )

    assert all(path.exists() for path in artifacts.values())
    report = json.loads(artifacts["report"].read_text(encoding="utf-8"))
    assert report["source"]["fixture"] == "degraded-speech"
    assert artifacts["transcription"] in {
        artifacts["diagnostic"],
    }
    assert artifacts["enhanced_model"].exists()
    assert artifacts["enhanced_blended"].exists()


def test_continuous_speech_falls_back_without_an_enhancer() -> None:
    sample_rate = 16_000
    time = np.arange(sample_rate * 2, dtype=np.float64) / sample_rate
    continuous = (
        0.12 * np.sin(2.0 * np.pi * 145.0 * time)
        + 0.04 * np.sin(2.0 * np.pi * 1_100.0 * time)
    ).astype(np.float32)
    prepared = prepare_audio(
        continuous,
        sample_rate,
        AudioPrepConfig(enhancement_backend="none"),
    )

    assert prepared.report["output"]["selected_for_transcription"] == "reference"
    assert np.corrcoef(prepared.reference, prepared.diagnostic)[0, 1] > 0.999
