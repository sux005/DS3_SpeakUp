"""Adapters for loading timed words from supported transcript JSON shapes."""

from __future__ import annotations

from typing import Any, Mapping, Sequence


def extract_timed_items(document: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """Return rubric-compatible timed items from AWS or local transcript JSON.

    Supported inputs are raw Amazon Transcribe output (``results.items``), a
    SpeakUp normalized transcript payload (``data.items`` or top-level
    ``items``), and the local Faster Whisper format (``segments[].words``).
    """

    results = document.get("results")
    if isinstance(results, Mapping) and isinstance(results.get("items"), Sequence):
        return _mapping_items(results["items"])

    data = document.get("data")
    if isinstance(data, Mapping) and isinstance(data.get("items"), Sequence):
        return _mapping_items(data["items"])

    if isinstance(document.get("items"), Sequence):
        return _mapping_items(document["items"])

    segments = document.get("segments")
    if isinstance(segments, Sequence) and not isinstance(segments, (str, bytes)):
        items: list[Mapping[str, Any]] = []
        for segment in segments:
            if not isinstance(segment, Mapping):
                raise ValueError("Transcript segments must be JSON objects")
            words = segment.get("words")
            if not isinstance(words, Sequence) or isinstance(words, (str, bytes)):
                raise ValueError("Transcript segment words must be a JSON array")
            for word in words:
                if not isinstance(word, Mapping):
                    raise ValueError("Transcript words must be JSON objects")
                items.append(
                    {
                        "type": "pronunciation",
                        "start_time": word.get("start"),
                        "end_time": word.get("end"),
                        "alternatives": [{"content": word.get("text", "")}],
                    }
                )
        return items

    raise ValueError(
        "Expected Amazon Transcribe results.items, SpeakUp data.items/items, "
        "or local transcript segments[].words"
    )


def _mapping_items(value: Sequence[Any]) -> list[Mapping[str, Any]]:
    if isinstance(value, (str, bytes)):
        raise ValueError("Transcript items must be a JSON array")
    if not all(isinstance(item, Mapping) for item in value):
        raise ValueError("Transcript items must be JSON objects")
    return list(value)
