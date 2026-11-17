# Noise-cancellation A/B status

## Method

Use the exact same ASR engine, model, language, and decoding settings for the raw
and noise-cancelled conditions. Record word count, mean word confidence, and
transcript disagreement. Confidence is diagnostic only: select a winner solely
from WER against a human-reviewed reference transcript.

The reusable commands are:

```powershell
python scripts/transcribe_noise_cancellation_pair.py <raw-audio> <enhanced-audio> `
  --output-dir <output-dir> --model small.en

python scripts/compare_noise_cancellation.py <raw-transcript.json> `
  <enhanced-transcript.json> --reference-text <reviewed.txt>
```

The generic comparison command accepts SpeakUp local Whisper JSON, native Amazon
Transcribe JSON, API transcript artifacts, or plain-text transcripts.

## Verified Whisper result: SPEAKUP 2

Run date: 2026-11-12

- Raw source: 48 kHz, two-channel AAC/M4A, 35.136 seconds.
- Noise-cancelled source: the pipeline-selected DeepFilterNet3 model output,
  48 kHz mono WAV, 35.092 seconds. The audio-preparation report says the model
  candidate passed the distortion gate and preserved the timeline.
- ASR: `faster-whisper==1.2.1`, model `small.en`, CPU int8, English, beam size 5,
  word timestamps enabled, VAD disabled.

| Measurement | Raw | DeepFilterNet3 |
|---|---:|---:|
| Transcript words | 77 | 75 |
| Words with confidence | 78 | 76 |
| Mean word confidence | 0.8655 | 0.8868 |

Pairwise transcript results:

- Word edit distance: 3
- Normalized disagreement rate: 0.0390
- Matching-block ratio: 0.9737

**Conclusion:** DeepFilterNet3 modestly increased Whisper's reported confidence
and produced a very similar transcript. This is not yet an accuracy win because
the repository does not contain a human-reviewed transcript for this clip.
Adding the reviewed text will make the script calculate raw and enhanced WER and
select the lower-WER condition automatically.

Generated transcript files and comparison JSON stay under `results/`, which is
gitignored because the source recording and transcript may be private.

## Transcribe status

### Verified Transcribe result: SPEAKUP 2

Run date: 2026-11-12

The same raw and pipeline-selected DeepFilterNet3 files were uploaded to the
private QA prefix and submitted as separate Amazon Transcribe `en-US` jobs with
identical settings.

| Measurement | Raw | DeepFilterNet3 |
|---|---:|---:|
| Transcript words | 76 | 73 |
| Words with confidence | 76 | 73 |
| Mean word confidence | 0.8842 | 0.8600 |

Pairwise transcript results:

- Word edit distance: 5
- Normalized disagreement rate: 0.0658
- Matching-block ratio: 0.9664

The private QA inputs and Transcribe outputs are retained at:

`s3://speakup-dev-private-110359221190-us-east-2/qa/noise-cancellation/20261112T211629Z`

**Conclusion:** this clip supports the concern that denoising may remove words:
the enhanced output has three fewer words and lower ASR confidence. It still
does not prove that raw is more accurate; WER against reviewed text is required.

### Remaining team review

The team meeting notes contain ten raw-versus-noise-cancelled Transcribe excerpts
from six recordings and flag that denoising may have cut out some words. Those
rows still need a second human verification. Five source recordings and the
reviewed reference text are not present in this workspace, so a defensible
six-recording aggregate WER comparison cannot be completed here.

When Jae supplies the files, run both Transcribe outputs through
`compare_noise_cancellation.py` with the same reviewed text used for Whisper.
Report per-clip and total WER; do not choose the condition from confidence or a
small set of hand-picked differences.
