"""AWS Lambda adapter for the SpeakUp audio preparation library."""

from __future__ import annotations

from functools import lru_cache
import json
import os
from pathlib import Path
import tempfile
from typing import Any

from src.audio.config import AudioPrepConfig
from src.audio.preprocess import process_audio_file
from src.aws_payload import PayloadType, SpeakUpPayloadStore
from src.aws_payload.keys import artifact_key, legacy_preprocess_key, require_owned_key
from src.aws_payload.serialization import make_envelope


@lru_cache(maxsize=1)
def payloads() -> SpeakUpPayloadStore:
    """Reuse the payload API and its bounded AWS clients on warm invocations."""

    return SpeakUpPayloadStore.from_environment()


def _scope(event: dict[str, Any]) -> tuple[str, str, str]:
    required = ("user_id", "project_id", "recording_id", "audio_s3_key")
    missing = [name for name in required if not event.get(name)]
    if missing:
        raise ValueError(f"Missing required fields: {', '.join(missing)}")
    user_id = str(event["user_id"])
    project_id = str(event["project_id"])
    recording_id = str(event["recording_id"])
    require_owned_key(
        str(event["audio_s3_key"]), user_id, project_id, recording_id
    )
    return user_id, project_id, recording_id


def _artifact_keys(
    user_id: str, project_id: str, recording_id: str, version: str
) -> dict[str, str]:
    result = {}
    for name, content_type in {
        "reference": "audio/wav",
        "enhanced_model": "audio/wav",
        "enhanced_blended": "audio/wav",
        "diagnostic": "audio/wav",
        "report": "application/json",
    }.items():
        result[name] = artifact_key(
            user_id,
            project_id,
            recording_id,
            producer="audio-prep",
            producer_version=version,
            artifact_name=name,
            content_type=content_type,
        )
    return result


def _existing_report(
    event: dict[str, Any], source_etag: str, config: AudioPrepConfig
) -> tuple[dict[str, Any], bool] | None:
    service = payloads()
    reference = service.objects.find_json(
        event["user_id"],
        event["project_id"],
        event["recording_id"],
        payload_type=PayloadType.PREPROCESS_REPORT,
        producer="audio-prep",
        producer_version=config.pipeline_version,
        artifact_name="report",
    )
    if reference is not None:
        document = service.objects.get_json(reference)
        report = document.get("data", {}).get("report")
        if isinstance(report, dict) and (
            report.get("source", {}).get("etag") == source_etag
            and report.get("config_fingerprint") == config.fingerprint()
        ):
            return report, False

    # Existing deployments used preprocess/{version}/report.json. Keep that
    # layout read-only so a rollout does not reprocess every prior recording.
    legacy_key = legacy_preprocess_key(
        event["user_id"],
        event["project_id"],
        event["recording_id"],
        pipeline_version=config.pipeline_version,
        filename="report.json",
    )
    try:
        response = service.factory.s3_client.get_object(
            Bucket=service.config.data_bucket, Key=legacy_key
        )
    except service.factory.s3_client.exceptions.NoSuchKey:
        return None
    with response["Body"] as body:
        report = json.loads(body.read())
    if (
        report.get("source", {}).get("etag") == source_etag
        and report.get("config_fingerprint") == config.fingerprint()
    ):
        return report, True
    return None


