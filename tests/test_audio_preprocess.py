"""Tests for the model-driven dual-path audio preparation pipeline."""

from __future__ import annotations

import json
from pathlib import Path
import sys

import numpy as np
import pytest
import soundfile as sf

from src.audio.config import AudioPrepConfig
from src.audio.enhancement import EnhancementResult, _match_timeline, enhance_speech
from src.audio.filters import blend_with_original
from src.audio.io import AudioDecodeError, _run_ffmpeg_bounded, decode_audio
from src.audio.preprocess import _candidate_passes, prepare_audio, process_audio_file


def test_ffmpeg_stream_is_stopped_before_filling_disk(tmp_path):
    output = tmp_path / "decoded.wav"
    command = [
        sys.executable, "-c",
        "import sys; sys.stdout.buffer.write(b'x' * 20000)",
    ]
    with pytest.raises(AudioDecodeError, match="memory limit"):
        _run_ffmpeg_bounded(command, output, max_bytes=1024)
    assert output.stat().st_size <= 1024 + 4096


def test_artifact_version_includes_deployment_build_digest(monkeypatch):
    config = AudioPrepConfig()
    monkeypatch.setenv("AUDIO_BUILD_DIGEST", "sha256:abc123/unsafe")
    import hashlib
    expected = hashlib.sha256(b"sha256:abc123/unsafe").hexdigest()[:24]
    assert config.artifact_version() == f"{config.pipeline_version}-{expected}"


def test_artifact_version_keeps_local_compatibility_without_digest(monkeypatch):
    config = AudioPrepConfig()
    monkeypatch.delenv("AUDIO_BUILD_DIGEST", raising=False)
    assert config.artifact_version() == config.pipeline_version


def test_v2_environment_controls_are_loaded(monkeypatch) -> None:
    monkeypatch.setenv("AUDIO_ENHANCEMENT_MODEL", "fixture-model")
    monkeypatch.setenv("AUDIO_ENHANCEMENT_ATTENUATION_LIMIT_DB", "9.5")
    monkeypatch.setenv("AUDIO_ENHANCEMENT_POST_FILTER", "true")
    monkeypatch.setenv("AUDIO_ORIGINAL_BLEND_FRACTION", "0.8")

    config = AudioPrepConfig.from_environment()

    assert config.target_sample_rate == 48_000
    assert config.enhancement_model == "fixture-model"
    assert config.enhancement_attenuation_limit_db == 9.5
    assert config.enhancement_post_filter is True
    assert config.original_blend_fraction == 0.8


def test_model_timeline_matching_pads_truncates_and_rejects_non_finite() -> None:
    assert np.array_equal(
        _match_timeline(np.array([0.25], dtype=np.float32), 3),
        np.array([0.25, 0.0, 0.0], dtype=np.float32),
    )
    assert np.array_equal(
        _match_timeline(np.array([0.1, 0.2, 0.3], dtype=np.float32), 2),
        np.array([0.1, 0.2], dtype=np.float32),
    )
    with pytest.raises(RuntimeError, match="non-finite"):
        _match_timeline(np.array([np.nan], dtype=np.float32), 1)


def test_disabled_enhancer_returns_an_unmodified_copy() -> None:
    source = np.array([0.1, -0.2], dtype=np.float32)
    result = enhance_speech(
        source, 48_000, AudioPrepConfig(enhancement_backend="none")
    )

    assert np.array_equal(result.audio, source)
    assert result.audio is not source
    assert result.report["applied"] is False


def test_default_blend_is_conservative_toward_the_original() -> None:
    config = AudioPrepConfig()
    original = np.array([1.0, -1.0], dtype=np.float32)
    model = np.zeros(2, dtype=np.float32)

    blended = blend_with_original(original, model, config.original_blend_fraction)

    assert config.original_blend_fraction == 0.75
    assert np.allclose(blended, original * 0.75)


def test_gate_does_not_treat_removed_background_noise_as_removed_speech() -> None:
    config = AudioPrepConfig()
    candidate = np.zeros(100, dtype=np.float32)
    reference_quality = {
        "clipping_fraction": 0.0,
        "estimated_snr_db": 5.0,
        "non_silent_fraction": 1.0,
        "reverberation_tail_proxy": 0.1,
    }
    candidate_quality = {
        "clipping_fraction": 0.0,
        "estimated_snr_db": 20.0,
        "non_silent_fraction": 0.4,
        "reverberation_tail_proxy": 0.3,
    }
    comparison = {
        "waveform_correlation": 0.98,
        "si_sdr_db": 15.0,
        "spectral_gain_variability_db": 2.0,
        "speech_frame_retention_fraction": 0.98,
    }

    passed, failures = _candidate_passes(
        candidate,
        reference_quality,
        candidate_quality,
        comparison,
        config,
    )

    assert passed is True
    assert failures == []


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

    assert prepared.sample_rate == 48_000
    assert abs(len(prepared.reference) - len(source) * 3) <= 1
    assert abs(len(prepared.enhanced) - len(source) * 3) <= 1
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


