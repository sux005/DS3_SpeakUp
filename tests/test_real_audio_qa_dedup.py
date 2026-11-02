"""Duplicate and cache behavior for the local audio QA runner."""

import json

from scripts import run_real_audio_qa as runner
from src.audio.config import AudioPrepConfig


def test_batch_skips_identical_bytes_and_complete_matching_outputs(tmp_path, monkeypatch):
    inputs = tmp_path / "raw"
    outputs = tmp_path / "out"
    inputs.mkdir()
    (inputs / "first.mp4").write_bytes(b"same audio")
    (inputs / "copy.mp4").write_bytes(b"same audio")
    config = AudioPrepConfig(enhancement_backend="none")
    calls = []

    def fake_process(source, output, active_config):
        calls.append(source.name)
        output.mkdir(parents=True, exist_ok=True)
        for name in runner.REQUIRED_ARTIFACTS:
            (output / name).write_bytes(b"artifact")
        report = {
            "pipeline_version": active_config.pipeline_version,
            "config_fingerprint": active_config.fingerprint(),
            "source": {
                "source_file": source.name,
                "source_sha256": runner.source_sha256(source),
            },
        }
        (output / "report.json").write_text(json.dumps(report), encoding="utf-8")
        return {"report": output / "report.json"}

    monkeypatch.setattr(runner, "process_clip", fake_process)
    names = ("first.mp4", "copy.mp4")
    first = runner.run_batch(inputs, outputs, config, names)
    assert calls == ["first.mp4"]
    assert first[1] == ("copy.mp4", "duplicate of first.mp4")

    second = runner.run_batch(inputs, outputs, config, names)
    assert calls == ["first.mp4"]
    assert second == [
        ("first.mp4", "already processed"),
        ("copy.mp4", "duplicate of first.mp4"),
    ]

    (outputs / "first" / "diagnostic.wav").unlink()
    runner.run_batch(inputs, outputs, config, names)
    assert calls == ["first.mp4", "first.mp4"]

    (outputs / "first" / "reference.wav").write_bytes(b"")
    runner.run_batch(inputs, outputs, config, names)
    assert calls == ["first.mp4", "first.mp4", "first.mp4"]

    (inputs / "first.mp4").write_bytes(b"changed audio")
    runner.run_batch(inputs, outputs, config, names)
    assert calls == ["first.mp4", "first.mp4", "first.mp4", "first.mp4", "copy.mp4"]


def test_batch_reruns_when_configuration_changes_or_report_is_invalid(tmp_path, monkeypatch):
    inputs = tmp_path / "raw"
    outputs = tmp_path / "out"
    inputs.mkdir()
    (inputs / "one.mp4").write_bytes(b"audio")
    calls = []

    def fake_process(source, output, config):
        calls.append(config.fingerprint())
        output.mkdir(parents=True, exist_ok=True)
        for name in runner.REQUIRED_ARTIFACTS:
            (output / name).write_bytes(b"artifact")
        report = {
            "pipeline_version": config.pipeline_version,
            "config_fingerprint": config.fingerprint(),
            "source": {"source_file": source.name, "source_sha256": runner.source_sha256(source)},
        }
        (output / "report.json").write_text(json.dumps(report), encoding="utf-8")
        return {"report": output / "report.json"}

    monkeypatch.setattr(runner, "process_clip", fake_process)
    first = AudioPrepConfig(enhancement_backend="none")
    changed = AudioPrepConfig(enhancement_backend="rnnoise")
    runner.run_batch(inputs, outputs, first, ("one.mp4",))
    runner.run_batch(inputs, outputs, changed, ("one.mp4",))
    (outputs / "one" / "report.json").write_text("{broken", encoding="utf-8")
    runner.run_batch(inputs, outputs, changed, ("one.mp4",))
    assert calls == [first.fingerprint(), changed.fingerprint(), changed.fingerprint()]
