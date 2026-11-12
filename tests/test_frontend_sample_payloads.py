"""Contract checks for the framework-neutral frontend mock payloads."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


FIXTURE_DIR = Path(__file__).resolve().parents[1] / "frontend" / "sample-payloads"
FORBIDDEN_RECORDING_FIELDS = {
    "execution_arn",
    "original_s3_key",
    "payload_refs",
    "raw_transcript_s3_key",
    "transcription_job_name",
}


def load(name: str) -> dict[str, Any]:
    """Load one checked-in frontend JSON fixture."""

    return json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))


def test_recording_samples_cover_wireframe_states_without_internal_fields():
    recordings = load("project-recordings.json")["items"]

    assert {item["status"] for item in recordings} == {
        "COMPLETE", "TRANSCRIBING", "FAILED",
    }
    for recording in recordings:
        assert FORBIDDEN_RECORDING_FIELDS.isdisjoint(recording)

    complete = next(item for item in recordings if item["status"] == "COMPLETE")
    assert complete["summary_metrics"]["rubric_scores"] == {
        "speaking_rate": 3,
        "filler_words": 3,
        "pauses_inside_sentences": 4,
    }
    assert "filler_occurrences" not in complete["summary_metrics"]
    assert "pauses" not in complete["summary_metrics"]
    assert "long_pauses" not in complete["summary_metrics"]


def test_review_artifact_samples_match_public_contract():
    transcript = load("transcript.json")
    analysis = load("analysis.json")
    feedback = load("feedback.json")

    assert transcript["artifact_type"] == "transcript"
    assert isinstance(transcript["data"]["text"], str)
    assert isinstance(transcript["data"]["items"], list)

    assert analysis["artifact_type"] == "analysis"
    metrics = analysis["data"]["metrics"]
    assert metrics["filler_occurrences"][0] == {
        "filler": "um", "start_seconds": 0.0, "end_seconds": 0.28,
    }
    assert metrics["pauses"][0]["inside_sentence"] is True

    assert feedback["artifact_type"] == "feedback"
    assert set(feedback["data"]) == {"feedback"}


def test_review_sample_matches_structured_feedback_contract():
    review = load("review.json")
    transcript = load("transcript.json")
    summary = next(
        item for item in load("project-recordings.json")["items"]
        if item["recording_id"] == review["recording_id"]
    )["summary_metrics"]

    assert set(review) == {"recording_id", "transcript", "feedback", "summary_metrics"}
    assert review["transcript"] == transcript["data"]
    assert review["summary_metrics"] == summary

    feedback = review["feedback"]
    assert set(feedback) == {"feedback", "schema_version", "categories", "moments", "metrics"}
    assert feedback["schema_version"] == 2
    assert set(feedback["categories"]) == {"general", "pace", "fillers", "pauses"}
    for note in feedback["categories"].values():
        assert set(note) == {"observation", "next_step"}
    assert 1 <= len(feedback["moments"]) <= 4
    for moment in feedback["moments"]:
        assert set(moment) == {
            "id", "start_seconds", "end_seconds", "text", "kind", "observation", "next_step",
        }
        assert moment["kind"] in {"strength", "improve"}
        assert 0 <= moment["start_seconds"] < moment["end_seconds"]


def test_web_app_data_is_an_exact_copy_of_the_samples():
    web_data = FIXTURE_DIR.parent / "web" / "data"
    # The web demo renames its sample project, and its browser tests rely on that name.
    for fixture in FIXTURE_DIR.glob("*.json"):
        if fixture.name == "projects.json":
            continue
        assert (web_data / fixture.name).read_bytes() == fixture.read_bytes(), fixture.name


def test_upload_sample_cannot_target_a_real_endpoint():
    reservation = load("upload-reservation.json")

    assert reservation["upload_url"].startswith("https://example.invalid/")
    assert reservation["recording_id"] == reservation["recording"]["recording_id"]
    assert (
        reservation["expected_content_length"]
        == reservation["recording"]["content_length"]
    )
    assert reservation["required_headers"] == {
        "Content-Type": "audio/webm",
        "If-None-Match": "*",
        "x-amz-server-side-encryption": "AES256",
        "x-amz-meta-owner-id": "demo-user",
        "x-amz-meta-project-id": "project-demo-day",
        "x-amz-meta-recording-id": reservation["recording_id"],
        "x-amz-meta-payload-type": "original-audio.v1",
        "x-amz-checksum-sha256": "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    }


def test_limits_and_throttle_error_use_public_contract_keys():
    limits = load("account-limits.json")
    error = load("active-workflow-limit-error.json")

    assert limits["remaining_workflows"] == (
        limits["max_active_workflows"] - limits["active_workflows"]
    )
    assert error == {
        "message": "active workflow limit reached",
        "code": "ACTIVE_WORKFLOW_LIMIT",
        "retryable": True,
    }
