from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path

from src.aws_payload.models import Project


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
