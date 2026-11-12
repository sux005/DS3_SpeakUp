# Why we chose Amazon Transcribe over Whisper

SpeakUp turns each recording into text, and every rubric score is built from that text. We had to choose between **Amazon Transcribe** and running **OpenAI's Whisper** ourselves. We chose Transcribe for three reasons:

1. **It catches the most filler words**, which was our top priority. It found 90.9% of them, against 81.8% for the best Whisper setup.
2. **It's cheaper and simpler at our scale.** We pay per minute of audio instead of keeping a GPU server running.
3. **Where Whisper did better, the gap doesn't change a student's score**, or another part of the pipeline already covers it.

The rest of this file shows how we tested and why each reason holds.

## What we needed, in priority order

| Priority | Need | Why it matters |
|---|---|---|
| 1 | **Keep filler words** (um, uh) | The filler score counts them, and most speech-to-text tidies them away. Plain Whisper caught only 13% of 436 hand-labelled um/uh ([FILLER_RUBRIC.md](FILLER_RUBRIC.md)) |
| 2 | **Accurate word counts** | Words per minute drives the speaking-rate score |
| — | **A time for every word** | Pauses come from gaps between words, and the results page jumps the audio to a word |
| — | **Punctuation** | A full stop right before a pause makes it "between sentences", which isn't penalised |
| — | **Cost and running effort** | It runs on every upload, on a student project budget |
| — | **Privacy** | Students' recordings are personal |

## How we tested

We ran five setups:
- Whisper small and Whisper turbo, each without and with a prompt full of fillers (`"Um, uh, so, like, you know, I think, basically, actually."`). The prompt nudges Whisper to write fillers down instead of cleaning them up.
- Amazon Transcribe with default settings.

We checked them against 12 clips we had marked by hand in the team doc's "Record and Hand Verification" tab. When two of us marked the same kind of event within about 1.5 s of each other, it counted once. The marks are to the whole second, so a tool's detection counted if it fell within 1 s of one.

| Group | Clips | Hand-marked fillers | Hand-marked pauses |
|---|---|---|---|
| Student / other | A project pitch, Link 2, a conference talk (ACL), 6 street interviews | 66 | 116 |
| TED | Gates, Mullins, McGonigal | 15 | 29 |

Later pause tests used Links 13 and 14, and Links 15 and 16, which were marked blind, before anyone saw model output. Their timestamps are exact.

## Reason 1: Transcribe catches the most fillers

Student / other clips (66 hand-marked fillers):

| Setup | Filler recall (share of real fillers caught) | Filler precision (share of detections that were real) |
|---|---|---|
| Whisper small, no prompt | 9.1% | 85.7% |
| Whisper turbo, no prompt | 10.6% | 100.0% |
| Whisper small + prompt | 75.8% | 94.3% |
| Whisper turbo + prompt | 81.8% | 90.0% |
| **Amazon Transcribe** | **90.9%** | **90.9%** |

Transcribe beat Whisper small + prompt by 15 points and turbo + prompt by 9. Its precision is about the same as turbo's and a little below small's. Without the prompt, Whisper misses about 9 in 10 fillers, so it can't be used for counting them at all.

The TED clips point the same way: Transcribe found 53.3% of fillers, and both prompted Whisper runs found 6.7% (1 of 15). We left TED out of the decision because 15 fillers is too few.

## Reason 2: Transcribe is cheaper and simpler at our scale

