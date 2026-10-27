"""Tests for timestamped local transcripts and reference comparison."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from scripts.check_transcript_accuracy import compare, word_error_rate
from scripts.create_review_templates import create_template, fill_empty_template
from src.transcription.local import transcribe_file


class FakeModel:
    def transcribe(self, path, **options):
        assert Path(path).name == "sample.mp4"
        assert options["word_timestamps"] is True
        assert options["language"] == "en"
        words = [
            SimpleNamespace(start=0.2, end=0.6, word=" Hello", probability=0.95),
            SimpleNamespace(start=0.6, end=1.0, word=" world.", probability=0.9),
        ]
        segment = SimpleNamespace(start=0.2, end=1.0, text=" Hello world.", words=words)
        return iter([segment]), SimpleNamespace(duration=1.2)


def test_transcript_records_source_and_word_timestamps(tmp_path: Path) -> None:
    source = tmp_path / "sample.mp4"
    source.write_bytes(b"recording bytes")
    output = tmp_path / "derived" / "transcript.json"

    with patch("src.transcription.local.version", return_value="1.2.1"):
        result = transcribe_file(source, output, FakeModel(), "small.en")

    assert json.loads(output.read_text(encoding="utf-8")) == result
    assert result["source"]["sha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
    assert result["full_text"] == "Hello world."
    assert result["segments"][0]["words"] == [
        {"start": 0.2, "end": 0.6, "text": "Hello", "probability": 0.95},
        {"start": 0.6, "end": 1.0, "text": "world.", "probability": 0.9},
    ]


def test_transcription_rejects_source_changed_during_processing(tmp_path: Path) -> None:
    source = tmp_path / "sample.mp4"
    source.write_bytes(b"original")

    class ChangingModel(FakeModel):
        def transcribe(self, path, **options):
            source.write_bytes(b"changed")
            return super().transcribe(path, **options)

    with patch("src.transcription.local.version", return_value="1.2.1"):
        with pytest.raises(ValueError, match="changed during transcription"):
            transcribe_file(source, tmp_path / "transcript.json", ChangingModel(), "small.en")
    assert not (tmp_path / "transcript.json").exists()


def test_reference_comparison_requires_matching_source(tmp_path: Path) -> None:
    transcript = tmp_path / "transcript.json"
    transcript.write_text(
        json.dumps({"source": {"file": "sample.mp4", "sha256": "abc"}, "full_text": "hello world"})
    )
    reference = tmp_path / "reference.json"
    reference.write_text(
        json.dumps(
            {"source_sha256": "abc", "review_status": "reviewed", "text": "hello brave world"}
        )
    )

    result = compare(transcript, reference)
    assert result["word_error_rate"] == pytest.approx(1 / 3, abs=1e-4)

    reference.write_text(
        json.dumps(
            {"source_sha256": "different", "review_status": "reviewed", "text": "hello brave world"}
        )
    )
    with pytest.raises(ValueError, match="different source hashes"):
        compare(transcript, reference)


def test_review_template_starts_pending_and_cannot_be_overwritten(tmp_path: Path) -> None:
    transcript = tmp_path / "transcript.json"
    transcript.write_text(
        json.dumps(
            {
                "source": {"file": "sample.mp4", "sha256": "abc"},
                "full_text": "hello",
                "segments": [{"start": 0.0, "end": 0.5, "text": "hello", "words": []}],
            }
        )
    )
    reference = tmp_path / "reference.json"
    create_template(transcript, reference)
    created = json.loads(reference.read_text())
    assert created["review_status"] == "pending"
    assert created["text"] == "hello"
    assert created["automatic_segments"] == json.loads(transcript.read_text())["segments"]
    with pytest.raises(ValueError, match="not been marked reviewed"):
        compare(transcript, reference)
    with pytest.raises(FileExistsError):
        create_template(transcript, reference)

    created["text"] = "human correction"
    created["review_status"] = "reviewed"
    reference.write_text(json.dumps(created))
    assert fill_empty_template(transcript, reference) is False
    assert json.loads(reference.read_text())["text"] == "human correction"

    created["text"] = ""
    created["review_status"] = "pending"
    reference.write_text(json.dumps(created))
    assert fill_empty_template(transcript, reference) is True
    assert json.loads(reference.read_text())["text"] == "hello"


def test_word_error_rate_rejects_empty_reference() -> None:
    with pytest.raises(ValueError, match="empty"):
        word_error_rate("", "some words")


