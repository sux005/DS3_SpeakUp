import numpy as np

from src.audio.pause_detection import energy_silences


def test_energy_finds_the_quiet_gap_between_two_tones():
    rate = 16_000
    tone = 0.5 * np.sin(2 * np.pi * 220 * np.arange(rate) / rate)
    quiet = 0.001 * np.random.default_rng(0).standard_normal(rate // 2)
    audio = np.concatenate([tone, quiet, tone]).astype("float32")
    [(start, end)] = energy_silences(audio, rate)
    assert abs(start - 1.0) < 0.05 and abs(end - 1.5) < 0.05


def test_energy_ignores_quiet_stretches_under_a_quarter_second():
    rate = 16_000
    tone = 0.5 * np.sin(2 * np.pi * 220 * np.arange(rate) / rate)
    audio = np.concatenate([tone, np.zeros(rate // 10), tone]).astype("float32")
    assert energy_silences(audio, rate) == []


def test_audio_prep_report_records_pause_inputs_or_a_warning(monkeypatch):
    from types import SimpleNamespace

    from src.audio import preprocess

    rate = 16_000
    prepared = SimpleNamespace(transcription=np.zeros(rate, dtype="float32"), sample_rate=rate,
                               report={"warnings": []})
    monkeypatch.setattr(preprocess, "pause_inputs", lambda audio, sample_rate: {"energy_silences": []})
    preprocess._add_pause_inputs(prepared)
    assert prepared.report["pause_inputs"] == {"energy_silences": []}

    def broken(audio, sample_rate):
        raise RuntimeError("model missing")

    monkeypatch.setattr(preprocess, "pause_inputs", broken)
    preprocess._add_pause_inputs(prepared)
    assert prepared.report["pause_inputs"] is None
    assert prepared.report["warnings"] == ["pause_inputs_failed: RuntimeError"]