def test_v2_selects_a_safe_model_candidate_before_the_dry_blend() -> None:
    source = degraded_signal()

    def learned_enhancer(audio, sample_rate, config):
        assert sample_rate == 16_000
        assert config.enhancement_backend == "deepfilternet"
        return EnhancementResult(
            audio=audio * np.float32(0.9),
            report={
                "backend": "deepfilternet",
                "model": "fixture-model",
                "available": True,
                "applied": True,
            },
        )

    prepared = prepare_audio(
        source,
        16_000,
        AudioPrepConfig(),
        enhancer=learned_enhancer,
    )

    assert prepared.report["pipeline_version"] == "2.0.0"
    assert prepared.report["output"]["handcrafted_denoising_applied"] is False
    assert prepared.report["output"]["selected_for_transcription"] == "enhanced_model"
    assert prepared.report["output"]["selection_reason"] == "model_passed_distortion_gate"
    assert prepared.report["output"]["enhancement"]["model"] == "fixture-model"
    assert np.array_equal(prepared.diagnostic, prepared.enhanced_model)


def test_v2_passes_full_band_audio_to_the_model_without_fixed_denoising() -> None:
    source = degraded_signal()
    observed = {}

    def observe_model_input(audio, sample_rate, config):
        observed["audio"] = audio.copy()
        return EnhancementResult(
            audio=audio.copy(),
            report={"backend": "fixture", "available": True, "applied": True},
        )

    prepare_audio(source, 16_000, AudioPrepConfig(), enhancer=observe_model_input)

    expected = source - float(np.mean(source))
    assert np.allclose(observed["audio"], expected, atol=1e-7)


def test_prepare_audio_resamples_stereo() -> None:
    mono = speech_like_signal(sample_rate=24_000, seconds=1.5)
    stereo = np.column_stack([mono, mono * 0.8])
    prepared = prepare_audio(
        stereo,
        24_000,
        AudioPrepConfig(enhancement_backend="none"),
    )

    assert prepared.reference.ndim == 1
    assert prepared.sample_rate == 48_000
    assert abs(len(prepared.reference) - 72_000) <= 1


def test_duration_limit_is_enforced() -> None:
    config = AudioPrepConfig(max_duration_seconds=0.1)
    with pytest.raises(ValueError, match="exceeds"):
        prepare_audio(np.zeros(3_200, dtype=np.float32), 16_000, config)


def test_decode_rejects_expanded_audio_before_reading_all_samples(tmp_path) -> None:
    """Container metadata is checked before a large decoded array is allocated."""

    source_path = tmp_path / "long.wav"
    sf.write(source_path, np.zeros(16_000 * 2, dtype=np.float32), 16_000)

    with pytest.raises(AudioDecodeError, match="duration limit"):
        decode_audio(source_path, max_duration_seconds=0.1)


def test_decode_rejects_channel_expansion(tmp_path) -> None:
    source_path = tmp_path / "many-channels.wav"
    sf.write(source_path, np.zeros((100, 2), dtype=np.float32), 16_000)

    with pytest.raises(AudioDecodeError, match="channels"):
        decode_audio(source_path, max_channels=1)


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
    assert artifacts["enhanced"].name == "enhanced.wav"
    assert artifacts["enhanced"].stat().st_ino == artifacts["diagnostic"].stat().st_ino


def test_process_audio_file_does_not_encode_legacy_enhanced_alias_twice(
    tmp_path, monkeypatch
) -> None:
    source_path = tmp_path / "source.wav"
    output_path = tmp_path / "prepared"
    sf.write(source_path, degraded_signal(), 16_000, subtype="PCM_16")
    calls = []

    from src.audio import preprocess

    original_write = preprocess.write_pcm16

    def record_write(path, audio, sample_rate):
        calls.append(Path(path).name)
        return original_write(path, audio, sample_rate)

    monkeypatch.setattr(preprocess, "write_pcm16", record_write)
    artifacts = process_audio_file(
        source_path,
        output_path,
        AudioPrepConfig(enhancement_backend="none"),
    )

    assert calls.count("diagnostic.wav") == 1
    assert "enhanced.wav" not in calls
    assert artifacts["enhanced"].name == "enhanced.wav"
    assert artifacts["enhanced"].stat().st_ino == artifacts["diagnostic"].stat().st_ino


def test_process_audio_file_replaces_legacy_alias_on_rerun(tmp_path) -> None:
    source_path = tmp_path / "source.wav"
    output_path = tmp_path / "prepared"
    sf.write(source_path, degraded_signal(), 16_000, subtype="PCM_16")
    config = AudioPrepConfig(enhancement_backend="none")

    first = process_audio_file(source_path, output_path, config)
    first_bytes = first["enhanced"].read_bytes()
    second = process_audio_file(source_path, output_path, config)

    assert second["enhanced"].read_bytes() == first_bytes
    assert second["enhanced"].stat().st_ino == second["diagnostic"].stat().st_ino


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
