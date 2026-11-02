"""Write word-timestamped automatic transcripts from local audio files."""

from __future__ import annotations

import hashlib
from importlib.metadata import version
import json
from pathlib import Path
from typing import Any


def transcribe_file(
    source: Path,
    output: Path,
    model: Any,
    model_name: str,
    language: str = "en",
) -> dict[str, Any]:
    """Transcribe one source file and record exact input and model provenance."""

    source = Path(source)
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    segments, info = model.transcribe(
        str(source),
        language=language,
        word_timestamps=True,
        beam_size=5,
        vad_filter=False,
    )
    segment_records = []
    for segment in segments:
        words = [
            {
                "start": round(float(word.start), 3),
                "end": round(float(word.end), 3),
                "text": word.word.strip(),
                "probability": round(float(word.probability), 4),
            }
            for word in (segment.words or [])
        ]
        segment_records.append(
            {
                "start": round(float(segment.start), 3),
                "end": round(float(segment.end), 3),
                "text": segment.text.strip(),
                "words": words,
            }
        )

    if hashlib.sha256(source.read_bytes()).hexdigest() != source_hash:
        raise ValueError(f"Source recording changed during transcription: {source}")

    transcript = {
        "schema_version": 1,
        "source": {
            "file": source.name,
            "sha256": source_hash,
            "duration_seconds": round(float(info.duration), 3),
        },
        "engine": {
            "name": "faster-whisper",
            "version": version("faster-whisper"),
            "model": model_name,
            "language": language,
        },
        "full_text": " ".join(record["text"] for record in segment_records),
        "segments": segment_records,
        "warnings": (
            []
            if any(record["words"] for record in segment_records)
            else ["NO_WORDS_DETECTED"]
        ),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(transcript, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return transcript
