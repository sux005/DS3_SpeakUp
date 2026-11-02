from importlib.util import module_from_spec, spec_from_file_location
import base64
import hashlib
import json
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

from src.aws_payload.models import Project, Recording, RecordingStatus, UploadIntent


def load_handler_module():
    path = Path("infra/lambda/api/index.py").resolve()
    spec = spec_from_file_location("speakup_api_handler_test", path)
    module = module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def authenticated_event(route, *, body="{}", path=None, query=None):
    return {
        "routeKey": route,
        "body": body,
        "pathParameters": path or {},
        "queryStringParameters": query,
        "requestContext": {
            "requestId": "request-1",
            "authorizer": {"jwt": {"claims": {"sub": "user-1"}}},
        },
    }


def test_health_does_not_require_aws_configuration():
    module = load_handler_module()
    response = module.handler({"routeKey": "GET /health"}, None)
    assert response["statusCode"] == 200
    assert json.loads(response["body"])["status"] == "ok"


def test_protected_route_requires_authenticated_subject():
    module = load_handler_module()
    response = module.handler({"routeKey": "GET /projects"}, None)
    assert response["statusCode"] == 401


def test_account_limits_is_frontend_ready(monkeypatch):
    module = load_handler_module()
    monkeypatch.setattr(
        module,
        "payloads",
        lambda: SimpleNamespace(
            workflow_limits=lambda user_id: {
                "active": 2, "limit": 3, "remaining": 1
            },
            config=SimpleNamespace(
                enforce_workflow_admissions=True,
                max_audio_upload_bytes=104857600,
                abandoned_retention_days=7,
                recovery_days=30,
            ),
        ),
    )
    response = module.handler(authenticated_event("GET /account/limits"), None)
    assert response["statusCode"] == 200
    assert json.loads(response["body"]) == {
        "active_workflows": 2,
        "max_active_workflows": 3,
        "remaining_workflows": 1,
        "admission_enforced": True,
        "max_audio_upload_bytes": 104857600,
        "max_audio_duration_seconds": 600,
        "abandoned_retention_days": 7,
        "deleted_recovery_days": 30,
    }


def test_active_workflow_limit_has_stable_frontend_error(monkeypatch):
    from src.aws_payload.errors import ActiveWorkflowLimitError

    module = load_handler_module()
    monkeypatch.setattr(
        module, "_dispatch",
        lambda event: (_ for _ in ()).throw(ActiveWorkflowLimitError("limit")),
    )
    response = module.handler(authenticated_event("POST /recordings/{recordingId}/process"), None)
    assert response["statusCode"] == 429
    assert response["headers"]["retry-after"] == "60"
    assert json.loads(response["body"]) == {
        "code": "ACTIVE_WORKFLOW_LIMIT",
        "message": "active workflow limit reached",
        "retryable": True,
    }


def test_create_project_delegates_to_owner_scoped_service(monkeypatch):
    module = load_handler_module()

    class FakeStore:
        def create_project(self, user_id, **kwargs):
            assert user_id == "user-1"
            return Project(
                user_id,
                kwargs["project_id"],
                kwargs["project_title"],
                kwargs["description"],
                "2026-10-27T12:00:00.000Z",
                "2026-10-27T12:00:00.000Z",
            )

    monkeypatch.setattr(module, "payloads", lambda: FakeStore())
    response = module.handler(
        authenticated_event(
            "POST /projects",
            body=json.dumps(
                {
                    "project_id": "project-1",
                    "project_title": "Demo",
                    "description": "Practice",
                }
            ),
        ),
        None,
    )
    assert response["statusCode"] == 201
    assert json.loads(response["body"])["project_id"] == "project-1"


def test_upload_route_requires_length_and_passes_it_to_reservation(monkeypatch):
    module = load_handler_module()
    checksum = base64.b64encode(hashlib.sha256(b"audio").digest()).decode()
    calls = []

    class FakeStore:
        config = SimpleNamespace(max_audio_upload_bytes=100)

        def get_project(self, user_id, project_id):
            return object()

        def reserve_upload(self, user_id, project_id, content_type, **kwargs):
            calls.append(kwargs)
            recording = Recording(
                user_id, project_id, "recording-1", "2026-01-01T00:00:00Z",
                "2026-01-01T00:00:00Z",
            )
            intent = UploadIntent(
                user_id, project_id, "recording-1", "object-key", content_type,
                "2026-01-01T00:15:00Z", "https://example.invalid/upload",
                expected_content_length=5, max_content_length=100,
            )
            return recording, intent

    monkeypatch.setattr(module, "payloads", lambda: FakeStore())
    monkeypatch.setattr(module, "duplicate_recording_id", lambda *args: None)
    body = {"project_id": "project-1", "content_type": "audio/wav", "sha256": checksum}
    missing = module.handler(authenticated_event("POST /uploads", body=json.dumps(body)), None)
    assert missing["statusCode"] == 400
    body["content_length"] = 5
    accepted = module.handler(authenticated_event("POST /uploads", body=json.dumps(body)), None)
    assert accepted["statusCode"] == 201
    assert calls[0]["content_length"] == 5
    assert json.loads(accepted["body"])["max_content_length"] == 100
    body["idempotency_key"] = "x" * 37
    rejected = module.handler(authenticated_event("POST /uploads", body=json.dumps(body)), None)
    assert rejected["statusCode"] == 400
    assert len(calls) == 1


