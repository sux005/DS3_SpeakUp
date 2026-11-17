"""Tests for the content-safe Bedrock smoke check."""

from __future__ import annotations

from scripts.smoke_test_bedrock import invoke


class FakeBedrock:
    def __init__(self) -> None:
        self.request = None

    def converse(self, **request):
        self.request = request
        return {
            "output": {"message": {"content": [{"text": "Model is available."}]}},
            "stopReason": "end_turn",
            "usage": {"inputTokens": 10, "outputTokens": 4, "totalTokens": 14},
        }


def test_smoke_invocation_is_bounded_and_reports_only_metadata() -> None:
    client = FakeBedrock()
    result = invoke(client, "amazon.nova-lite-v1:0", 128)

    assert client.request["inferenceConfig"]["maxTokens"] == 128
    assert result["status"] == "SUCCESS"
    assert result["total_tokens"] == 14
    assert result["response_characters"] == len("Model is available.")
    assert "response" not in result
