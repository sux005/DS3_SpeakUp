"""Local execution simulations for the deployed Step Functions workflow.

These tests intentionally use the checked-in ASL definition and fake Lambda
responses. They prove state wiring and bounded control flow without AWS access.
"""

from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
from typing import Any

import pytest


TEMPLATE = Path(__file__).parents[1] / "infra" / "speakup.yaml"
SIMULATED_EXECUTION_ARN = "arn:aws:states:us-east-2:123:execution:test:simulation"


def workflow_definition() -> dict[str, Any]:
    lines = TEMPLATE.read_text(encoding="utf-8").splitlines()
    start = lines.index("      DefinitionString: !Sub |") + 1
    body: list[str] = []
    for line in lines[start:]:
        if line and not line.startswith("        "):
            break
        body.append(line[8:] if line else line)
    return json.loads("\n".join(body))


def _path_get(document: dict[str, Any], expression: str) -> Any:
    if expression == "$$.Execution.Id":
        return SIMULATED_EXECUTION_ARN
    value: Any = document
    for part in expression[2:].split("."):
        value = value[part]
    return value


def _parameters(template: Any, state: dict[str, Any]) -> Any:
    if isinstance(template, dict):
        result = {}
        for key, value in template.items():
            if key.endswith(".$"):
                output_key = key[:-2]
                if isinstance(value, str) and value.startswith("States.JsonToString("):
                    expression = value[len("States.JsonToString(") : -1]
                    result[output_key] = json.dumps(_path_get(state, expression))
                else:
                    result[output_key] = _path_get(state, value)
            else:
                result[key] = _parameters(value, state)
        return result
    if isinstance(template, list):
        return [_parameters(value, state) for value in template]
    return template


