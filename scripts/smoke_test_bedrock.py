"""Run a minimal Bedrock Converse check without logging prompt or response text."""

from __future__ import annotations

import argparse
import json
import sys
import time

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError


def invoke(client, model_id: str, max_tokens: int) -> dict[str, object]:
    """Invoke one bounded prompt and return non-content diagnostic metadata."""

    started = time.perf_counter()
    response = client.converse(
        modelId=model_id,
        system=[{"text": "Return one short sentence. Do not use markdown."}],
        messages=[
            {
                "role": "user",
                "content": [{"text": "Confirm that the model can generate text."}],
            }
        ],
        inferenceConfig={"maxTokens": max_tokens, "temperature": 0},
    )
    content = response.get("output", {}).get("message", {}).get("content", [])
    response_text = "".join(
        block.get("text", "") for block in content if isinstance(block, dict)
    )
    usage = response.get("usage", {})
    return {
        "status": "SUCCESS",
        "model_id": model_id,
        "duration_seconds": round(time.perf_counter() - started, 3),
        "stop_reason": response.get("stopReason"),
        "input_tokens": usage.get("inputTokens"),
        "output_tokens": usage.get("outputTokens"),
        "total_tokens": usage.get("totalTokens"),
        "response_characters": len(response_text),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", default="speakup-dev")
    parser.add_argument("--region", default="us-east-2")
    parser.add_argument("--model-id", default="amazon.nova-lite-v1:0")
    parser.add_argument("--max-tokens", type=int, default=128)
    args = parser.parse_args()
    if not 1 <= args.max_tokens <= 512:
        parser.error("--max-tokens must be between 1 and 512 for this smoke test")
    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    client = session.client(
        "bedrock-runtime",
        config=Config(
            retries={"total_max_attempts": 4, "mode": "adaptive"},
            connect_timeout=10,
            read_timeout=60,
        ),
    )
    try:
        result = invoke(client, args.model_id, args.max_tokens)
    except ClientError as error:
        details = error.response.get("Error", {})
        print(
            json.dumps(
                {
                    "status": "FAILED",
                    "model_id": args.model_id,
                    "error_code": details.get("Code"),
                    "error_message": details.get("Message"),
                },
                indent=2,
            ),
            file=sys.stderr,
        )
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
