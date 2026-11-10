"""Pluggable learned speech-enhancement backends for audio pipeline v2."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

import numpy as np

from src.audio.config import AudioPrepConfig
from src.audio.filters import _resample, rnnoise_enhance


EnhancementReport = dict[str, float | int | str | bool]


@dataclass(frozen=True)
class EnhancementResult:
    """A timeline-aligned model waveform and its reproducibility metadata."""

    audio: np.ndarray
    report: EnhancementReport


Enhancer = Callable[[np.ndarray, int, AudioPrepConfig], EnhancementResult]


@lru_cache(maxsize=2)
def _load_deepfilternet(
    model_name_or_path: str, post_filter: bool
) -> tuple[Any, Any, str, int]:
    """Load and retain one DeepFilterNet model for warm worker invocations."""

    try:
        from df.enhance import init_df
    except ImportError as error:
        raise RuntimeError(
            "DeepFilterNet enhancement requires deepfilternet==0.5.6, "
            "deepfilterlib==0.5.6, and a compatible CPU PyTorch build"
        ) from error

    try:
        loaded = init_df(
            model_base_dir=model_name_or_path,
            post_filter=post_filter,
            log_level="NONE",
            log_file=None,
        )
        if len(loaded) == 4:
            model, df_state, resolved_model, epoch = loaded
        elif len(loaded) == 3:
            model, df_state, resolved_model = loaded
            epoch = -1
        else:
            raise RuntimeError("DeepFilterNet returned an unsupported model tuple")
        return model, df_state, str(resolved_model), int(epoch)
    except (OSError, RuntimeError, ValueError) as error:
        raise RuntimeError(
            f"Unable to load DeepFilterNet model: {model_name_or_path}"
        ) from error


def _match_timeline(audio: np.ndarray, samples: int) -> np.ndarray:
    """Return finite mono float32 audio with exactly ``samples`` values."""

    result = np.asarray(audio, dtype=np.float32).reshape(-1)
    if not np.all(np.isfinite(result)):
        raise RuntimeError("Enhancement model produced non-finite audio")
    if len(result) < samples:
        result = np.pad(result, (0, samples - len(result)))
    return result[:samples].astype(np.float32, copy=False)


def deepfilternet_enhance(
    audio: np.ndarray, sample_rate: int, config: AudioPrepConfig
) -> EnhancementResult:
    """Enhance mono speech with a cached DeepFilterNet full-band model."""

    try:
        import torch
        from df.enhance import enhance
    except ImportError as error:
        raise RuntimeError(
            "DeepFilterNet enhancement requires deepfilternet and PyTorch"
        ) from error

    model, df_state, resolved_model, epoch = _load_deepfilternet(
        config.enhancement_model, config.enhancement_post_filter
    )
    model_rate = int(df_state.sr())
    model_input = _resample(audio, sample_rate, model_rate)
    tensor = torch.from_numpy(model_input[np.newaxis, :].copy())
    with torch.inference_mode():
        output = enhance(
            model,
            df_state,
            tensor,
            pad=True,
            atten_lim_db=config.enhancement_attenuation_limit_db,
        )
    enhanced = output.detach().cpu().numpy()[0]
    enhanced = _match_timeline(enhanced, len(model_input))
    enhanced = _resample(enhanced, model_rate, sample_rate)
    enhanced = _match_timeline(enhanced, len(audio))
    return EnhancementResult(
        audio=enhanced,
        report={
            "backend": "deepfilternet",
            "runtime": "pytorch",
            "model": config.enhancement_model,
            "resolved_model": Path(str(resolved_model)).name,
            "model_epoch": int(epoch),
            "model_sample_rate": model_rate,
            "attenuation_limit_db": config.enhancement_attenuation_limit_db,
            "post_filter": config.enhancement_post_filter,
            "available": True,
            "applied": True,
        },
    )


def enhance_speech(
    audio: np.ndarray, sample_rate: int, config: AudioPrepConfig
) -> EnhancementResult:
    """Run the configured learned backend without changing the input timeline."""

    backend = config.enhancement_backend.strip().lower()
    if backend == "deepfilternet":
        return deepfilternet_enhance(audio, sample_rate, config)
    if backend == "none":
        return EnhancementResult(
            audio=audio.astype(np.float32, copy=True),
            report={
                "backend": "none",
                "available": True,
                "applied": False,
            },
        )
    if backend == "rnnoise":
        enhanced, report = rnnoise_enhance(audio, sample_rate, config)
        report = {
            **report,
            "runtime": "pyrnnoise",
            "model": "rnnoise-v1",
        }
        return EnhancementResult(audio=enhanced, report=report)
    raise ValueError(f"Unsupported enhancement backend: {config.enhancement_backend}")
