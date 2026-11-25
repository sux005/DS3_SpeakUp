# Scoring research

Research behind the speaking rubric, the pause method and the Bedrock coaching prompt.
Docs only. The scripts named in these files live in Allen's private research repo, because they
need local audio and hand labels that are not in this repo.

The cutoffs described here are the ones in `src/scoring/rubrics/speaking-2026-10-31.csv`.
The acoustic pause inputs are implemented in `src/audio/pause_detection.py` and are passed to
the scorer when available; the scorer falls back to Transcribe word gaps when they are absent.
The Bedrock prompt comparison below is historical research. The processor implementation validates
structured feedback in `infra/lambda/processor/index.py`.

## Start here

| File | What it covers |
|---|---|
| `RUBRIC_README.md` | The rubric in plain language: every cutoff, where it came from, and the models we picked |
| `bedrock_prompt_comparison.md` | Old vs new Bedrock prompt on Links 13 to 16 |
| `noise_cancellation_ab.md` | Reproducible raw/enhanced ASR comparison and verified SPEAKUP 2 Whisper result |

## Background

| File | What it covers |
|---|---|
| `FILLER_RUBRIC.md`, `FILLER_WORD_BANK.md` | Which words count as fillers, and the cutoffs with sources |
| `PAUSE_RESEARCH.md` | Which pauses count, and why pauses between sentences are not penalized |
| `TRANSCRIPTION_MODEL_CHOICE.md` | Why we use Amazon Transcribe instead of Whisper, and what we compared |

## Test results

| File | What it covers |
|---|---|
| `results/link15_blind_test.md`, `results/link16_blind_test.md` | Pause detectors, noise cleanup and inside/between, on two clips marked by hand without seeing any model output |
| `results/links13_14_*.md` | Punctuation model and Transcribe tests on Links 13 and 14 |
| `results/comma_pause_rule.md` | Period vs comma rule for deciding which pauses count, on 220 hand-labeled pauses |
| `results/rubric_validation.md` | The rubric run on TED talks, conference talks and hesitant speakers |
| `results/section_flags.md` | Whether "this section was faster / had more fillers" flags are real or chance |
| `results/pipeline_step_outputs.md` | The raw output format of every pipeline step |

## Acoustic pause method: word-gap clipping (fixed 11/17)

The first version cut every energy silence down to the Transcribe word gaps. Transcribe often
stretches a word's timing over a real silence, so most pauses vanished on some clips (Link 14:
42 energy pauses of 0.3 s or more, 16 kept). Now an energy silence is kept whole when it overlaps
a word gap or a word starts or ends inside it, and a pause is placed after the last word whose
midpoint comes before it. On 220 hand-marked pauses (Links 13 to 19) the method now finds 205
instead of 144. It also finds 39 pauses the hand count skipped (mostly short quiet moments on
Links 15 and 17), which have not hurt any clip score so far. See `results/comma_pause_rule.md`.
