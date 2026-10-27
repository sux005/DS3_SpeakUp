from pathlib import Path
import zipfile

from scripts.build_lambda_packages import build_package


def test_package_contains_handler_and_shared_payload_source(tmp_path):
    destination = tmp_path / "api.zip"
    handler_directory = Path("infra/lambda/api").resolve()

    build_package(handler_directory, destination)

    with zipfile.ZipFile(destination) as archive:
        names = set(archive.namelist())
    assert "index.py" in names
    assert "src/__init__.py" in names
    # The foundation agent creates this package during the same implementation.
    assert "src/aws_payload/__init__.py" in names
