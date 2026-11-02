import json


def handler(event, context):
    detail = event.get("detail", {})
    print(
        json.dumps(
            {
                "event": "workflow_failure",
                "status": detail.get("status"),
                "executionArn": detail.get("executionArn"),
                "stateMachineArn": detail.get("stateMachineArn"),
            }
        )
    )
    return {"logged": True}