def _result(
    event: dict[str, Any], report: dict[str, Any], reused: bool, *, legacy: bool = False
) -> dict[str, Any]:
    if legacy:
        keys = {
            name: legacy_preprocess_key(
                event["user_id"],
                event["project_id"],
                event["recording_id"],
                pipeline_version=report["pipeline_version"],
                filename=filename,
            )
            for name, filename in {
                "reference": "reference.wav",
                "enhanced_model": "enhanced_model.wav",
                "enhanced_blended": "enhanced_blended.wav",
                "diagnostic": "diagnostic.wav",
                "report": "report.json",
            }.items()
        }
    else:
        keys = _artifact_keys(
            event["user_id"],
            event["project_id"],
            event["recording_id"],
            report["pipeline_version"],
        )
    return {
        **event,
        "reference_audio_s3_key": keys["reference"],
        "enhanced_model_audio_s3_key": keys["enhanced_model"],
        "enhanced_blended_audio_s3_key": keys["enhanced_blended"],
        "diagnostic_audio_s3_key": keys["diagnostic"],
        "enhanced_audio_s3_key": keys["diagnostic"],
        "transcription_audio_s3_key": keys["diagnostic"],
        "preprocess_report_s3_key": keys["report"],
        "preprocess_reused": reused,
        "preprocess_summary": {
            "pipeline_version": report["pipeline_version"],
            "selected_for_transcription": report["output"][
                "selected_for_transcription"
            ],
            "warnings": report["warnings"],
        },
    }


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Download, prepare, upload, and attach artifacts for one owned recording."""

    del context
    user_id, project_id, recording_id = _scope(event)
    service = payloads()
    config = AudioPrepConfig.from_environment()
    recording = service.get_recording(user_id, recording_id)
    source = service.factory.s3_client.head_object(
        Bucket=service.config.data_bucket, Key=event["audio_s3_key"]
    )
    maximum_upload_bytes = int(os.getenv("AUDIO_MAX_UPLOAD_BYTES", "104857600"))
    if int(source["ContentLength"]) > maximum_upload_bytes:
        raise ValueError(
            f"Audio object exceeds the {maximum_upload_bytes}-byte upload limit"
        )
    source_etag = str(source["ETag"]).strip('"')
    existing = _existing_report(event, source_etag, config)
    if existing is not None:
        report, legacy = existing
        return _result(event, report, reused=True, legacy=legacy)

    suffix = Path(str(event["audio_s3_key"])).suffix or ".audio"
    references = dict(recording.payload_refs)
    with tempfile.TemporaryDirectory(dir="/tmp") as temporary_directory:
        temporary = Path(temporary_directory)
        source_path = temporary / f"source{suffix}"
        output_directory = temporary / "prepared"
        service.factory.s3_client.download_file(
            service.config.data_bucket, event["audio_s3_key"], str(source_path)
        )
        artifacts = process_audio_file(
            source_path,
            output_directory,
            config,
            source_metadata={
                "s3_key": event["audio_s3_key"],
                "etag": source_etag,
                "content_length": int(source["ContentLength"]),
            },
        )
        report = json.loads(artifacts["report"].read_text(encoding="utf-8"))
        for artifact_name in (
            "reference",
            "enhanced_model",
            "enhanced_blended",
            "diagnostic",
        ):
            reference = service.objects.put_file(
                artifacts[artifact_name],
                user_id=user_id,
                project_id=project_id,
                recording_id=recording_id,
                payload_type=PayloadType.AUDIO_PREP_ARTIFACT,
                producer="audio-prep",
                producer_version=config.pipeline_version,
                artifact_name=artifact_name,
                content_type="audio/wav",
            )
            references[f"audio-prep.{artifact_name}.v1"] = reference.as_dict()
        report_document = make_envelope(
            PayloadType.PREPROCESS_REPORT,
            producer="audio-prep",
            producer_version=config.pipeline_version,
            data={"report": report},
            created_at=recording.created_at,
        )
        report_reference = service.objects.put_json(
            user_id,
            project_id,
            recording_id,
            payload_type=PayloadType.PREPROCESS_REPORT,
            producer="audio-prep",
            producer_version=config.pipeline_version,
            artifact_name="report",
            document=report_document,
        )
        references[PayloadType.PREPROCESS_REPORT.value] = (
            report_reference.as_dict()
        )

    result = _result(event, report, reused=False)
    service.recordings.patch(
        user_id,
        recording_id,
        expected_revision=recording.revision,
        updates={
            "audio_prep_status": "COMPLETE",
            "reference_audio_s3_key": result["reference_audio_s3_key"],
            "enhanced_audio_s3_key": result["enhanced_audio_s3_key"],
            "diagnostic_audio_s3_key": result["diagnostic_audio_s3_key"],
            "preprocess_report_s3_key": result["preprocess_report_s3_key"],
            "payload_refs": references,
        },
    )
    return result
