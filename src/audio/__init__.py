"""Deterministic audio preparation for SpeakUp diagnostics."""

from pathlib import Path
import os
import tempfile


_numba_cache = Path(tempfile.gettempdir()) / "speakup-numba-cache"
_numba_cache.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("NUMBA_CACHE_DIR", str(_numba_cache))

from src.audio.config import AudioPrepConfig

__all__ = [
    "AudioPrepConfig",
]
