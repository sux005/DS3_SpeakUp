"""Canonical checksum parsing helpers for upload and artifact boundaries."""

from __future__ import annotations

import base64
import binascii


def sha256_base64_to_hex(value: str | None) -> str | None:
    """Return a SHA-256 digest's lowercase hex form when ``value`` is canonical.

    The input must be the padded Base64 encoding of exactly 32 digest bytes.
    Invalid, non-string, noncanonical, or absent values return ``None``.
    """

    if not value or not isinstance(value, str):
        return None
    try:
        decoded = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error):
        return None
    if len(decoded) != 32 or base64.b64encode(decoded).decode("ascii") != value:
        return None
    return decoded.hex()
