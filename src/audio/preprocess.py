"""Dual-path librosa preprocessing for diagnostics and transcription."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import sys
from typing import Any

import librosa
import numpy as np

from src.audio.config import AudioPrepConfig
from src.audio.filters import (
    blend_with_original,
    detect_hum_frequency,
    highpass,
    normalize_speech_level,
    presence_equalize,
    remove_hum,
    rnnoise_enhance,
)
from src.audio.io import decode_audio, write_pcm16
from src.audio.quality import compare_candidate, measure_quality, quality_warnings


@dataclass(frozen=True)
class PreparedAudio:
    """Prepared waveforms plus the reproducibility and quality report."""

    reference: np.ndarray
    enhanced_model: np.ndarray
    enhanced_blended: np.ndarray
    diagnostic: np.ndarray
    sample_rate: int
    report: dict[str, Any]

    @property
    def enhanced(self) -> np.ndarray:
        """Return the conservative enhanced candidate for legacy callers."""

        return self.enhanced_blended

    @property
    def transcription(self) -> np.ndarray:
        """Return the candidate selected by the distortion-aware gate."""

        return self.diagnostic


def _mono(audio: np.ndarray) -> np.ndarray:
    if audio.ndim == 1:
        return audio.astype(np.float32)
    return np.mean(audio, axis=1, dtype=np.float64).astype(np.float32)


def _validate(
    audio: np.ndarray, sample_rate: int, config: AudioPrepConfig
) -> None:
    if sample_rate <= 0:
        raise ValueError("Sample rate must be positive")
    if audio.ndim not in (1, 2):
        raise ValueError("Audio must be mono or multichannel")
    channels = 1 if audio.ndim == 1 else audio.shape[1]
    if channels < 1 or channels > config.max_channels:
        raise ValueError(f"Audio has unsupported channel count: {channels}")
    if not audio.shape[0]:
        raise ValueError("Audio contains no samples")
    duration = audio.shape[0] / sample_rate
    if duration > config.max_duration_seconds:
        raise ValueError(
            f"Audio duration {duration:.1f}s exceeds the "
            f"{config.max_duration_seconds:.1f}s limit"
        )
    if not np.all(np.isfinite(audio)):
        raise ValueError("Audio contains non-finite samples")


def _resample_to_target(
    y: np.ndarray, sample_rate: int, config: AudioPrepConfig
) -> np.ndarray:
    if sample_rate == config.target_sample_rate:
        return y.astype(np.float32, copy=True)
    return librosa.resample(
        y,
        orig_sr=sample_rate,
        target_sr=config.target_sample_rate,
        res_type="soxr_hq",
        fix=True,
        scale=False,
    ).astype(np.float32)


def _candidate_passes(
    candidate: np.ndarray,
    reference_quality: dict[str, float],
    candidate_quality: dict[str, float],
    comparison: dict[str, float],
    config: AudioPrepConfig,
) -> tuple[bool, list[str]]:
    failures: list[str] = []
    if not np.all(np.isfinite(candidate)):
        failures.append("NON_FINITE_AUDIO")
    if candidate_quality["clipping_fraction"] > config.clipping_warning_fraction:
        failures.append("CLIPPING_REGRESSION")
    if (
        candidate_quality["estimated_snr_db"]
        < reference_quality["estimated_snr_db"]
        - config.maximum_allowed_snr_regression_db
    ):
        failures.append("SNR_REGRESSION")
    if (
        candidate_quality["non_silent_fraction"]
        < reference_quality["non_silent_fraction"] * 0.5
    ):
        failures.append("SPEECH_REMOVAL")
    if (
        candidate_quality["reverberation_tail_proxy"]
        > reference_quality["reverberation_tail_proxy"]
        + config.maximum_reverb_proxy_increase
    ):
        failures.append("REVERBERATION_PROXY_REGRESSION")
    if comparison["waveform_correlation"] < config.minimum_candidate_correlation:
        failures.append("LOW_WAVEFORM_CORRELATION")
    if comparison["si_sdr_db"] < config.minimum_candidate_si_sdr_db:
        failures.append("LOW_SI_SDR")
    if (
        comparison["spectral_gain_variability_db"]
        > config.maximum_spectral_gain_variability_db
    ):
        failures.append("TIME_VARYING_SPECTRAL_ARTIFACT")
    return not failures, failures


def prepare_audio(
    audio: np.ndarray,
    sample_rate: int,
    config: AudioPrepConfig | None = None,
    source_metadata: dict[str, Any] | None = None,
) -> PreparedAudio:
    """Create a diagnostic reference and a conservatively enhanced ASR signal."""

    config = config or AudioPrepConfig()
    audio = np.asarray(audio, dtype=np.float32)
    _validate(audio, sample_rate, config)

    mono = _mono(audio)
    mono = mono - float(np.mean(mono))
    canonical = _resample_to_target(mono, sample_rate, config)

    detected_hum = detect_hum_frequency(mono, sample_rate, config)
    fullband_reference = highpass(mono, sample_rate, config)
    fullband_reference = remove_hum(
        fullband_reference, sample_rate, detected_hum, config
    )
    enhancement_warning: str | None = None
    try:
        fullband_model, model_report = rnnoise_enhance(
            fullband_reference, sample_rate, config
        )
    except RuntimeError as error:
        fullband_model = fullband_reference.copy()
        model_report = {
            "backend": config.enhancement_backend,
            "available": False,
            "applied": False,
            "error": str(error),
        }
        enhancement_warning = "ENHANCER_UNAVAILABLE"
    fullband_blended = blend_with_original(
        fullband_reference,
        fullband_model,
        config.original_blend_fraction,
    )

    reference = normalize_speech_level(
        _resample_to_target(fullband_reference, sample_rate, config), config
    )
    enhanced_model = _resample_to_target(fullband_model, sample_rate, config)
    enhanced_model = presence_equalize(
        enhanced_model, config.target_sample_rate, config
    )
    enhanced_model = normalize_speech_level(enhanced_model, config)
    enhanced_blended = _resample_to_target(
        fullband_blended, sample_rate, config
    )
    enhanced_blended = presence_equalize(
        enhanced_blended, config.target_sample_rate, config
    )
    enhanced_blended = normalize_speech_level(enhanced_blended, config)

    before = measure_quality(canonical, config.target_sample_rate, config)
    reference_quality = measure_quality(reference, config.target_sample_rate, config)
    model_quality = measure_quality(
        enhanced_model, config.target_sample_rate, config
    )
    blended_quality = measure_quality(
        enhanced_blended, config.target_sample_rate, config
    )
    model_comparison = compare_candidate(reference, enhanced_model, config)
    blended_comparison = compare_candidate(reference, enhanced_blended, config)
    model_safe, model_failures = _candidate_passes(
        enhanced_model,
        reference_quality,
        model_quality,
        model_comparison,
        config,
    )
    blended_safe, blended_failures = _candidate_passes(
        enhanced_blended,
        reference_quality,
        blended_quality,
        blended_comparison,
        config,
    )
    if blended_safe and model_report.get("applied"):
        diagnostic = enhanced_blended
        selection = "enhanced_blended"
        reason = "conservative_blend_passed_distortion_gate"
    elif model_safe and model_report.get("applied"):
        diagnostic = enhanced_model
        selection = "enhanced_model"
        reason = "model_passed_distortion_gate"
    else:
        diagnostic = reference
        selection = "reference"
        reason = "enhancement_failed_distortion_gate"

    report: dict[str, Any] = {
        "pipeline_version": config.pipeline_version,
        "config_fingerprint": config.fingerprint(),
        "config": config.as_dict(),
        "source": {
            "sample_rate": sample_rate,
            "channels": 1 if audio.ndim == 1 else audio.shape[1],
            "samples": int(audio.shape[0]),
            **(source_metadata or {}),
        },
        "output": {
            "sample_rate": config.target_sample_rate,
            "samples": int(len(reference)),
            "timeline_preserved": True,
            "detected_hum_hz": detected_hum,
            "selected_for_transcription": selection,
            "selection_reason": reason,
            "enhancement": model_report,
            "dereverberation_applied": False,
            "dereverberation_note": (
                "Noise suppression is intentionally separate from dereverberation; "
                "room reflections are preserved unless a future dereverb stage passes "
                "its own distortion gate."
            ),
        },
        "quality": {
            "canonical": before,
            "reference": reference_quality,
            "enhanced_model": model_quality,
            "enhanced_blended": blended_quality,
        },
        "candidate_comparisons": {
            "enhanced_model": {
                **model_comparison,
                "passed": model_safe,
                "failures": model_failures,
            },
            "enhanced_blended": {
                **blended_comparison,
                "passed": blended_safe,
                "failures": blended_failures,
            },
        },
        "warnings": [
            *quality_warnings(before, config),
            *([enhancement_warning] if enhancement_warning else []),
        ],
    }
    return PreparedAudio(
        reference=reference,
        enhanced_model=enhanced_model,
        enhanced_blended=enhanced_blended,
        diagnostic=diagnostic,
        sample_rate=config.target_sample_rate,
        report=report,
    )


def process_audio_file(
    input_path: str | Path,
    output_directory: str | Path,
    config: AudioPrepConfig | None = None,
    source_metadata: dict[str, Any] | None = None,
) -> dict[str, Path]:
    """Decode one file, run the dual-path pipeline, and write versioned artifacts."""

    input_path = Path(input_path)
    output_directory = Path(output_directory)
    output_directory.mkdir(parents=True, exist_ok=True)
    audio, sample_rate = decode_audio(input_path)
    prepared = prepare_audio(audio, sample_rate, config, source_metadata)

    reference_path = output_directory / "reference.wav"
    model_path = output_directory / "enhanced_model.wav"
    blended_path = output_directory / "enhanced_blended.wav"
    diagnostic_path = output_directory / "diagnostic.wav"
    enhanced_path = output_directory / "enhanced.wav"
    report_path = output_directory / "report.json"
    write_pcm16(reference_path, prepared.reference, prepared.sample_rate)
    write_pcm16(model_path, prepared.enhanced_model, prepared.sample_rate)
    write_pcm16(blended_path, prepared.enhanced_blended, prepared.sample_rate)
    write_pcm16(diagnostic_path, prepared.diagnostic, prepared.sample_rate)
    write_pcm16(enhanced_path, prepared.diagnostic, prepared.sample_rate)
    report_path.write_text(
        json.dumps(prepared.report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return {
        "reference": reference_path,
        "enhanced_model": model_path,
        "enhanced_blended": blended_path,
        "diagnostic": diagnostic_path,
        "enhanced": enhanced_path,
        "transcription": diagnostic_path,
        "report": report_path,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output_directory", type=Path)
    parser.add_argument("--source-bucket")
    parser.add_argument("--source-key")
    parser.add_argument("--source-etag")
    args = parser.parse_args()
    source_metadata = {
        name: value
        for name, value in {
            "s3_bucket": args.source_bucket,
            "s3_key": args.source_key,
            "etag": args.source_etag,
        }.items()
        if value is not None
    }
    try:
        outputs = process_audio_file(
            args.input,
            args.output_directory,
            source_metadata=source_metadata,
        )
    except (OSError, ValueError) as error:
        print(f"Audio preparation failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps({name: str(path) for name, path in outputs.items()}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
