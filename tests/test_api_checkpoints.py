"""Static checkpoints for the deployed HTTP API route contract."""

from pathlib import Path
import re


TEMPLATE = Path(__file__).resolve().parents[1] / "infra/speakup.yaml"


def test_http_routes_have_expected_authorization():
    template = TEMPLATE.read_text(encoding="utf-8")
    routes = dict(re.findall(
        r"RouteKey: '([^']+)', AuthorizationType: (NONE|JWT)", template
    ))
    assert routes == {
        "GET /health": "NONE",
        "GET /account/limits": "JWT",
        "POST /projects": "JWT",
        "GET /projects": "JWT",
        "POST /uploads": "JWT",
        "GET /projects/{projectId}/recordings": "JWT",
        "GET /recordings/{recordingId}": "JWT",
        "POST /recordings/{recordingId}/confirm-upload": "JWT",
        "GET /recordings/{recordingId}/download": "JWT",
        "POST /recordings/{recordingId}/process": "JWT",
        "DELETE /recordings/{recordingId}": "JWT",
        "POST /recordings/{recordingId}/restore": "JWT",
        "DELETE /recordings/{recordingId}/permanent": "JWT",
    }


def test_api_outputs_endpoint_and_uses_jwt_authorizer():
    template = TEMPLATE.read_text(encoding="utf-8")
    assert "ApiEndpoint:" in template
    assert "Value: !GetAtt HttpApi.ApiEndpoint" in template
    assert "AuthorizerType: JWT" in template
