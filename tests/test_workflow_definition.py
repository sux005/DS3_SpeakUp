"""Contract tests for the deployed Step Functions processing workflow."""

from __future__ import annotations

import json
from pathlib import Path

import pytest


TEMPLATE = Path(__file__).parents[1] / "infra" / "speakup.yaml"


def workflow_definition() -> dict:
    lines = TEMPLATE.read_text(encoding="utf-8").splitlines()
    marker = "      DefinitionString: !Sub |"
    start = lines.index(marker) + 1
    body: list[str] = []
    for line in lines[start:]:
        if line and not line.startswith("        "):
            break
        body.append(line[8:] if line else line)
    return json.loads("\n".join(body))


def test_workflow_starts_with_preparation_and_has_terminal_states():
    definition = workflow_definition()
    assert definition["StartAt"] == "PreprocessAudio"
    assert definition["States"]["Complete"] == {"Type": "Succeed"}
    assert definition["States"]["Failed"]["Type"] == "Fail"


def test_success_path_preserves_the_processing_stage_order():
    states = workflow_definition()["States"]
    assert states["PreprocessAudio"]["Next"] == "StartTranscription"
    assert states["StartTranscription"]["Next"] == "WaitForTranscribe"
    assert states["WaitForTranscribe"]["Next"] == "CheckTranscription"
    assert states["CheckTranscription"]["Next"] == "TranscriptionStatus"
    assert states["TranscriptionStatus"]["Choices"][0]["Next"] == "AnalyzeSpeech"
    assert states["AnalyzeSpeech"]["Next"] == "GenerateFeedback"
    assert states["GenerateFeedback"]["Next"] == "Complete"


def test_audio_preparation_has_model_runtime_headroom():
    state = workflow_definition()["States"]["PreprocessAudio"]
    assert state["TimeoutSeconds"] == 630

    template = TEMPLATE.read_text(encoding="utf-8")
    audio_block = template.split("  AudioPrepFunction:", 1)[1].split(
        "  FailureFunction:", 1
    )[0]
    assert "Architectures: [x86_64]" in audio_block
    assert "MemorySize: 3008" in audio_block
    assert "Timeout: 600" in audio_block


@pytest.mark.parametrize(
    ("state_name", "action", "required_fields"),
    [
        ("StartTranscription", "start", {"user_id.$", "recording_id.$", "project_id.$", "audio_s3_key.$"}),
        ("CheckTranscription", "status", {"user_id.$", "recording_id.$", "project_id.$", "audio_s3_key.$", "transcription_job_name.$", "transcript_s3_key.$"}),
        ("AnalyzeSpeech", "analyze", {"user_id.$", "recording_id.$", "project_id.$", "audio_s3_key.$", "transcription_job_name.$", "transcript_s3_key.$"}),
        ("GenerateFeedback", "feedback", {"user_id.$", "recording_id.$", "project_id.$", "audio_s3_key.$", "transcript_s3_key.$", "analysis_s3_key.$", "summary_metrics.$"}),
    ],
)
def test_processor_state_passes_owner_recording_and_stage_inputs(state_name, action, required_fields):
    state = workflow_definition()["States"][state_name]
    payload = state["Parameters"]["Payload"]
    assert payload["action"] == action
    assert required_fields <= payload.keys()
    assert state["OutputPath"] == "$.Payload"


@pytest.mark.parametrize("state_name", ["PreprocessAudio", "StartTranscription", "CheckTranscription", "AnalyzeSpeech", "GenerateFeedback"])
def test_recoverable_processing_task_has_retry_and_failure_route(state_name):
    state = workflow_definition()["States"][state_name]
    assert state["Retry"]
    assert state["Catch"] == [{"ErrorEquals": ["States.ALL"], "ResultPath": "$.error", "Next": "MarkFailed"}]


def test_transcription_status_routes_failed_jobs_to_mark_failed():
    state = workflow_definition()["States"]["TranscriptionStatus"]
    assert {choice["StringEquals"] for choice in state["Choices"] if "StringEquals" in choice} == {"COMPLETED", "FAILED"}
    failed = next(choice for choice in state["Choices"] if choice["StringEquals"] == "FAILED")
    assert failed["Next"] == "MarkFailed"
    assert state["Default"] == "WaitForTranscribe"


def test_transcription_polling_has_a_bounded_exit():
    states = workflow_definition()["States"]
    assert "poll_attempts.$" in states["CheckTranscription"]["Parameters"]["Payload"]
    assert any(choice.get("Next") == "MarkFailed" for choice in states["TranscriptionStatus"]["Choices"])


def test_mark_failed_retries_transient_state_write_errors():
    assert workflow_definition()["States"]["MarkFailed"]["Retry"]


def test_mark_failed_passes_full_recording_and_execution_scope():
    payload = workflow_definition()["States"]["MarkFailed"]["Parameters"]["Payload"]
    assert payload["project_id.$"] == "$.project_id"
    assert payload["execution_arn.$"] == "$$.Execution.Id"


