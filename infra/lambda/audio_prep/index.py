"""AWS Lambda adapter for the SpeakUp audio preparation library."""

from __future__ import annotations

from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import tempfile
from typing import Any, Mapping

from botocore.exceptions import ClientError

from src.audio.config import AudioPrepConfig
from src.audio.preprocess import process_audio_file
from src.aws_payload import PayloadType, SpeakUpPayloadStore
from src.aws_payload.errors import OwnershipViolationError
from src.aws_payload.keys import artifact_key, legacy_preprocess_key, require_owned_key
from src.aws_payload.serialization import make_envelope


@lru_cache(maxsize=1)
def payloads() -> SpeakUpPayloadStore:
    """Reuse the payload API and its bounded AWS clients on warm invocations."""

    return SpeakUpPayloadStore.from_environment()


_ARTIFACT_FILES: dict[str, tuple[str, str]] = {
    "reference": ("reference.wav", "audio/wav"),
    "enhanced_model": ("enhanced_model.wav", "audio/wav"),
    "enhanced_blended": ("enhanced_blended.wav", "audio/wav"),
    "diagnostic": ("diagnostic.wav", "audio/wav"),
    "report": ("report.json", "application/json"),
}


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
    for name, (_, content_type) in _ARTIFACT_FILES.items():
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


def _legacy_artifact_keys(
    user_id: str, project_id: str, recording_id: str, pipeline_version: str
) -> dict[str, str]:
    """Return the pre-versioned layout for compatibility-only reads."""

    return {
        name: legacy_preprocess_key(
            user_id,
            project_id,
            recording_id,
            pipeline_version=pipeline_version,
            filename=filename,
        )
        for name, (filename, _) in _ARTIFACT_FILES.items()
    }


def _existing_report(
    event: dict[str, Any], source_etag: str, config: AudioPrepConfig,
    source_version_id: str | None = None,
) -> tuple[dict[str, Any], bool, Any | None] | None:
    service = payloads()
    reference = service.objects.find_json(
        event["user_id"],
        event["project_id"],
        event["recording_id"],
        payload_type=PayloadType.PREPROCESS_REPORT,
        producer="audio-prep",
        producer_version=config.artifact_version(),
        artifact_name="report",
    )
    if reference is not None:
        document = service.objects.get_json(reference)
        report = document.get("data", {}).get("report")
        if isinstance(report, dict) and (
            report.get("source", {}).get("etag") == source_etag
            and report.get("source", {}).get("version_id") == source_version_id
            and report.get("config_fingerprint") == config.fingerprint()
            and report.get("producer_version") == config.artifact_version()
        ):
            return report, False, reference

    # Existing deployments used preprocess/{version}/report.json. Keep that
    # layout read-only for runs without an explicit build identity.
    if os.getenv("AUDIO_BUILD_DIGEST", "").strip():
        return None
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
        return report, True, None
    return None


def _artifact_exists(service: SpeakUpPayloadStore, key: str) -> Mapping[str, Any] | None:
    """Return S3 metadata for an artifact, or None when it is missing."""

    try:
        return service.factory.s3_client.head_object(
            Bucket=service.config.data_bucket, Key=key
        )
    except service.factory.s3_client.exceptions.NoSuchKey:
        return None
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code")
        status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        if code in {"NoSuchKey", "NotFound", "404"} or status == 404:
            return None
        raise


