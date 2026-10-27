"""Generate a deterministic noisy speech example and run audio preparation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import numpy as np
import soundfile as sf


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.audio.preprocess import process_audio_file


def _synthetic_voice(sample_rate: int, seconds: float = 6.0) -> np.ndarray:
    samples = int(sample_rate * seconds)
    time = np.arange(samples, dtype=np.float64) / sample_rate
    fundamental = 132.0 + 18.0 * np.sin(2.0 * np.pi * 0.55 * time)
    phase = 2.0 * np.pi * np.cumsum(fundamental) / sample_rate
    voice = np.zeros(samples, dtype=np.float64)
    for harmonic in range(1, 12):
        voice += np.sin(harmonic * phase) / (harmonic**1.15)
    envelope = np.zeros(samples, dtype=np.float64)
    for start, end in ((0.25, 1.25), (1.5, 2.55), (2.9, 4.0), (4.35, 5.7)):
        begin = int(start * sample_rate)
        finish = int(end * sample_rate)
        envelope[begin:finish] = np.hanning(finish - begin)
    return (0.2 * voice * envelope).astype(np.float32)


def _degrade(clean: np.ndarray, sample_rate: int) -> np.ndarray:
    mono = clean if clean.ndim == 1 else np.mean(clean, axis=1)
    echo = np.zeros_like(mono)
    for delay_seconds, gain in ((0.075, 0.24), (0.145, 0.12)):
        delay = int(delay_seconds * sample_rate)
        echo[delay:] += mono[:-delay] * gain
    rng = np.random.default_rng(20261025)
    white = rng.normal(0.0, 0.022, len(mono))
    fan = np.convolve(white, np.ones(21) / 21.0, mode="same") * 2.5
    time = np.arange(len(mono)) / sample_rate
    hum = 0.02 * np.sin(2.0 * np.pi * 60.0 * time)
    return np.clip(mono + echo + white + fan + hum, -0.95, 0.95).astype(np.float32)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Optional clean speech WAV")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("results/audio_prep_example"),
    )
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    if args.source:
        clean, sample_rate = sf.read(args.source, dtype="float32", always_2d=False)
    else:
        sample_rate = 16_000
        clean = _synthetic_voice(sample_rate)

    clean_path = args.output / "clean_source.wav"
    noisy_path = args.output / "noisy_original.wav"
    sf.write(clean_path, clean, sample_rate, subtype="PCM_16")
    sf.write(noisy_path, _degrade(clean, sample_rate), sample_rate, subtype="PCM_16")
    artifacts = process_audio_file(
        noisy_path,
        args.output,
        source_metadata={"example": "deterministic_noise_hum_and_echo"},
    )
    print(json.dumps({name: str(path) for name, path in artifacts.items()}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
