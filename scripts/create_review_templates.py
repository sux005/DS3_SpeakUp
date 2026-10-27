"""Prefill hash-linked transcript review files without replacing human edits."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def create_template(transcript_path: Path, reference_path: Path) -> None:
    transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    reference_path.parent.mkdir(parents=True, exist_ok=True)
    reference = {
        "source_file": transcript["source"]["file"],
        "source_sha256": transcript["source"]["sha256"],
        "review_status": "pending",
        "text": transcript["full_text"],
        "automatic_segments": transcript["segments"],
    }
    with reference_path.open("x", encoding="utf-8") as handle:
        json.dump(reference, handle, indent=2)
        handle.write("\n")


def fill_empty_template(transcript_path: Path, reference_path: Path) -> bool:
    """Fill only a pending, empty template created by the earlier workflow."""

    transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    reference = json.loads(reference_path.read_text(encoding="utf-8"))
    if reference.get("source_sha256") != transcript["source"]["sha256"]:
        raise ValueError(f"Source hash differs for {reference_path}")
    if reference.get("review_status") != "pending" or reference.get("text"):
        return False
    reference["text"] = transcript["full_text"]
    reference["automatic_segments"] = transcript["segments"]
    reference_path.write_text(
        json.dumps(reference, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--transcripts-dir",
        type=Path,
        default=PROJECT_ROOT / "results" / "local_transcripts",
    )
    parser.add_argument(
        "--references-dir", type=Path, default=PROJECT_ROOT / "data" / "references"
    )
    args = parser.parse_args()
    transcripts = sorted(args.transcripts_dir.glob("*/transcript.json"))
    if not transcripts:
        parser.error(f"No transcripts found in {args.transcripts_dir}")
    for transcript in transcripts:
        reference = args.references_dir / f"{transcript.parent.name}.json"
        if reference.exists():
            if fill_empty_template(transcript, reference):
                print(f"Filled pending review: {reference}")
            else:
                print(f"Kept existing reference: {reference}")
            continue
        create_template(transcript, reference)
        print(f"Created review template: {reference}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
