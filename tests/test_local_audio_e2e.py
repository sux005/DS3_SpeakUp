"""Opt-in local QA from private MP4 input to prepared audio and transcript JSON."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import pytest
import soundfile as sf

from scripts.create_review_templates import create_template
from scripts.run_real_audio_qa import CLIP_NAMES, process_clip
from src.audio.config import AudioPrepConfig
from src.transcription.local import transcribe_file


pytestmark = pytest.mark.skipif(
    os.getenv("SPEAKUP_RUN_LOCAL_E2E") != "1",
    reason="Set SPEAKUP_RUN_LOCAL_E2E=1 to run model-backed local QA",
)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
RAW_DIRECTORY = PROJECT_ROOT / "data" / "raw"
MODEL_NAME = "small.en"


@pytest.fixture(scope="module")
def model():
    missing = [name for name in CLIP_NAMES if not (RAW_DIRECTORY / name).is_file()]
    if missing:
        pytest.fail(f"Missing private raw clips: {', '.join(missing)}")

    from faster_whisper import WhisperModel

    return WhisperModel(
        MODEL_NAME,
        device="cpu",
        compute_type="int8",
        download_root=str(PROJECT_ROOT / "models" / "faster-whisper"),
    )


@pytest.mark.parametrize("name", CLIP_NAMES)
def test_raw_clip_to_audio_report_and_transcript(name: str, tmp_path: Path, model) -> None:
    source = RAW_DIRECTORY / name
    assert source.is_file(), f"Missing private source recording: {source}"
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()

    artifacts = process_clip(source, tmp_path / "prepared", AudioPrepConfig())
    report = json.loads(artifacts["report"].read_text(encoding="utf-8"))
    assert report["source"]["source_sha256"] == source_hash
    assert report["output"]["sample_rate"] == 16_000
    assert report["output"]["timeline_preserved"] is True
    assert report["output"]["enhancement"]["applied"] is True
    assert all(path.is_file() for path in artifacts.values())
    diagnostic = sf.info(artifacts["diagnostic"])
    assert diagnostic.samplerate == 16_000
    assert diagnostic.channels == 1
    assert abs(
        diagnostic.duration
        - report["source"]["samples"] / report["source"]["sample_rate"]
    ) < 0.01

    transcript_path = tmp_path / "transcript.json"
    transcript = transcribe_file(source, transcript_path, model, MODEL_NAME)
    assert json.loads(transcript_path.read_text(encoding="utf-8")) == transcript
    assert transcript["source"]["sha256"] == source_hash
    assert transcript["full_text"].strip()
    words = [word for segment in transcript["segments"] for word in segment["words"]]
    assert words
    duration = transcript["source"]["duration_seconds"]
    assert all(0 <= word["start"] <= word["end"] <= duration + 0.5 for word in words)
    assert all(first["end"] <= second["start"] for first, second in zip(words, words[1:]))

    reference_path = tmp_path / f"{source.stem}.json"
    create_template(transcript_path, reference_path)
    reference = json.loads(reference_path.read_text(encoding="utf-8"))
    assert reference["source_sha256"] == source_hash
    assert reference["text"] == transcript["full_text"]
    assert reference["automatic_segments"] == transcript["segments"]
    assert reference["review_status"] == "pending"
