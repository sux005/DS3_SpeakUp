"""Build reproducible zip archives for SpeakUp's source-based Lambdas."""

from __future__ import annotations

import argparse
from pathlib import Path
import zipfile


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = REPOSITORY_ROOT / "build" / "lambda"


def _write_tree(archive: zipfile.ZipFile, source: Path, target: Path) -> None:
    """Add Python source files beneath ``source`` at ``target`` in an archive."""

    for path in sorted(source.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        relative = path.relative_to(source)
        archive.write(path, (target / relative).as_posix())


def build_package(
    handler_directory: Path, destination: Path, *, include_payload_api: bool = True
) -> Path:
    """Package one Lambda handler and the shared internal payload library."""

    handler = handler_directory / "index.py"
    if not handler.is_file():
        raise FileNotFoundError(f"Lambda handler not found: {handler}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(
        destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
    ) as archive:
        archive.write(handler, "index.py")
        archive.write(REPOSITORY_ROOT / "src" / "__init__.py", "src/__init__.py")
        payload_package = REPOSITORY_ROOT / "src" / "aws_payload"
        if include_payload_api and payload_package.is_dir():
            _write_tree(archive, payload_package, Path("src/aws_payload"))
    return destination


def build_all(output_directory: Path = DEFAULT_OUTPUT) -> list[Path]:
    """Build every zip-based Lambda, sharing the payload package where needed."""

    lambda_root = REPOSITORY_ROOT / "infra" / "lambda"
    packages = []
    for name in ("api", "processor", "workflow_failure"):
        packages.append(
            build_package(
                lambda_root / name,
                output_directory / f"{name}.zip",
                include_payload_api=name != "workflow_failure",
            )
        )
    return packages


def main() -> int:
    """Build packages and print their repository-relative output paths."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-directory", type=Path, default=DEFAULT_OUTPUT
    )
    args = parser.parse_args()
    for archive in build_all(args.output_directory.resolve()):
        print(archive)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
