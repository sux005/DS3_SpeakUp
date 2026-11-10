"""Static checks for the documented cross-platform development contract."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_audio_model_requirements_select_macos_pytorch_wheels() -> None:
    """Keep macOS off the Linux/Windows-only ``+cpu`` version pins."""

    requirements = (ROOT / "requirements-audio-model.txt").read_text(
        encoding="utf-8"
    )

    assert 'torch==2.5.1+cpu; sys_platform != "darwin"' in requirements
    assert 'torchaudio==2.5.1+cpu; sys_platform != "darwin"' in requirements
    assert 'torch==2.5.1; sys_platform == "darwin"' in requirements
    assert 'torchaudio==2.5.1; sys_platform == "darwin"' in requirements


def test_default_requirements_exclude_optional_rnnoise() -> None:
    """Do not impose the legacy backend's macOS floor on normal developers."""

    default = (ROOT / "requirements.txt").read_text(encoding="utf-8")
    optional = (ROOT / "requirements-rnnoise.txt").read_text(encoding="utf-8")

    assert "pyrnnoise==" not in default
    assert "audiolab==" not in default
    assert "pyrnnoise==0.4.3" in optional
    assert "audiolab==0.4.8" in optional


def test_macos_setup_uses_posix_virtual_environment_paths() -> None:
    """Document executable macOS commands rather than Windows venv paths."""

    guide = (ROOT / "docs" / "macos-setup.md").read_text(encoding="utf-8")

    assert "source .venv/bin/activate" in guide
    assert "source .venv-audio-v2/bin/activate" in guide
    assert "--platform linux/amd64" in guide