def _validated_audio_artifact(
    service: SpeakUpPayloadStore,
    key: str,
    *,
    user_id: str,
    project_id: str,
    recording_id: str,
    producer_version: str,
) -> Mapping[str, Any] | None:
    """Validate a reused WAV object before rebuilding its metadata reference."""

    require_owned_key(key, user_id, project_id, recording_id)
    # Prepared PCM can be larger than the compressed upload. Use the decoder's
    # memory cap plus room for the WAV container, not the upload byte limit.
    maximum_bytes = AudioPrepConfig.from_environment().max_decoded_bytes + 1024 * 1024
    metadata = _artifact_exists(service, key)
    if metadata is None:
        return None
    if (
        str(metadata.get("ContentType", "")) != "audio/wav"
        or int(metadata.get("ContentLength", 0)) < 1
        or int(metadata.get("ContentLength", 0)) > maximum_bytes
    ):
        return None
    object_metadata = metadata.get("Metadata", {})
    expected_metadata = {
        "payload-type": PayloadType.AUDIO_PREP_ARTIFACT.value,
        "producer": "audio-prep",
        "producer-version": producer_version,
        "recording-id": recording_id,
    }
    if any(object_metadata.get(name) != value for name, value in expected_metadata.items()):
        return None
    expected_sha256 = str(object_metadata.get("sha256", ""))
    if len(expected_sha256) != 64 or any(
        character not in "0123456789abcdef" for character in expected_sha256.lower()
    ):
        return None
    try:
        response = service.factory.s3_client.get_object(
            Bucket=service.config.data_bucket, Key=key
        )
    except service.factory.s3_client.exceptions.NoSuchKey:
        return None
    body = response["Body"]
    digest = hashlib.sha256()
    total = 0
    try:
        while True:
            chunk = body.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > maximum_bytes:
                return None
            digest.update(chunk)
    finally:
        body.close()
    if total != int(metadata["ContentLength"]) or digest.hexdigest() != expected_sha256.lower():
        return None
    return metadata


def _reuse_metadata(
    service: SpeakUpPayloadStore,
    recording: Any,
    event: dict[str, Any],
    report: dict[str, Any],
    keys: dict[str, str],
    report_reference: Any | None,
) -> bool:
    """Verify reused objects and repair missing recording metadata."""

    references = dict(recording.payload_refs)
    producer_version = report.get("producer_version", report["pipeline_version"])
    # Legacy objects do not carry the immutable metadata needed to prove their
    # identity. Regenerate them instead of attaching unverifiable content.
    if report_reference is None:
        return False
    for name in ("reference", "enhanced_model", "enhanced_blended", "diagnostic"):
        key = keys[name]
        metadata = _validated_audio_artifact(
            service,
            key,
            user_id=event["user_id"],
            project_id=event["project_id"],
            recording_id=event["recording_id"],
            producer_version=producer_version,
        )
        if metadata is None:
            return False
        ref_key = f"audio-prep.{name}.v1"
        if references.get(ref_key, {}).get("key") != key:
            references[ref_key] = {
                "user_id": event["user_id"],
                "project_id": event["project_id"],
                "recording_id": event["recording_id"],
                "key": key,
                "payload_type": PayloadType.AUDIO_PREP_ARTIFACT.value,
                "content_type": "audio/wav",
                "content_length": int(metadata.get("ContentLength", 0)),
                "sha256": str(metadata["Metadata"]["sha256"]).lower(),
                "producer": "audio-prep",
                "producer_version": producer_version,
                "schema_version": 1,
                "etag": str(metadata.get("ETag", "")).strip('"'),
                "version_id": metadata.get("VersionId"),
            }
    if report_reference.key != keys["report"]:
        return False
    report_ref_key = PayloadType.PREPROCESS_REPORT.value
    if references.get(report_ref_key, {}).get("key") != keys["report"]:
        references[report_ref_key] = (
            report_reference.as_dict()
            if hasattr(report_reference, "as_dict")
            else {
                "user_id": event["user_id"],
                "project_id": event["project_id"],
                "recording_id": event["recording_id"],
                "key": keys["report"],
                "payload_type": PayloadType.PREPROCESS_REPORT.value,
                "content_type": "application/json",
                "content_length": 0,
                "sha256": "",
                "producer": "audio-prep",
                "producer_version": report.get("producer_version", report["pipeline_version"]),
                "schema_version": 1,
            }
        )
    expected_fields = {
        "audio_prep_status": "COMPLETE",
        "reference_audio_s3_key": keys["reference"],
        "enhanced_audio_s3_key": keys["diagnostic"],
        "diagnostic_audio_s3_key": keys["diagnostic"],
        "preprocess_report_s3_key": keys["report"],
    }
    if (references == recording.payload_refs and all(
        getattr(recording, name, None) == value
        for name, value in expected_fields.items()
    )):
        return True
    service.recordings.patch(
        event["user_id"],
        event["recording_id"],
        expected_revision=recording.revision,
        updates={**expected_fields, "payload_refs": references},
    )
    return True


