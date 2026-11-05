from pathlib import Path

import pytest

from scripts.run_live_pipeline import _audio_content_type


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("speech.wav", "audio/wav"),
        ("speech.mp3", "audio/mpeg"),
        ("speech.m4a", "audio/mp4"),
        ("speech.ogg", "audio/ogg"),
        ("speech.webm", "audio/webm"),
    ],
)
def test_audio_content_type_matches_supported_upload_format(filename, expected):
    assert _audio_content_type(Path(filename)) == expected


def test_audio_content_type_rejects_unapproved_extension():
    with pytest.raises(ValueError, match="unsupported audio extension"):
        _audio_content_type(Path("speech.flac"))