| | Whisper (self-hosted) | Amazon Transcribe |
|---|---|---|
| Price | The software is free. A GPU server (AWS g4dn.xlarge) is about **$0.526/hour** on demand in us-east-2, about **$384/month** if left on, whether or not anyone uploads | **$0.006 per minute** of audio (Standard Batch, US East (Ohio)). The free tier covers 60 minutes a month for 12 months ([AWS pricing](https://aws.amazon.com/transcribe/pricing/)) |
| On a laptop or Colab | $0, but 150 to 275 s per clip on our own CPUs. Fine only if students don't need results right away | n/a |
| Running it | Package the model, run and secure a server. Starting the GPU only when needed means managing start and stop, which isn't practical for this tool | One API call from the processor Lambda, results written to S3 |

**Break-even.** The team doc puts it at about 16,000 minutes of audio a month, assuming the GPU server stays on the whole time. That figure matches a price of $0.024 a minute. At the $0.006 price in the same doc's screenshot, it's about 64,000 minutes ($384 ÷ $0.006). Either way, a class project is far below it, so Transcribe is cheaper for us.

## Reason 3: Where Whisper did better, it didn't change our choice

### Word counts: Whisper is slightly more accurate, but the gap doesn't matter

| Setup | WPM error, student / other | WPM error, TED |
|---|---|---|
| Whisper small, no prompt | 1.2 | 1.4 |
| Whisper turbo, no prompt | 3.1 | 1.6 |
| Whisper small + prompt | 3.6 | 1.1 |
| Whisper turbo + prompt | 4.4 | 3.1 |
| Amazon Transcribe | 5.2 | 1.7 |

We decided that for WPM all the models had similar, negligible error rates, so WPM didn't decide between Amazon Transcribe and Whisper. Spot-testing also found that the more fillers a speaker used, the more words were made up. The prompt made Whisper's word counts run high too, probably because it repeats itself.

We checked this on the SpeakUp 3 street interview. Hand counts were 153 (two team members) and 159 (a third). Transcribe gave 161. One made-up "the", plus an extra "there's" taken from a mumble, account for the difference down to 159. A few extra words like that aren't enough to move a speaking-rate score.

### Punctuation: Whisper is better, but Transcribe still scored pauses correctly

The share of pauses correctly labelled as inside or between sentences:

| Method | Links 13 and 14 | Link 15 (blind) | Link 16 (blind) |
|---|---|---|---|
| Transcribe's own punctuation | 94% | 71% | 95% |
| Whisper's own punctuation | not a fair test* | 86% | 100% |

\*The hand labels for 13 and 14 were made from Whisper's text. Source: [RUBRIC_README.md](RUBRIC_README.md), section 4.

Transcribe tends to put a full stop wherever someone pauses, so it struggles with speakers who pause for effect mid-sentence (Link 15, a TED talk). Even so, its final pause score matched the hand score on all four clips.

### Word timing for pauses: mixed, and pauses don't rely on the transcriber anyway

On the 12-clip test (word gaps of 0.25 s or more, whole-second marks), Whisper small's gaps caught more pauses:

| Source of pauses | Pause recall | Pause precision |
|---|---|---|
| Whisper small + prompt, word gaps | 65.5% | 44.4% |
| Whisper turbo + prompt, word gaps | 55.2% | 43.0% |
| Amazon Transcribe, word gaps | 51.7% | 44.8% |
| VAD mode 2 (no transcript, listens for speech) | 55.2% | 70.3% |

On the later clips with exact timestamps (0.3 s gaps), Transcribe's word times were usually tighter:

| Clip | Transcribe gaps | Whisper gaps | Median start error (Transcribe vs Whisper) |
|---|---|---|---|
| Link 13 | 25/34 (74%) | 19/34 (56%) | 0.13 s vs 0.25 s |
| Link 14 | 17/44 (39%) | 18/44 (41%) | 0.35 s vs 0.11 s |
| Link 15 (blind) | 18/21 | 17/21 | 0.08 s vs 0.24 s |
| Link 16 (blind) | 19/20 | 18/20 | 0.05 s vs 0.20 s |

Sources: [links13_14_transcribe.md](results/links13_14_transcribe.md), [link15_blind_test.md](results/link15_blind_test.md), [link16_blind_test.md](results/link16_blind_test.md) (raw audio rows).

Neither transcriber's word gaps were good enough alone. On Link 14, for example, Transcribe stretches words over real silences. So the proposed pause method adds a volume detector and Silero ([RUBRIC_README.md](RUBRIC_README.md), section 4), and the choice of transcriber matters less here.

### Privacy: Whisper keeps audio in-house, and we handle Transcribe by disclosing it

- **Whisper (self-hosted):** we'd still have to protect the files and the machine, but we decide who can see them.
- **Transcribe:** recordings are uploaded to our S3 bucket and processed by AWS, so a third party holds the audio. We should opt out of letting AWS AI services use our content to improve themselves. Students may expect recordings to stay inside the app, so the app should say that it uses AWS.

Source: team doc, "Additional Notes when it comes to whisper and transcribe".

## Summary

| Factor | Better | Did it decide? |
|---|---|---|
| 1. Filler recall | **Transcribe** (90.9% vs 81.8%) | Yes, our top priority |
| 2. Word counts (WPM) | Whisper, slightly | No, the gap is too small to change a score |
| Cost at our volume | **Transcribe** | Yes |
| Effort to run in AWS | **Transcribe** | Yes |
| Punctuation | Whisper | No, Transcribe still matched every hand pause score |
| Word timing for pauses | Mixed | No, a separate detector finds pauses |
| Privacy | Whisper | No, handled by opting out and telling students |

## Limits

- **Only Whisper was compared.** We didn't test Google Speech-to-Text, Deepgram, AssemblyAI or WhisperX.
- **Small test set.** 66 hand-marked fillers on the clips used for the decision, so a 6-point gap is about 4 fillers. None of the blind pause clips came from a hesitant speaker.
- **Whole-second answer key** on the 12-clip test, so timestamp accuracy could only be judged on Links 13 to 16.
- **Default settings.** Transcribe ran without a custom vocabulary.
- **Account status.** `AGENTS.md` notes that Transcribe is currently blocked while the AWS project stays on the Free plan.