def _result(
    event: dict[str, Any], report: dict[str, Any], reused: bool, *, legacy: bool = False
) -> dict[str, Any]:
    if legacy:
        keys = _legacy_artifact_keys(
            event["user_id"], event["project_id"], event["recording_id"],
            report["pipeline_version"],
        )
    else:
        keys = _artifact_keys(
            event["user_id"],
            event["project_id"],
            event["recording_id"],
            report.get("producer_version", report["pipeline_version"]),
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
    if recording.project_id != project_id or recording.original_s3_key != event["audio_s3_key"]:
        raise OwnershipViolationError(
            "Audio-prep event does not match the persisted recording scope"
        )
    original_ref = recording.payload_refs.get(PayloadType.ORIGINAL_AUDIO.value, {})
    if original_ref and original_ref.get("key") != event["audio_s3_key"]:
        raise OwnershipViolationError("Stored original payload does not match workflow source")
    source_version_id = original_ref.get("version_id") if isinstance(original_ref, dict) else None
    source_params = {"Bucket": service.config.data_bucket, "Key": event["audio_s3_key"]}
    if source_version_id:
        source_params["VersionId"] = source_version_id
    source = service.factory.s3_client.head_object(**source_params)
    maximum_upload_bytes = int(os.getenv("AUDIO_MAX_UPLOAD_BYTES", "104857600"))
    if int(source["ContentLength"]) > maximum_upload_bytes:
        raise ValueError(
            f"Audio object exceeds the {maximum_upload_bytes}-byte upload limit"
        )
    source_etag = str(source["ETag"]).strip('"')
    source_version_id = source.get("VersionId", source_version_id)
    existing = _existing_report(event, source_etag, config, source_version_id)
    if existing is not None:
        report, legacy, report_reference = existing
        keys = _artifact_keys(
            event["user_id"], event["project_id"], event["recording_id"],
            report.get("producer_version", config.artifact_version())
        )
        if legacy:
            keys = _legacy_artifact_keys(
                event["user_id"], event["project_id"], event["recording_id"],
                report["pipeline_version"],
            )
        if _reuse_metadata(service, recording, event, report, keys, report_reference):
            return _result(event, report, reused=True, legacy=legacy)

    suffix = Path(str(event["audio_s3_key"])).suffix or ".audio"
    references = dict(recording.payload_refs)
    with tempfile.TemporaryDirectory(
        dir=tempfile.gettempdir()
    ) as temporary_directory:
        temporary = Path(temporary_directory)
        source_path = temporary / f"source{suffix}"
        output_directory = temporary / "prepared"
        download_args = {}
        if source_version_id:
            download_args["ExtraArgs"] = {"VersionId": source_version_id}
        service.factory.s3_client.download_file(
            service.config.data_bucket, event["audio_s3_key"], str(source_path), **download_args
        )
        artifacts = process_audio_file(
            source_path,
            output_directory,
            config,
            source_metadata={
                "s3_key": event["audio_s3_key"],
                "etag": source_etag,
                "version_id": source_version_id,
                "content_length": int(source["ContentLength"]),
            },
        )
        report = json.loads(artifacts["report"].read_text(encoding="utf-8"))
        report.setdefault("producer_version", config.artifact_version())
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
                producer_version=config.artifact_version(),
                artifact_name=artifact_name,
                content_type="audio/wav",
            )
            references[f"audio-prep.{artifact_name}.v1"] = reference.as_dict()
        report_document = make_envelope(
            PayloadType.PREPROCESS_REPORT,
            producer="audio-prep",
            producer_version=config.artifact_version(),
            data={"report": report},
            created_at=recording.created_at,
        )
        report_reference = service.objects.put_json(
            user_id,
            project_id,
            recording_id,
            payload_type=PayloadType.PREPROCESS_REPORT,
            producer="audio-prep",
            producer_version=config.artifact_version(),
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