def test_upload_route_rejects_recording_id_that_breaks_idempotency(monkeypatch):
    module = load_handler_module()
    checksum = base64.b64encode(hashlib.sha256(b"audio").digest()).decode()

    class Store:
        config = SimpleNamespace(max_audio_upload_bytes=100)

        def get_project(self, *args):
            return object()

        def reserve_upload(self, *args, **kwargs):
            raise AssertionError("reservation must not run for mismatched id")

    monkeypatch.setattr(module, "payloads", lambda: Store())
    body = {
        "project_id": "project-1",
        "content_type": "audio/wav",
        "sha256": checksum,
        "content_length": 5,
        "recording_id": "client-chosen-id",
    }
    response = module.handler(
        authenticated_event("POST /uploads", body=json.dumps(body)), None
    )
    assert response["statusCode"] == 400


def test_api_rejects_malformed_body_and_noninteger_page_limit(monkeypatch):
    module = load_handler_module()
    monkeypatch.setattr(module, "payloads", lambda: SimpleNamespace())
    for body in ("{broken", "[]"):
        response = module.handler(authenticated_event("POST /projects", body=body), None)
        assert response["statusCode"] == 400

    class Store:
        def list_projects(self, *args, **kwargs):
            raise AssertionError("invalid limit must fail before querying")

    monkeypatch.setattr(module, "payloads", lambda: Store())
    for limit in ("1.5", True, [], {}):
        response = module.handler(
            authenticated_event("GET /projects", query={"limit": limit}), None
        )
        assert response["statusCode"] == 400


def test_public_recording_shape_excludes_storage_and_workflow_details(monkeypatch):
    module = load_handler_module()
    recording = Recording(
        "user-1", "project-1", "recording-1", "2026-01-01T00:00:00Z",
        "2026-01-01T00:01:00Z", status=RecordingStatus.COMPLETE,
        content_type="audio/wav", content_length=12,
        original_s3_key="users/user-1/projects/project-1/recordings/recording-1/original.wav",
        payload_refs={"original-audio.v1": {"key": "private-key"}},
        execution_arn="arn:aws:states:us-east-2:123:execution:test:private",
        transcription_job_name="private-job", raw_transcript_s3_key="private-transcript",
        summary_metrics={"word_count": 4}, feedback_s3_key="private-feedback",
    )
    monkeypatch.setattr(
        module, "payloads",
        lambda: SimpleNamespace(get_recording=lambda *_: recording),
    )
    response = module.handler(
        authenticated_event("GET /recordings/{recordingId}", path={"recordingId": "recording-1"}),
        None,
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["recording_id"] == "recording-1"
    assert body["summary_metrics"] == {"word_count": 4}
    for private_field in (
        "original_s3_key", "audio_s3_key", "payload_refs", "execution_arn",
        "transcription_job_name", "raw_transcript_s3_key", "feedback_s3_key",
    ):
        assert private_field not in body


def test_public_failure_reason_does_not_expose_worker_exception():
    module = load_handler_module()
    recording = Recording(
        "user-1", "project-1", "recording-1", "2026-01-01T00:00:00Z",
        "2026-01-01T00:01:00Z", status=RecordingStatus.FAILED,
        failure_reason="S3 object users/user-1/private-key failed: internal trace",
    )
    body = module._recording_body(recording)
    assert body["failure_reason"] == "Processing failed"


def test_public_metrics_are_json_numbers():
    module = load_handler_module()
    recording = Recording(
        "user-1", "project-1", "recording-1", "2026-01-01T00:00:00Z",
        "2026-01-01T00:01:00Z", status=RecordingStatus.COMPLETE,
        summary_metrics={"word_count": Decimal("12"), "words_per_minute": Decimal("123.4")},
    )
    body = json.loads(module.reply(200, module._recording_body(recording))["body"])
    assert body["summary_metrics"] == {"word_count": 12, "words_per_minute": 123.4}


def test_public_recording_exposes_rubric_scores_and_pause_details():
    module = load_handler_module()
    recording = Recording(
        "user-1", "project-1", "recording-1", "2026-01-01T00:00:00Z",
        "2026-01-01T00:02:00Z", status=RecordingStatus.COMPLETE,
        summary_metrics={
            "rubric_version": "2026-10-31", "rubric_status": "scored",
            "rubric_scores": {"speaking_rate": Decimal("4"),
                              "filler_words": Decimal("3"),
                              "pauses_inside_sentences": Decimal("2")},
            "long_pauses": [{"start_seconds": Decimal("12.5"),
                             "duration_seconds": Decimal("1.2"),
                             "inside_sentence": True}],
        },
    )
    body = json.loads(module.reply(200, module._recording_body(recording))["body"])
    assert body["summary_metrics"]["rubric_scores"] == {
        "speaking_rate": 4, "filler_words": 3, "pauses_inside_sentences": 2,
    }
    assert body["summary_metrics"]["long_pauses"][0]["duration_seconds"] == 1.2
