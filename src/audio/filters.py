"""Conservative, timing-preserving filters for speech preparation."""

from __future__ import annotations

import librosa
import numpy as np
from scipy import signal

from src.audio.config import AudioPrepConfig


EPSILON = np.finfo(np.float32).eps


def detect_hum_frequency(
    y: np.ndarray, sample_rate: int, config: AudioPrepConfig
) -> float | None:
    """Return 50 or 60 Hz only when a narrow tonal peak is clearly present."""

    segment = y[: min(len(y), sample_rate * 30)]
    frequencies, power = signal.welch(
        segment,
        fs=sample_rate,
        nperseg=min(8192, max(256, len(segment))),
    )
    power_db = 10.0 * np.log10(power + EPSILON)
    best_frequency: float | None = None
    best_contrast = -np.inf
    for candidate in config.hum_candidates_hz:
        peak = np.abs(frequencies - candidate) <= 0.75
        neighborhood = (np.abs(frequencies - candidate) >= 3.0) & (
            np.abs(frequencies - candidate) <= 8.0
        )
        if not np.any(peak) or not np.any(neighborhood):
            continue
        contrast = float(np.max(power_db[peak]) - np.median(power_db[neighborhood]))
        if contrast > best_contrast:
            best_frequency = candidate
            best_contrast = contrast
    return best_frequency if best_contrast >= config.hum_detection_db else None


def _resample(y: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    if source_rate == target_rate:
        return y.astype(np.float32, copy=True)
    return librosa.resample(
        y,
        orig_sr=source_rate,
        target_sr=target_rate,
        res_type="soxr_hq",
        fix=True,
        scale=False,
    ).astype(np.float32)


def rnnoise_enhance(
    y: np.ndarray, sample_rate: int, config: AudioPrepConfig
) -> tuple[np.ndarray, dict[str, float | int | str | bool]]:
    """Run RNNoise at 48 kHz while preserving the input rate and timeline."""

    if config.enhancement_backend == "none":
        return y.copy(), {
            "backend": "none",
            "available": True,
            "applied": False,
            "frames": 0,
        }
    if config.enhancement_backend != "rnnoise":
        raise ValueError(
            f"Unsupported enhancement backend: {config.enhancement_backend}"
        )
    try:
        from pyrnnoise import RNNoise
    except ImportError as error:
        raise RuntimeError(
            "RNNoise enhancement requires pyrnnoise==0.4.3"
        ) from error

    model_rate = config.enhancement_sample_rate
    model_input = _resample(y, sample_rate, model_rate)
    pcm = np.rint(np.clip(model_input, -1.0, 1.0) * 32767.0).astype(np.int16)
    denoiser = RNNoise(sample_rate=model_rate)
    frames = list(denoiser.denoise_chunk(pcm[np.newaxis, :], partial=True))
    if not frames:
        raise RuntimeError("RNNoise produced no output frames")
    model_output = np.concatenate([frame for _, frame in frames], axis=1)[0]
    enhanced = (model_output.astype(np.float32) / 32768.0)[: len(model_input)]
    if len(enhanced) < len(model_input):
        enhanced = np.pad(enhanced, (0, len(model_input) - len(enhanced)))
    latency_samples = int(
        round(model_rate * config.enhancement_latency_ms / 1000.0)
    )
    if 0 < latency_samples < len(enhanced):
        enhanced = np.pad(enhanced[latency_samples:], (0, latency_samples))
    enhanced = _resample(enhanced, model_rate, sample_rate)
    if len(enhanced) < len(y):
        enhanced = np.pad(enhanced, (0, len(y) - len(enhanced)))
    enhanced = enhanced[: len(y)].astype(np.float32)
    speech_probabilities = np.concatenate(
        [np.asarray(probability, dtype=np.float32).ravel() for probability, _ in frames]
    )
    return enhanced, {
        "backend": "rnnoise",
        "available": True,
        "applied": True,
        "model_sample_rate": model_rate,
        "latency_compensation_samples": latency_samples,
        "frames": len(frames),
        "mean_speech_probability": round(
            float(np.mean(speech_probabilities)), 5
        ),
        "high_speech_probability_fraction": round(
            float(np.mean(speech_probabilities >= 0.5)), 5
        ),
    }


def blend_with_original(
    original: np.ndarray, enhanced: np.ndarray, original_fraction: float
) -> np.ndarray:
    """Restore natural speech detail by mixing dry signal into enhancement."""

    if not 0.0 <= original_fraction <= 1.0:
        raise ValueError("original_blend_fraction must be between 0 and 1")
    if len(original) != len(enhanced):
        raise ValueError("Signals must have matching timelines before blending")
    return (
        original_fraction * original + (1.0 - original_fraction) * enhanced
    ).astype(np.float32)


def normalize_speech_level(y: np.ndarray, config: AudioPrepConfig) -> np.ndarray:
    """Normalize detected speech RMS and enforce a hard peak ceiling."""

    intervals = librosa.effects.split(
        y,
        top_db=config.silence_below_peak_db,
        frame_length=config.n_fft,
        hop_length=config.hop_length,
    )
    if not len(intervals):
        return y.copy()
    active = np.concatenate([y[start:end] for start, end in intervals if end > start])
    if not active.size:
        return y.copy()
    active_rms = float(np.sqrt(np.mean(np.square(active))))
    target_rms = 10.0 ** (config.target_speech_rms_dbfs / 20.0)
    requested_gain = target_rms / max(active_rms, EPSILON)
    maximum_gain = 10.0 ** (config.maximum_makeup_gain_db / 20.0)
    normalized = y * min(requested_gain, maximum_gain)
    peak = float(np.max(np.abs(normalized)))
    peak_ceiling = 10.0 ** (config.peak_ceiling_dbfs / 20.0)
    if peak > peak_ceiling:
        normalized *= peak_ceiling / peak
    return normalized.astype(np.float32)
