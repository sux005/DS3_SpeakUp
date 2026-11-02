"""Stable domain exceptions for the SpeakUp payload API."""

from __future__ import annotations


class PayloadError(Exception):
    """Base class for errors exposed by the internal payload package."""


class PayloadConfigurationError(PayloadError, ValueError):
    """Raised when required payload configuration is absent or unsafe."""


class PayloadValidationError(PayloadError, ValueError):
    """Raised when a caller supplies an invalid payload-domain value."""


class IdentifierValidationError(PayloadValidationError):
    """Raised when an opaque identifier cannot be used in a storage key."""


class JsonValidationError(PayloadValidationError):
    """Raised when a JSON document violates the payload contract."""


class PayloadTooLargeError(JsonValidationError):
    """Raised when a JSON document exceeds its configured byte limit."""


class PayloadNotFoundError(PayloadError):
    """Raised when a requested payload or metadata record does not exist."""


class PayloadAlreadyExistsError(PayloadError):
    """Raised when an immutable payload already exists at its owned key."""


class WriteConflictError(PayloadError):
    """Raised when optimistic concurrency rejects a stale write."""


class IdempotencyConflictError(WriteConflictError):
    """Raised when one idempotency key is reused for different input."""


class OwnershipViolationError(PayloadError):
    """Raised when a reference does not belong to its declared owner scope."""


class PayloadIntegrityError(PayloadError):
    """Raised when stored bytes do not match their recorded integrity data."""


class BackendUnavailableError(PayloadError):
    """Raised when an AWS backend cannot complete an otherwise valid request."""
