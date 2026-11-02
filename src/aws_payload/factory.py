"""Reusable boto3 client and table construction for the payload package."""

from __future__ import annotations

from functools import cached_property
from typing import Any

import boto3
from botocore.config import Config

from src.aws_payload.config import PayloadConfig


class AwsClientFactory:
    """Create each thread-safe AWS client/resource once per package instance."""

    def __init__(
        self,
        config: PayloadConfig,
        *,
        session: boto3.Session | None = None,
        s3_client: Any | None = None,
        dynamodb_resource: Any | None = None,
    ) -> None:
        self.config = config
        self._session = session or boto3.Session(region_name=config.region)
        self._s3_override = s3_client
        self._dynamodb_override = dynamodb_resource
        self.sdk_config = Config(
            region_name=config.region,
            retries={
                "total_max_attempts": config.sdk_total_max_attempts,
                "mode": "adaptive",
            },
            connect_timeout=config.connect_timeout_seconds,
            read_timeout=config.read_timeout_seconds,
            max_pool_connections=config.sdk_max_pool_connections,
            signature_version="s3v4",
            user_agent_appid="speakup-payload-api/1.0",
        )

    @cached_property
    def s3_client(self) -> Any:
        """Return the shared S3 client."""

        return self._s3_override or self._session.client(
            "s3", config=self.sdk_config
        )

    @cached_property
    def dynamodb_resource(self) -> Any:
        """Return the shared native-type DynamoDB resource."""

        return self._dynamodb_override or self._session.resource(
            "dynamodb", config=self.sdk_config
        )

    @cached_property
    def projects_table(self) -> Any:
        """Return the configured projects table."""

        return self.dynamodb_resource.Table(self.config.projects_table)

    @cached_property
    def recordings_table(self) -> Any:
        """Return the configured recordings table."""

        return self.dynamodb_resource.Table(self.config.recordings_table)
