"""Step Functions worker using the internal payload API for durable results."""

from __future__ import annotations

from functools import lru_cache
import json
import os
import time
from typing import Any

import boto3
from botocore.config import Config

from src.aws_payload import (
    PayloadRef,
    PayloadType,
    RecordingStatus,
    SpeakUpPayloadStore,
)
from src.aws_payload.keys import artifact_key


SDK_CONFIG = Config(
    retries={"total_max_attempts": 3, "mode": "adaptive"},
    connect_timeout=5,
    read_timeout=60,
    user_agent_appid="speakup-processor/1.0",
)
TRANSCRIBE = boto3.client("transcribe", config=SDK_CONFIG)
BEDROCK = boto3.client("bedrock-runtime", config=SDK_CONFIG)


@lru_cache(maxsize=1)
def payloads() -> SpeakUpPayloadStore:
    """Reuse backend clients and repositories across warm invocations."""

    return SpeakUpPayloadStore.from_environment()


def _raw_transcript_reference(event: dict[str, Any]) -> PayloadRef:
    return PayloadRef(
        user_id=event["user_id"],
        project_id=event["project_id"],
        recording_id=event["recording_id"],
        key=event["transcript_s3_key"],
        payload_type=PayloadType.TRANSCRIPT,
        content_type="application/json",
        content_length=0,
        sha256="",
        producer="aws-transcribe",
        producer_version="raw-v1",
    )


