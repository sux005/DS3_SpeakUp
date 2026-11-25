# Whisper vs Amazon Transcribe, with and without noise cancellation

- **Run date:** 2026-11-09
- **Samples:** six distinct `SPEAKUP 1`–`SPEAKUP 6` recordings, about 4 minutes 18 seconds total
- **S3:** `s3://speakup-dev-private-110359221190-us-east-2/experiments/asr-compare-2026-11-09/`
- **Machine-readable results:** `results/asr-compare-2026-11-09/summary.json` locally and `summary.json` at the S3 prefix above

## Experiment

Each recording used two WAVs from the same audio preparation v1.1.0 run:

- `reference.wav`: mono, resampled, speech-level normalized; no noise cancellation.
- `enhanced_model.wav`: the DeepFilterNet3 noise-cancelled output, with the same
  sample rate, sample count, and normalization target. The preparation report
  says enhancement was applied for all six clips. The safety-selected
  `diagnostic.wav` was deliberately not used, because it can fall back to the
  reference.

Each WAV was uploaded to the private S3 prefix and processed by both Faster
Whisper `small.en` (local CPU, int8, English, beam size 5, word timestamps,
VAD off) and Amazon Transcribe batch (`en-US`, `us-east-2`). Transcribe read
the S3 WAV directly. Both engines' JSON outputs are stored alongside the WAVs
in S3. The run produced **12 audio inputs and 24 completed transcripts**.

The SHA-256 of every Whisper input matches its prepared WAV. The Transcribe job
metadata identifies the corresponding S3 WAV for all 12 jobs. All 12 uploaded
S3 WAV objects have an ETag matching the MD5 of the local input bytes. Source
recording SHA-256 values also match the preparation reports. S3 output keys and
input hashes for every run are in `summary.json`.

## Results

The percentages are **word-level edit distance between two automatic
transcripts**, divided by the first transcript's word count. They describe
disagreement, **not accuracy**. Tokenization uses casefolded `\w+` tokens from
`scripts/check_transcript_accuracy.py`.

| Clip | Whisper vs Transcribe, no cancellation | Whisper vs Transcribe, cancellation | Whisper change from cancellation | Transcribe change from cancellation |
| --- | ---: | ---: | ---: | ---: |
| SPEAKUP 1 | 15.28% | 13.51% | 2.78% | 2.50% |
| SPEAKUP 2 | 19.05% | 23.53% | 25.00% | 19.51% |
| SPEAKUP 3 | 5.29% | 9.76% | 5.88% | 0.56% |
| SPEAKUP 4 | 18.55% | 41.53% | 33.87% | 25.64% |
| SPEAKUP 5 | 7.92% | 4.90% | 3.96% | 5.56% |
| SPEAKUP 6 | 7.95% | 13.86% | 9.09% | 3.17% |
| **All clips, weighted by words** | **81 / 727 = 11.14%** | **119 / 692 = 17.20%** | **95 / 727 = 13.07%** | **61 / 753 = 8.10%** |

The numerator is the total word edits and the denominator is the total word
count of the first transcript in each comparison. The especially large change
on `SPEAKUP 4` should be reviewed by listening before drawing a conclusion
about the noise canceller.

| Engine | Words without → with cancellation | `um`/`uh` tokens without → with |
| --- | ---: | ---: |
| Faster Whisper | 727 → 692 | 5 → 4 |
| Amazon Transcribe | 753 → 740 | 26 → 26 |

Transcribe produced more `um`/`uh` tokens in both conditions. The counts do not
establish whether it correctly captured fillers or inserted extra ones.

## Interpretation and next validation

Noise cancellation changed Whisper's transcript more than Transcribe's on these
six clips (13.07% versus 8.10% within-model disagreement). Cross-model
disagreement rose from 11.14% to 17.20% after cancellation. Neither fact shows
which transcript is more accurate.

All six `data/references/SPEAKUP *.json` files still have `review_status:
pending` and contain automatic draft text. For an accuracy decision, listen to
the source recordings, correct each reference, and mark it reviewed. Then
calculate word error rate and filler precision/recall for all four conditions
against those same verified references. Six short clips are enough for an
exploratory comparison but too few for a broad model recommendation.

The private `review_queue.csv` in the S3 experiment prefix and local results
directory splits the recordings into 8-second windows, sorted by word edits
between the models. It includes both automatic texts and a blank
`verified_text` column. Start with `SPEAKUP 4` at 8–16
seconds with cancellation, then `SPEAKUP 6` at 48–56 seconds with cancellation.
The queue helps prioritize listening; its automatic texts are not ground truth.
Four 8-second WAV excerpts for those two windows (reference and enhanced audio
for each) are in the `review_clips/` subfolder of the same S3 prefix and local
results directory.
