"""Create a level-matched A/B WAV from aligned reference and candidate audio."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

import numpy as np
import soundfile as sf


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--start-seconds", type=float, default=5.0)
    parser.add_argument("--duration-seconds", type=float, default=10.0)
    parser.add_argument("--gap-seconds", type=float, default=0.75)
    args = parser.parse_args()

    reference, reference_rate = sf.read(
        args.reference, dtype="float32", always_2d=False
    )
    candidate, candidate_rate = sf.read(
        args.candidate, dtype="float32", always_2d=False
    )
    if reference_rate != candidate_rate:
        raise ValueError("A/B inputs must use the same sample rate")
    if reference.ndim != 1 or candidate.ndim != 1:
        raise ValueError("A/B inputs must be mono")
    start = max(0, int(round(args.start_seconds * reference_rate)))
    length = int(round(args.duration_seconds * reference_rate))
    end = min(len(reference), len(candidate), start + length)
    if end <= start:
        raise ValueError("The requested A/B excerpt is outside the audio timeline")
    gap = np.zeros(int(round(args.gap_seconds * reference_rate)), dtype=np.float32)
    comparison = np.concatenate(
        [reference[start:end], gap, candidate[start:end]]
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sf.write(args.output, comparison, reference_rate, subtype="PCM_16")
    print(
        f"Reference first, enhanced second; excerpt "
        f"{start / reference_rate:.2f}-{end / reference_rate:.2f}s"
    )
    print(args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
