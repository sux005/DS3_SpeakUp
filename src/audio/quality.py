"""Audio quality measurements used for warnings and enhancement fallback."""

from __future__ import annotations

import math

import librosa
import numpy as np

from src.audio.config import AudioPrepConfig


EPSILON = np.finfo(np.float32).eps


def _db(value: float) -> float:
    return float(20.0 * math.log10(max(value, float(EPSILON))))


def _frame_rms(y: np.ndarray, config: AudioPrepConfig) -> np.ndarray:
    if len(y) < config.n_fft:
        y = np.pad(y, (0, config.n_fft - len(y)))
    return librosa.feature.rms(
        y=y,
        frame_length=config.n_fft,
        hop_length=config.hop_length,
        center=True,
    )[0]


def _reverberation_proxy(frame_rms: np.ndarray, active: np.ndarray) -> float:
    """Estimate late energy after speech offsets; this is not an RT60 estimate."""

    falling_edges = np.flatnonzero(active[:-1] & ~active[1:])
    ratios: list[float] = []
    for edge in falling_edges:
        before = frame_rms[max(0, edge - 7) : edge + 1]
        after = frame_rms[edge + 1 : edge + 9]
        if before.size and after.size:
            ratios.append(float(np.mean(after) / max(np.mean(before), EPSILON)))
    return float(np.clip(np.median(ratios), 0.0, 1.0)) if ratios else 0.0


def measure_quality(
    y: np.ndarray, sample_rate: int, config: AudioPrepConfig
) -> dict[str, float]:
    """Return deterministic signal-quality measurements for one mono waveform."""

    if y.ndim != 1:
        raise ValueError("Quality measurement expects mono audio")
    if not len(y):
        raise ValueError("Audio contains no samples")

    frame_rms = _frame_rms(y, config)
    peak_frame = float(np.max(frame_rms))
    active_threshold = peak_frame * 10.0 ** (-config.silence_below_peak_db / 20.0)
    active = frame_rms > max(active_threshold, EPSILON)
    sorted_rms = np.sort(frame_rms)
    noise_count = max(1, int(math.ceil(len(sorted_rms) * 0.2)))
    noise_rms = float(np.median(sorted_rms[:noise_count]))
    speech_frames = frame_rms[active]
    speech_rms = float(np.median(speech_frames)) if speech_frames.size else 0.0
    snr_db = _db(speech_rms) - _db(noise_rms)

    magnitude = np.abs(
        librosa.stft(
            y,
            n_fft=config.n_fft,
            hop_length=config.hop_length,
            win_length=config.n_fft,
        )
    )
    flatness = librosa.feature.spectral_flatness(S=magnitude + EPSILON)

    return {
        "duration_seconds": round(len(y) / sample_rate, 4),
        "peak_dbfs": round(_db(float(np.max(np.abs(y)))), 3),
        "rms_dbfs": round(_db(float(np.sqrt(np.mean(np.square(y))))), 3),
        "dc_offset": round(float(np.mean(y)), 7),
        "clipping_fraction": round(
            float(np.mean(np.abs(y) >= config.clipping_amplitude)), 7
        ),
        "non_silent_fraction": round(float(np.mean(active)), 5),
        "estimated_snr_db": round(float(np.clip(snr_db, -20.0, 80.0)), 3),
        "spectral_flatness": round(float(np.median(flatness)), 5),
        "reverberation_tail_proxy": round(
            _reverberation_proxy(frame_rms, active), 5
        ),
    }


def quality_warnings(
    metrics: dict[str, float], config: AudioPrepConfig
) -> list[str]:
    """Translate quality measurements into stable machine-readable warnings."""

    warnings: list[str] = []
    if metrics["clipping_fraction"] > config.clipping_warning_fraction:
        warnings.append("CLIPPED_INPUT")
    if metrics["estimated_snr_db"] < config.low_snr_warning_db:
        warnings.append("LOW_ESTIMATED_SNR")
    if metrics["non_silent_fraction"] < config.minimum_speech_fraction:
        warnings.append("LITTLE_DETECTED_SPEECH")
    if metrics["reverberation_tail_proxy"] > config.high_reverb_proxy:
        warnings.append("HIGH_REVERBERATION_PROXY")
    return warnings


def compare_candidate(
    reference: np.ndarray,
    candidate: np.ndarray,
    config: AudioPrepConfig,
) -> dict[str, float]:
    """Measure speech preservation and time-varying spectral modification."""

    if reference.shape != candidate.shape or reference.ndim != 1:
        raise ValueError("Candidate comparison requires aligned mono signals")
    reference64 = reference.astype(np.float64)
    candidate64 = candidate.astype(np.float64)
    reference_centered = reference64 - float(np.mean(reference64))
    candidate_centered = candidate64 - float(np.mean(candidate64))
    denominator = float(
        np.linalg.norm(reference_centered) * np.linalg.norm(candidate_centered)
    )
    correlation = (
        float(np.dot(reference_centered, candidate_centered) / denominator)
        if denominator > EPSILON
        else 0.0
    )

    reference_energy = float(np.dot(reference64, reference64))
    projection_scale = float(
        np.dot(candidate64, reference64) / max(reference_energy, EPSILON)
    )
    projected = projection_scale * reference64
    residual = candidate64 - projected
    si_sdr_db = float(
        10.0
        * np.log10(
            (float(np.dot(projected, projected)) + EPSILON)
            / (float(np.dot(residual, residual)) + EPSILON)
        )
    )

    reference_magnitude = np.abs(
        librosa.stft(
            reference,
            n_fft=config.n_fft,
            hop_length=config.hop_length,
            win_length=config.n_fft,
        )
    )
    candidate_magnitude = np.abs(
        librosa.stft(
            candidate,
            n_fft=config.n_fft,
            hop_length=config.hop_length,
            win_length=config.n_fft,
        )
    )
    reliable = reference_magnitude > np.percentile(reference_magnitude, 35.0)
    gain_db = np.clip(
        20.0
        * np.log10(
            np.maximum(candidate_magnitude, EPSILON)
            / np.maximum(reference_magnitude, EPSILON)
        ),
        -24.0,
        24.0,
    )
    per_frequency_variability = [
        float(np.std(gain_db[index, reliable[index]]))
        for index in range(gain_db.shape[0])
        if np.count_nonzero(reliable[index]) >= 8
    ]
    spectral_gain_variability = (
        float(np.median(per_frequency_variability))
        if per_frequency_variability
        else 0.0
    )

    reference_frames = _frame_rms(reference, config)
    candidate_frames = _frame_rms(candidate, config)
    quiet_threshold = float(np.percentile(reference_frames, 20.0))
    quiet = reference_frames <= quiet_threshold
    quiet_attenuation_db = 0.0
    if np.any(quiet):
        quiet_attenuation_db = _db(float(np.median(reference_frames[quiet]))) - _db(
            float(np.median(candidate_frames[quiet]))
        )

    return {
        "waveform_correlation": round(correlation, 6),
        "si_sdr_db": round(si_sdr_db, 3),
        "spectral_gain_variability_db": round(
            spectral_gain_variability, 3
        ),
        "quiet_frame_attenuation_db": round(quiet_attenuation_db, 3),
    }