def _read_raw_transcript(event: dict[str, Any]) -> dict[str, Any]:
    with payloads().objects.open_stream(_raw_transcript_reference(event)) as body:
        raw = body.read(payloads().config.max_transcript_payload_bytes + 1)
    if len(raw) > payloads().config.max_transcript_payload_bytes:
        raise ValueError("Transcribe output exceeds the configured JSON limit")
    document = json.loads(raw.decode("utf-8", errors="strict"))
    if not isinstance(document, dict):
        raise ValueError("Transcribe output must be a JSON object")
    return document


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Run one bounded workflow action without logging audio or transcript text."""

    del context
    action = event["action"]
    store = payloads()

    if action == "start":
        recording = store.get_recording(event["user_id"], event["recording_id"])
        extension = event["audio_s3_key"].rsplit(".", 1)[-1].lower()
        media_format = {"wav": "wav", "mp3": "mp3", "m4a": "m4a"}[extension]
        job_name = (
            f"{os.environ['ENVIRONMENT']}-{event['recording_id']}-"
            f"{int(time.time())}"
        )
        transcript_key = artifact_key(
            event["user_id"],
            event["project_id"],
            event["recording_id"],
            producer="aws-transcribe",
            producer_version="raw-v1",
            artifact_name="transcript_raw",
            content_type="application/json",
        )
        TRANSCRIBE.start_transcription_job(
            TranscriptionJobName=job_name,
            Media={
                "MediaFileUri": (
                    f"s3://{store.config.data_bucket}/{event['audio_s3_key']}"
                )
            },
            MediaFormat=media_format,
            LanguageCode="en-US",
            OutputBucketName=store.config.data_bucket,
            OutputKey=transcript_key,
        )
        updated = store.transition_recording(
            event["user_id"],
            event["recording_id"],
            RecordingStatus.TRANSCRIBING,
            expected_revision=recording.revision,
            updates={
                "transcription_job_name": job_name,
                "raw_transcript_s3_key": transcript_key,
            },
        )
        return {
            **event,
            "transcription_job_name": job_name,
            "transcript_s3_key": transcript_key,
            "recording_revision": updated.revision,
        }

    if action == "status":
        job = TRANSCRIBE.get_transcription_job(
            TranscriptionJobName=event["transcription_job_name"]
        )["TranscriptionJob"]
        return {
            **event,
            "transcribe_status": job["TranscriptionJobStatus"],
            "failure_reason": job.get("FailureReason", ""),
            "error": job.get("FailureReason", "Transcription job failed"),
        }

    if action == "analyze":
        document = _read_raw_transcript(event)
        transcripts = document.get("results", {}).get("transcripts") or [
            {"transcript": ""}
        ]
        text = str(transcripts[0].get("transcript", ""))
        items = document.get("results", {}).get("items", [])
        words = [item for item in items if item.get("type") == "pronunciation"]
        duration = max([float(item.get("end_time", 0)) for item in words] or [0.0])
        tokens = [
            item.get("alternatives", [{}])[0].get("content", "").lower()
            for item in words
        ]
        fillers = {
            word: tokens.count(word)
            for word in ["um", "uh", "like", "actually", "basically"]
            if tokens.count(word)
        }
        metrics = {
            "word_count": len(words),
            "duration_seconds": round(duration, 2),
            "words_per_minute": (
                round(len(words) / (duration / 60), 1) if duration else 0
            ),
            "filler_words": fillers,
        }
        recording = store.get_recording(event["user_id"], event["recording_id"])
        recording, transcript_ref = store.put_json_artifact(
            event["user_id"],
            event["recording_id"],
            payload_type=PayloadType.TRANSCRIPT,
            producer="speakup-transcript-normalizer",
            producer_version="1.0.0",
            artifact_name="transcript",
            data={"text": text, "items": items},
            expected_revision=recording.revision,
        )
        recording, analysis_ref = store.put_json_artifact(
            event["user_id"],
            event["recording_id"],
            payload_type=PayloadType.SPEECH_ANALYSIS,
            producer="speakup-speech-analysis",
            producer_version="1.0.0",
            artifact_name="speech_analysis",
            data={"metrics": metrics},
            expected_revision=recording.revision,
        )
        recording = store.transition_recording(
            event["user_id"],
            event["recording_id"],
            RecordingStatus.ANALYZED,
            expected_revision=recording.revision,
            updates={"summary_metrics": metrics},
        )
        return {
            **event,
            "transcript_s3_key": transcript_ref.key,
            "analysis_s3_key": analysis_ref.key,
            "summary_metrics": metrics,
            "recording_revision": recording.revision,
        }

    if action == "feedback":
        recording = store.get_recording(event["user_id"], event["recording_id"])
        if recording.status is RecordingStatus.COMPLETE:
            return {**event, "status": recording.status.value}
        feedback_ref = recording.payload_refs.get(PayloadType.FEEDBACK.value)
        if not feedback_ref:
            reconciled = store.reconcile_json_artifact(
                event["user_id"],
                event["recording_id"],
                payload_type=PayloadType.FEEDBACK,
                producer="speakup-coach",
                producer_version="1.0.0",
                artifact_name="feedback",
                expected_revision=recording.revision,
            )
            if reconciled is not None:
                recording, reference = reconciled
                feedback_ref = reference.as_dict()
        if feedback_ref:
            recording = store.transition_recording(
                event["user_id"],
                event["recording_id"],
                RecordingStatus.COMPLETE,
                expected_revision=recording.revision,
                updates={"feedback_s3_key": feedback_ref["key"]},
            )
            return {**event, "status": recording.status.value}
        transcript = store.get_json_artifact(
            event["user_id"], event["recording_id"], PayloadType.TRANSCRIPT
        )
        prompt = json.dumps(
            {
                "metrics": event["summary_metrics"],
                "transcript": transcript["data"].get("text", ""),
            },
            separators=(",", ":"),
        )
        result = BEDROCK.converse(
            modelId=os.environ["BEDROCK_MODEL_ID"],
            system=[
                {
                    "text": (
                        "You are a public-speaking coach. Base feedback only on the "
                        "supplied metrics and transcript. Return concise strengths, "
                        "priorities, and three concrete exercises."
                    )
                }
            ],
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 800, "temperature": 0.2},
        )
        feedback = "".join(
            block.get("text", "")
            for block in result["output"]["message"]["content"]
        )
        recording, feedback_ref = store.put_json_artifact(
            event["user_id"],
            event["recording_id"],
            payload_type=PayloadType.FEEDBACK,
            producer="speakup-coach",
            producer_version="1.0.0",
            artifact_name="feedback",
            data={
                "feedback": feedback,
                "model_id": os.environ["BEDROCK_MODEL_ID"],
            },
            expected_revision=recording.revision,
        )
        recording = store.transition_recording(
            event["user_id"],
            event["recording_id"],
            RecordingStatus.COMPLETE,
            expected_revision=recording.revision,
            updates={"feedback_s3_key": feedback_ref.key},
        )
        clean = dict(event)
        clean.pop("transcript_text", None)
        return {**clean, "status": recording.status.value}

    if action == "fail":
        recording = store.get_recording(event["user_id"], event["recording_id"])
        if recording.status is RecordingStatus.FAILED:
            return {**event, "status": recording.status.value}
        recording = store.transition_recording(
            event["user_id"],
            event["recording_id"],
            RecordingStatus.FAILED,
            expected_revision=recording.revision,
            updates={
                "failure_reason": str(event.get("error", "Workflow failed"))[:1000]
            },
        )
        return {**event, "status": recording.status.value}

    raise ValueError(f"Unsupported action: {action}")
