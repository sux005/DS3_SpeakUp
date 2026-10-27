"""Immutable, environment-backed configuration for AWS payload storage."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
import os
import re

from src.aws_payload.errors import PayloadConfigurationError


DEFAULT_MAX_JSON_PAYLOAD_BYTES = 1_048_576
DEFAULT_MAX_TRANSCRIPT_PAYLOAD_BYTES = 5_242_880

_REGION = re.compile(r"^[a-z]{2}(?:-gov)?-[a-z]+-\d$")
_BUCKET = re.compile(
    r"^(?!\d+\.\d+\.\d+\.\d+$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$"
)
_DYNAMODB_NAME = re.compile(r"^[A-Za-z0-9_.-]{3,255}$")


def _required(environment: Mapping[str, str], name: str) -> str:
    value = environment.get(name, "").strip()
    if not value:
        raise PayloadConfigurationError(
            f"Missing required environment variable: {name}"
        )
    return value


def _integer(
    environment: Mapping[str, str],
    name: str,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    raw = environment.get(name)
    try:
        value = default if raw is None or not raw.strip() else int(raw)
    except ValueError as error:
        raise PayloadConfigurationError(f"{name} must be an integer") from error
    if not minimum <= value <= maximum:
        raise PayloadConfigurationError(
            f"{name} must be between {minimum} and {maximum}"
        )
    return value


@dataclass(frozen=True)
class PayloadConfig:
    """Resource names and bounded settings for one AWS environment.

    Credentials are deliberately absent. Boto3 resolves short-lived local or
    workload credentials through its standard credential chain.
    """

    region: str
    data_bucket: str
    projects_table: str
    recordings_table: str
    owner_project_index: str = "OwnerProjectCreatedAtIndex"
    upload_url_ttl_seconds: int = 900
    recovery_days: int = 30
    abandoned_retention_days: int = 7
    max_json_payload_bytes: int = DEFAULT_MAX_JSON_PAYLOAD_BYTES
    max_transcript_payload_bytes: int = DEFAULT_MAX_TRANSCRIPT_PAYLOAD_BYTES
    connect_timeout_seconds: int = 5
    read_timeout_seconds: int = 60
    sdk_total_max_attempts: int = 3
    sdk_max_pool_connections: int = 10

    def __post_init__(self) -> None:
        """Reject invalid resource identifiers and unbounded settings."""

        if not _REGION.fullmatch(self.region):
            raise PayloadConfigurationError("region is not a valid AWS Region name")
        if not _BUCKET.fullmatch(self.data_bucket) or ".." in self.data_bucket:
            raise PayloadConfigurationError("data_bucket is not a valid S3 bucket name")
        for name, value in (
            ("projects_table", self.projects_table),
            ("recordings_table", self.recordings_table),
            ("owner_project_index", self.owner_project_index),
        ):
            if not _DYNAMODB_NAME.fullmatch(value):
                raise PayloadConfigurationError(f"{name} is not a valid DynamoDB name")
        bounds = (
            ("upload_url_ttl_seconds", self.upload_url_ttl_seconds, 60, 3600),
            ("recovery_days", self.recovery_days, 1, 365),
            (
                "abandoned_retention_days",
                self.abandoned_retention_days,
                1,
                30,
            ),
            ("max_json_payload_bytes", self.max_json_payload_bytes, 1024, 10_485_760),
            (
                "max_transcript_payload_bytes",
                self.max_transcript_payload_bytes,
                self.max_json_payload_bytes,
                52_428_800,
            ),
            ("connect_timeout_seconds", self.connect_timeout_seconds, 1, 30),
            ("read_timeout_seconds", self.read_timeout_seconds, 1, 300),
            ("sdk_total_max_attempts", self.sdk_total_max_attempts, 1, 10),
            ("sdk_max_pool_connections", self.sdk_max_pool_connections, 1, 100),
        )
        for name, value, minimum, maximum in bounds:
            if not minimum <= value <= maximum:
                raise PayloadConfigurationError(
                    f"{name} must be between {minimum} and {maximum}"
                )

    @classmethod
    def from_environment(
        cls, environment: Mapping[str, str] | None = None
    ) -> "PayloadConfig":
        """Create configuration from non-secret environment variables."""

        values = os.environ if environment is None else environment
        region = values.get("AWS_REGION") or values.get("AWS_DEFAULT_REGION") or ""
        if not region.strip():
            raise PayloadConfigurationError(
                "Missing required environment variable: AWS_REGION"
            )
        max_json = _integer(
            values,
            "MAX_JSON_PAYLOAD_BYTES",
            DEFAULT_MAX_JSON_PAYLOAD_BYTES,
            1024,
            10_485_760,
        )
        max_transcript = _integer(
            values,
            "MAX_TRANSCRIPT_PAYLOAD_BYTES",
            DEFAULT_MAX_TRANSCRIPT_PAYLOAD_BYTES,
            max_json,
            52_428_800,
        )
        return cls(
            region=region.strip(),
            data_bucket=_required(values, "DATA_BUCKET"),
            projects_table=_required(values, "PROJECTS_TABLE"),
            recordings_table=_required(values, "RECORDINGS_TABLE"),
            owner_project_index=values.get(
                "OWNER_PROJECT_INDEX", "OwnerProjectCreatedAtIndex"
            ).strip(),
            upload_url_ttl_seconds=_integer(
                values, "URL_EXPIRY_SECONDS", 900, 60, 3600
            ),
            recovery_days=_integer(values, "PAYLOAD_RECOVERY_DAYS", 30, 1, 365),
            abandoned_retention_days=_integer(
                values, "ABANDONED_RETENTION_DAYS", 7, 1, 30
            ),
            max_json_payload_bytes=max_json,
            max_transcript_payload_bytes=max_transcript,
            connect_timeout_seconds=_integer(
                values, "AWS_CONNECT_TIMEOUT_SECONDS", 5, 1, 30
            ),
            read_timeout_seconds=_integer(
                values, "AWS_READ_TIMEOUT_SECONDS", 60, 1, 300
            ),
            sdk_total_max_attempts=_integer(
                values, "AWS_TOTAL_MAX_ATTEMPTS", 3, 1, 10
            ),
            sdk_max_pool_connections=_integer(
                values, "AWS_MAX_POOL_CONNECTIONS", 10, 1, 100
            ),
        )
