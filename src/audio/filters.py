"""Conservative, timing-preserving filters for speech preparation."""

from __future__ import annotations

import librosa
import numpy as np
from scipy import signal

from src.audio.config import AudioPrepConfig


EPSILON = np.finfo(np.float32).eps


def _safe_sos_filter(sos: np.ndarray, y: np.ndarray) -> np.ndarray:
    try:
        return signal.sosfiltfilt(sos, y).astype(np.float32)
    except ValueError:
        return signal.sosfilt(sos, y).astype(np.float32)


def highpass(y: np.ndarray, sample_rate: int, config: AudioPrepConfig) -> np.ndarray:
    """Remove sub-speech rumble without altering the signal timeline."""

    cutoff = min(config.highpass_hz, sample_rate * 0.45)
    sos = signal.butter(
        config.highpass_order,
        cutoff,
        btype="highpass",
        fs=sample_rate,
        output="sos",
    )
    return _safe_sos_filter(sos, y)


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


def remove_hum(
    y: np.ndarray,
    sample_rate: int,
    fundamental_hz: float | None,
    config: AudioPrepConfig,
) -> np.ndarray:
    """Notch a detected mains fundamental and a bounded number of harmonics."""

    if fundamental_hz is None:
        return y.copy()
    filtered = y.astype(np.float64)
    for harmonic in range(1, config.max_hum_harmonics + 1):
        frequency = fundamental_hz * harmonic
        if frequency >= sample_rate * 0.45:
            break
        numerator, denominator = signal.iirnotch(
            frequency, config.hum_notch_q, fs=sample_rate
        )
        try:
            filtered = signal.filtfilt(numerator, denominator, filtered)
        except ValueError:
            filtered = signal.lfilter(numerator, denominator, filtered)
    return filtered.astype(np.float32)


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


def presence_equalize(
    y: np.ndarray, sample_rate: int, config: AudioPrepConfig
) -> np.ndarray:
    """Add a small, broad speech-presence lift rather than aggressive EQ."""

    nyquist_guard = sample_rate * 0.45
    high = min(config.presence_high_hz, nyquist_guard)
    low = min(config.presence_low_hz, high * 0.8)
    if low <= 0 or high <= low or config.presence_gain_db <= 0:
        return y.copy()
    sos = signal.butter(2, [low, high], btype="bandpass", fs=sample_rate, output="sos")
    speech_band = _safe_sos_filter(sos, y)
    added_gain = 10.0 ** (config.presence_gain_db / 20.0) - 1.0
    return (y + added_gain * speech_band).astype(np.float32)


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
