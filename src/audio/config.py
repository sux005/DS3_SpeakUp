"""Versioned configuration for the SpeakUp audio preparation pipeline."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
import os


@dataclass(frozen=True)
class AudioPrepConfig:
    """Named audio-processing parameters that can be tuned as a single version."""

    pipeline_version: str = "1.1.0"
    target_sample_rate: int = 16_000
    max_duration_seconds: float = 600.0
    max_channels: int = 8
    highpass_hz: float = 70.0
    highpass_order: int = 4
    hum_candidates_hz: tuple[float, ...] = (50.0, 60.0)
    hum_detection_db: float = 8.0
    hum_notch_q: float = 30.0
    max_hum_harmonics: int = 3
    n_fft: int = 512
    hop_length: int = 128
    enhancement_backend: str = "rnnoise"
    enhancement_sample_rate: int = 48_000
    enhancement_latency_ms: float = 20.0
    original_blend_fraction: float = 0.75
    presence_low_hz: float = 1_200.0
    presence_high_hz: float = 4_000.0
    presence_gain_db: float = 0.5
    target_speech_rms_dbfs: float = -22.0
    maximum_makeup_gain_db: float = 12.0
    peak_ceiling_dbfs: float = -3.0
    silence_below_peak_db: float = 35.0
    clipping_amplitude: float = 0.999
    clipping_warning_fraction: float = 0.001
    low_snr_warning_db: float = 10.0
    minimum_speech_fraction: float = 0.05
    high_reverb_proxy: float = 0.35
    maximum_allowed_snr_regression_db: float = 0.25
    maximum_reverb_proxy_increase: float = 0.12
    minimum_candidate_correlation: float = 0.94
    minimum_candidate_si_sdr_db: float = 12.0
    maximum_spectral_gain_variability_db: float = 3.0

    @classmethod
    def from_environment(cls) -> "AudioPrepConfig":
        """Build configuration from the small set of deployment-time controls."""

        return cls(
            pipeline_version=os.getenv("AUDIO_PIPELINE_VERSION", "1.1.0"),
            enhancement_backend=os.getenv(
                "AUDIO_ENHANCEMENT_BACKEND", "rnnoise"
            ),
            max_duration_seconds=float(
                os.getenv("AUDIO_MAX_DURATION_SECONDS", "600")
            ),
        )

    def as_dict(self) -> dict[str, object]:
        """Return a JSON-compatible configuration dictionary."""

        values = asdict(self)
        values["hum_candidates_hz"] = list(self.hum_candidates_hz)
        return values

    def fingerprint(self) -> str:
        """Return a stable short hash used to make retries idempotent."""

        encoded = json.dumps(
            self.as_dict(), sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()[:16]
