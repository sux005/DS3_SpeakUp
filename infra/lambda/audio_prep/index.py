"""AWS Lambda adapter for the SpeakUp audio preparation library."""

from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
from typing import Any

import boto3
from botocore.config import Config

from src.audio.config import AudioPrepConfig
from src.audio.preprocess import process_audio_file


sdk_config = Config(
    retries={"total_max_attempts": 3, "mode": "adaptive"},
    connect_timeout=5,
    read_timeout=60,
)
s3 = boto3.client("s3", config=sdk_config)
table = boto3.resource("dynamodb", config=sdk_config).Table(
    os.environ["RECORDINGS_TABLE"]
)
bucket = os.environ["DATA_BUCKET"]


def _prefix(event: dict[str, Any]) -> str:
    required = ("user_id", "project_id", "recording_id", "audio_s3_key")
    missing = [name for name in required if not event.get(name)]
    if missing:
        raise ValueError(f"Missing required fields: {', '.join(missing)}")
    prefix = (
        f"users/{event['user_id']}/projects/{event['project_id']}/"
        f"recordings/{event['recording_id']}/"
    )
    if not str(event["audio_s3_key"]).startswith(prefix):
        raise ValueError("Audio key does not belong to the requested recording")
    return prefix


def _existing_report(
    report_key: str, source_etag: str, config: AudioPrepConfig
) -> dict[str, Any] | None:
    try:
        response = s3.get_object(Bucket=bucket, Key=report_key)
    except s3.exceptions.NoSuchKey:
        return None
    with response["Body"] as body:
        report = json.loads(body.read())
    if (
        report.get("source", {}).get("etag") == source_etag
        and report.get("config_fingerprint") == config.fingerprint()
    ):
        return report
    return None


def _result(
    event: dict[str, Any], prefix: str, report: dict[str, Any], reused: bool
) -> dict[str, Any]:
    base = f"{prefix}preprocess/{report['pipeline_version']}"
    reference_key = f"{base}/reference.wav"
    model_key = f"{base}/enhanced_model.wav"
    blended_key = f"{base}/enhanced_blended.wav"
    diagnostic_key = f"{base}/diagnostic.wav"
    selected = report["output"]["selected_for_transcription"]
    return {
        **event,
        "reference_audio_s3_key": reference_key,
        "enhanced_model_audio_s3_key": model_key,
        "enhanced_blended_audio_s3_key": blended_key,
        "diagnostic_audio_s3_key": diagnostic_key,
        "enhanced_audio_s3_key": diagnostic_key,
        "transcription_audio_s3_key": diagnostic_key,
        "preprocess_report_s3_key": f"{base}/report.json",
        "preprocess_reused": reused,
        "preprocess_summary": {
            "pipeline_version": report["pipeline_version"],
            "selected_for_transcription": selected,
            "warnings": report["warnings"],
        },
    }


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Download, prepare, upload, and record artifacts for one owned recording."""

    del context
    prefix = _prefix(event)
    config = AudioPrepConfig.from_environment()
    source = s3.head_object(Bucket=bucket, Key=event["audio_s3_key"])
    maximum_upload_bytes = int(os.getenv("AUDIO_MAX_UPLOAD_BYTES", "104857600"))
    if int(source["ContentLength"]) > maximum_upload_bytes:
        raise ValueError(
            f"Audio object exceeds the {maximum_upload_bytes}-byte upload limit"
        )
    source_etag = str(source["ETag"]).strip('"')
    base = f"{prefix}preprocess/{config.pipeline_version}"
    report_key = f"{base}/report.json"
    existing = _existing_report(report_key, source_etag, config)
    if existing is not None:
        return _result(event, prefix, existing, reused=True)

    suffix = Path(str(event["audio_s3_key"])).suffix or ".audio"
    with tempfile.TemporaryDirectory(dir="/tmp") as temporary_directory:
        temporary = Path(temporary_directory)
        source_path = temporary / f"source{suffix}"
        output_directory = temporary / "prepared"
        s3.download_file(bucket, event["audio_s3_key"], str(source_path))
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
        uploads = {
            "reference": (f"{base}/reference.wav", "audio/wav"),
            "enhanced_model": (f"{base}/enhanced_model.wav", "audio/wav"),
            "enhanced_blended": (
                f"{base}/enhanced_blended.wav",
                "audio/wav",
            ),
            "diagnostic": (f"{base}/diagnostic.wav", "audio/wav"),
            "report": (report_key, "application/json"),
        }
        for artifact_name, (object_key, content_type) in uploads.items():
            s3.upload_file(
                str(artifacts[artifact_name]),
                bucket,
                object_key,
                ExtraArgs={
                    "ContentType": content_type,
                    "ServerSideEncryption": "AES256",
                    "Metadata": {
                        "source-etag": source_etag,
                        "pipeline-version": report["pipeline_version"],
                        "config-fingerprint": report["config_fingerprint"],
                        "artifact-role": artifact_name,
                    },
                },
            )

    result = _result(event, prefix, report, reused=False)
    table.update_item(
        Key={"user_id": event["user_id"], "recording_id": event["recording_id"]},
        UpdateExpression=(
            "SET audio_prep_status=:status, reference_audio_s3_key=:reference, "
            "enhanced_audio_s3_key=:enhanced, diagnostic_audio_s3_key=:diagnostic, "
            "preprocess_report_s3_key=:report"
        ),
        ExpressionAttributeValues={
            ":status": "COMPLETE",
            ":reference": result["reference_audio_s3_key"],
            ":enhanced": result["enhanced_audio_s3_key"],
            ":diagnostic": result["diagnostic_audio_s3_key"],
            ":report": result["preprocess_report_s3_key"],
        },
    )
    return result