def test_api_role_can_inspect_its_execution_and_audio_image_is_digest_pinned():
    template = TEMPLATE.read_text(encoding="utf-8")
    assert "Action: states:DescribeExecution" in template
    assert "execution:${AWS::StackName}-processing:*" in template
    assert "@sha256:[0-9a-f]{64}" in template


def test_zip_deployments_are_version_pinned_and_processor_identity_is_immutable():
    template = TEMPLATE.read_text(encoding="utf-8")
    assert "ApiCodeS3Version" in template
    assert "ProcessorCodeS3Version" in template
    assert "FailureCodeS3Version" in template
    assert "S3ObjectVersion: !Ref ApiCodeS3Version" in template
    assert "S3ObjectVersion: !Ref ProcessorCodeS3Version" in template
    assert "S3ObjectVersion: !Ref FailureCodeS3Version" in template
    assert "PROCESSOR_BUILD_ID: !Sub '${ProcessorCodeS3Key}:${ProcessorCodeS3Version}'" in template


def test_infrastructure_has_actionable_observability_and_production_guards():
    template = TEMPLATE.read_text(encoding="utf-8")
    assert "AlarmTopicArn" in template
    assert "AlarmActions: !If [HasAlarmTopic" in template
    assert "ApiFunctionErrorAlarm" in template
    assert "ProcessorFunctionErrorAlarm" in template
    assert "ProcessingStateMachineFailureAlarm" in template
    assert "DeletionProtectionEnabled: !If [IsProduction, true, false]" in template
    assert "ProductionParameters" in template
    assert "xray:PutTraceSegments" in template
    assert "s3:GetObjectVersion" in template
    assert "execution:${AWS::StackName}-processing:*'" in template
    assert "TimeoutInMillis: 29000" in template
    assert "AWS_READ_TIMEOUT_SECONDS: '3'" in template
    assert "AWS_READ_TIMEOUT_SECONDS: '20'" in template


def test_admission_and_maintenance_contracts_are_wired():
    template = TEMPLATE.read_text(encoding="utf-8")
    assert "WorkflowAdmissionsTable:" in template
    assert "MAX_ACTIVE_WORKFLOWS: !Ref MaxActiveWorkflows" in template
    assert "MaintenanceDueIndex" in template
    assert "maintenance_partition" in template
    assert "MaintenanceCleanupRule" in template
    assert "MaintenanceFunction" in template
    assert "MaintenanceCodeS3Version" in template
    assert "s3:DeleteObjectVersion" in template
    assert "MAINTENANCE_SHARD_COUNT: '8'" in template


def test_original_upload_automatically_starts_idempotent_processing():
    template = TEMPLATE.read_text(encoding="utf-8")
    assert "EventBridgeConfiguration: {EventBridgeEnabled: true}" in template
    assert "UploadCompletedRule:" in template
    assert "detail-type: ['Object Created']" in template
    for extension in ("wav", "mp3", "m4a", "ogg", "webm"):
        assert f"suffix: '/original.{extension}'" in template
    assert "Handler: index.upload_handler" in template
    assert "DeadLetterConfig: {Arn: !GetAtt WorkflowFailureDeadLetterQueue.Arn}" in template
    assert "RetryPolicy: {MaximumEventAgeInSeconds: 86400, MaximumRetryAttempts: 8}" in template
    assert "UploadTriggerInvokeConfig:" in template
    assert "MaximumRetryAttempts: 2" in template
    assert "OnFailure: {Destination: !GetAtt WorkflowFailureDeadLetterQueue.Arn}" in template
    assert "UploadTriggerFunctionErrorAlarm:" in template


def test_processing_roles_can_resolve_missing_retry_artifacts_and_feedback_is_gated():
    template = TEMPLATE.read_text(encoding="utf-8")
    assert template.count("Action: s3:ListBucket") >= 2
    assert "EnableBedrockFeedback:" in template
    assert "Default: 'false'" in template
    assert "ENABLE_BEDROCK_FEEDBACK: !Ref EnableBedrockFeedback" in template


def test_migrations_have_safe_defaults_and_production_alarm_guard():
    template = TEMPLATE.read_text(encoding="utf-8")
    assert "EnforceWorkflowAdmissions:" in template
    assert "Default: 'false'" in template
    assert "ENFORCE_WORKFLOW_ADMISSIONS: !Ref EnforceWorkflowAdmissions" in template
    assert "MAINTENANCE_DISCOVERY_MODE: dual" in template
    assert "RECONCILE_RECHECK_SECONDS: '300'" in template
    assert "CLEANUP_RETRY_SECONDS: '600'" in template
    assert "CLEANUP_RECHECK_SECONDS: '600'" in template
    assert "Production requires an alarm notification topic." in template