class WorkflowSimulation:
    """Small ASL runner for the task, choice, wait, and terminal states used here."""

    def __init__(self, *, poll_statuses: list[str], failures: set[str] | None = None):
        self.definition = workflow_definition()
        self.states = self.definition["States"]
        self.poll_statuses = iter(poll_statuses)
        self.failures = failures or set()
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.mark_failed_calls = 0

    def _lambda(self, state_name: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.calls.append((state_name, deepcopy(payload)))
        if state_name == "MarkFailed":
            self.mark_failed_calls += 1
        if state_name in self.failures:
            raise RuntimeError(f"{state_name} failed")
        if state_name == "PreprocessAudio":
            return {
                **payload,
                "transcription_audio_s3_key": "users/u/p/r/artifacts/diagnostic.wav",
            }
        if state_name == "StartTranscription":
            return {
                **payload,
                "transcription_job_name": "test-job",
                "transcript_s3_key": "users/u/p/r/artifacts/transcript.json",
                "poll_attempts": 0,
            }
        if state_name == "CheckTranscription":
            attempts = int(payload.get("poll_attempts", 0)) + 1
            status = next(self.poll_statuses)
            return {**payload, "poll_attempts": attempts,
                    "transcribe_status": status,
                    "error": ("Transcription polling limit exceeded"
                              if status == "IN_PROGRESS" and attempts >= 80
                              else "Transcription job failed")}
        if state_name == "AnalyzeSpeech":
            return {**payload, "analysis_s3_key": "analysis.json",
                    "summary_metrics": {"word_count": 3}}
        if state_name == "GenerateFeedback":
            return {**payload, "status": "COMPLETE"}
        if state_name == "MarkFailed":
            return {**payload, "status": "FAILED"}
        raise AssertionError(f"unexpected task {state_name}")

    def run(self, initial: dict[str, Any], *, max_steps: int = 400) -> tuple[str, dict[str, Any]]:
        state_name = self.definition["StartAt"]
        state = deepcopy(initial)
        for _ in range(max_steps):
            definition = self.states[state_name]
            state_type = definition["Type"]
            if state_type == "Task":
                payload = _parameters(definition["Parameters"]["Payload"], state)
                attempts = 0
                routed_to_catch = False
                while True:
                    attempts += 1
                    try:
                        state = self._lambda(state_name, payload)
                        break
                    except RuntimeError:
                        retry = definition.get("Retry", [])
                        max_retries = retry[0]["MaxAttempts"] if retry else 0
                        if attempts > max_retries:
                            catch = definition.get("Catch", [])
                            if not catch:
                                return "FAILED", state
                            state["error"] = {"Error": "States.TaskFailed", "Cause": f"{state_name} failed"}
                            state_name = catch[0]["Next"]
                            routed_to_catch = True
                            break
                if routed_to_catch:
                    continue
                state_name = definition["Next"]
                continue
            elif state_type == "Wait":
                state_name = definition["Next"]
            elif state_type == "Choice":
                target = None
                for choice in definition["Choices"]:
                    if "StringEquals" in choice and state.get(choice["Variable"][2:]) == choice["StringEquals"]:
                        target = choice["Next"]
                        break
                    if "NumericGreaterThanEquals" in choice:
                        key = choice["Variable"][2:]
                        if state.get(key, 0) >= choice["NumericGreaterThanEquals"]:
                            target = choice["Next"]
                            break
                state_name = target or definition["Default"]
            elif state_type == "Succeed":
                return "SUCCEEDED", state
            elif state_type == "Fail":
                return "FAILED", state
            else:  # pragma: no cover
                raise AssertionError(f"unsupported state type {state_type}")
        raise AssertionError("workflow exceeded simulation step bound")


def initial_input() -> dict[str, str]:
    return {"user_id": "u", "project_id": "p", "recording_id": "r",
            "audio_s3_key": "users/u/projects/p/recordings/r/original.wav"}


def test_success_path_completes_when_transcription_finishes_on_eightieth_poll():
    statuses = ["IN_PROGRESS"] * 79 + ["COMPLETED"]
    result, state = WorkflowSimulation(poll_statuses=statuses).run(initial_input())

    assert result == "SUCCEEDED"
    assert state["summary_metrics"] == {"word_count": 3}


def test_always_in_progress_transcription_reaches_mark_failed_at_poll_bound():
    simulation = WorkflowSimulation(poll_statuses=["IN_PROGRESS"] * 80)

    result, state = simulation.run(initial_input())

    assert result == "FAILED"
    assert simulation.mark_failed_calls == 1
    checks = [payload for name, payload in simulation.calls if name == "CheckTranscription"]
    assert len(checks) == 80
    assert checks[-1]["poll_attempts"] == 79
    assert state["status"] == "FAILED"


@pytest.mark.parametrize("failed_state", ["PreprocessAudio", "StartTranscription", "AnalyzeSpeech", "GenerateFeedback"])
def test_task_failure_routes_to_mark_failed_with_safe_error(failed_state: str):
    simulation = WorkflowSimulation(poll_statuses=["COMPLETED"], failures={failed_state})

    result, state = simulation.run(initial_input())

    assert result == "FAILED"
    assert simulation.mark_failed_calls == 1
    mark_failed = next(payload for name, payload in simulation.calls if name == "MarkFailed")
    assert mark_failed["action"] == "fail"
    assert mark_failed["user_id"] == "u"
    assert mark_failed["project_id"] == "p"
    assert mark_failed["recording_id"] == "r"
    assert mark_failed["execution_arn"] == SIMULATED_EXECUTION_ARN
    assert "transcript_text" not in json.dumps(mark_failed)


def test_mark_failed_retries_transient_failures_before_failed_terminal():
    simulation = WorkflowSimulation(
        poll_statuses=["COMPLETED"], failures={"PreprocessAudio", "MarkFailed"}
    )

    result, _ = simulation.run(initial_input())

    assert result == "FAILED"
    assert simulation.mark_failed_calls == 4


def test_failed_transcription_job_routes_to_mark_failed():
    simulation = WorkflowSimulation(poll_statuses=["FAILED"])

    result, state = simulation.run(initial_input())

    assert result == "FAILED"
    assert simulation.mark_failed_calls == 1
    assert state["status"] == "FAILED"
