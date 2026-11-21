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
| `results/rubric_validation.md` | The rubric run on TED talks, conference talks and hesitant speakers |
| `results/section_flags.md` | Whether "this section was faster / had more fillers" flags are real or chance |
| `results/pipeline_step_outputs.md` | The raw output format of every pipeline step |

## Historical acoustic pause comparison

On Link 15 (TED talk) energy + Silero finds 31 pauses where the hand count has 21, and the pause
score drops from 4 to 3. About half the extra inside-sentence pauses are short quiet moments the
hand count skipped. The other half are real between-sentence pauses that Transcribe's punctuation
puts inside a sentence. In that research setup, only counting energy pauses that
lined up with a transcript word gap fixed Link 15 but missed Link 14 pauses
where Transcribe stretched words over real silences. The current runtime
intersects acoustic candidates with transcript word gaps and applies a 0.3 s
scoring floor; these dated counts are not a runtime accuracy guarantee.
