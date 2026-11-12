# Why we chose Amazon Transcribe over Whisper

SpeakUp turns each recording into text, and every rubric score is built from that text. We had to choose between two speech-to-text options:

- **Amazon Transcribe:** AWS's paid speech-to-text service. We send it audio and it returns the words, with a start and end time for each one.
- **Whisper:** OpenAI's free speech-to-text model, which we would run on our own computer or server.

We chose Transcribe for three reasons:

1. **It catches the most filler words**, which was our top priority. It found 90.9% of them, against 81.8% for the best Whisper setup.
2. **It's cheaper at our scale.** We pay per minute of audio instead of keeping a GPU server running.
3. **Where Whisper did better, the gap is too small to change a student's score**, or we plan to handle that part another way.

## What we needed, in priority order

| Priority | Need | Why it matters |
|---|---|---|
| 1 | **Keep filler words** (um, uh) | The filler score counts them, and speech-to-text tools often leave them out of the text |
| 2 | **Accurate word counts** | Words per minute (WPM) drives the speaking-rate score |
| — | **A time for every word** | Pauses can be found from gaps between words, and the results page jumps the audio to a word |
| — | **Cost and running effort** | It runs on every upload, on a student project budget |
| — | **Privacy** | Students' recordings are personal |

## How we tested

**Setups.** We compared five:
- **Whisper small** and **Whisper turbo**, two sizes of the Whisper model. We ran each one twice: once as is, and once with a **prompt**. A prompt is a short sample of text that Whisper is told to imitate. Ours was full of fillers (`"Um, uh, so, like, you know, I think, basically, actually."`), to nudge Whisper into writing fillers down instead of cleaning them up.
- **Amazon Transcribe**, with default settings.

**Answer key.** We listened to 12 recordings and wrote down every filler word, every pause, and the total word count, timing each to the nearest second.
- Fillers: um, uh, er, ah and "you know".
- Pauses: silences of about 0.25 to 3 seconds.
- When two of us marked the same kind of event within about 1.5 s of each other, it counted once.
- Because our times are to the whole second, a tool's detection counted as correct if it was within 1 s of one of ours.

We split the recordings into two groups. TED speakers are polished and rarely say um, so they gave too few fillers to judge on.

| Group | Recordings | Fillers in answer key | Pauses in answer key |
|---|---|---|---|
| Everyday speech | A NutriScan app pitch (about 3 min), a YouTube presentation about a film (first 2 min), a research talk from the ACL 2022 conference (2 min), and 6 short street-interview answers (21 to 60 s each) | 66 | 116 |
| TED talks | Bill Gates, *The next outbreak? We're not ready*. Aimee Mullins, *The opportunity of adversity*. Kelly McGonigal, *How to make stress your friend* (about 2 min each) | 15 | 29 |

**Measures.**
- **Recall:** the share of the answer key's fillers or pauses that the tool found.
- **Precision:** the share of the tool's detections that were real.
- **WPM error:** how far the tool's words per minute was from our hand count.

## Reason 1: Transcribe catches the most fillers

Everyday speech (66 fillers in the answer key):

| Setup | Filler recall | Filler precision |
|---|---|---|
| Whisper small, no prompt | 9.1% | 85.7% |
| Whisper turbo, no prompt | 10.6% | 100.0% |
| Whisper small + prompt | 75.8% | 94.3% |
| Whisper turbo + prompt | 81.8% | 90.0% |
| **Amazon Transcribe** | **90.9%** | **90.9%** |

Transcribe beat Whisper small + prompt by 15 points and turbo + prompt by 9. Its precision is about the same as turbo's and a little below small's. Without the prompt, Whisper missed about 9 in 10 fillers, so it can't be used to count them.

On the TED talks, Transcribe found 53.3% of fillers, and both prompted Whisper runs found 6.7% (1 of 15). We left TED out of the decision because 15 fillers is too few.

## Reason 2: Transcribe is cheaper at our scale

Prices are for AWS's US East (Ohio) region, where our backend runs. We checked them on AWS's public price data in November 2026 (sources at the end).

| | Whisper on our own server | Amazon Transcribe |
|---|---|---|
| Price | The software is free, but it needs a GPU server, a computer with a graphics card that runs the model fast. AWS's smallest common one, g4dn.xlarge, costs **$0.526 an hour** on demand (rented by the hour, no contract) | **$0.006 per minute** of audio, billed by the second with no minimum |
| A month, left running | $0.526 × 730 hours = **about $384**, whether or not anyone uploads | Only the minutes students upload |
| On a laptop instead | $0, but our own laptop CPUs took 150 to 275 s per recording. That only works if students don't need results right away | n/a |
| Running it | Install the model, then run, secure and update a server. Starting the server only when needed would save money but means managing start-up and shut-down, which we judged impractical | Our backend's processing function (an AWS Lambda) makes one request, and the text is saved to our S3 storage |

**Break-even.** A GPU server left on all month costs about $384. At $0.006 a minute, $384 buys 64,000 minutes of Transcribe ($384 ÷ $0.006), about 1,070 hours of audio a month. A class project uploads far less than that, so Transcribe costs us less.

## Reason 3: Where Whisper did better, it didn't change our choice

### Word counts: Whisper is slightly more accurate, but the gap is too small to matter

| Setup | WPM error, everyday speech | WPM error, TED |
|---|---|---|
| Whisper small, no prompt | 1.2 | 1.4 |
| Whisper turbo, no prompt | 3.1 | 1.6 |
| Whisper small + prompt | 3.6 | 1.1 |
| Whisper turbo + prompt | 4.4 | 3.1 |
| Amazon Transcribe | 5.2 | 1.7 |

Transcribe had the largest error on everyday speech. We judged every model's error small enough that WPM didn't decide between Transcribe and Whisper.

**What we checked by hand.** On the third street interview (a 50-second answer about beaches versus mountains), our hand counts were 153 words (two team members) and 159 (a third). Transcribe gave 161. Two words in Transcribe's text weren't spoken: an added "the", and an extra "there's" where the speaker mumbled. Without them Transcribe's count is 159, matching the higher hand count.

**What we think, but haven't measured.** Transcribe seemed to add more words when a speaker used more fillers. The prompt also made Whisper's word counts run high, possibly because the prompt makes it repeat words.

### Pauses: Whisper's word gaps caught more, but none were good enough

One way to find pauses is to look for gaps of 0.25 s or more between the words in a transcript. We compared that with a **voice activity detector (VAD)**, a separate tool that listens to the audio for speech and ignores the transcript. We ran it at setting ("mode") 2.

| Source of pauses | Pause recall | Pause precision |
|---|---|---|
| Whisper small + prompt, word gaps | 65.5% | 44.4% |
| Whisper turbo + prompt, word gaps | 55.2% | 43.0% |
| Amazon Transcribe, word gaps | 51.7% | 44.8% |
| VAD mode 2 | 55.2% | 70.3% |

Whisper small's gaps found the most pauses, but every transcriber's gaps were wrong more often than right. The VAD was right 7 times in 10. That's why we will find pauses with a separate detector instead of the transcript.

### Privacy: Whisper keeps audio in-house, so Transcribe needs extra steps

- **Whisper on our own server:** we would still have to secure the files and the machine, but no outside company would process the audio.
- **Transcribe:** recordings are stored in our AWS storage and processed by AWS, so a third party handles students' audio. By default, AWS may use content sent to Transcribe to improve the service. Two steps we propose, **not done yet**:
  1. **Opt out** of AWS using our audio this way. AWS supports this through an "AI services opt-out policy". It needs an AWS Organizations setup, or a request to AWS Support. We haven't checked whether our account has either.
  2. **Tell students** in the app that recordings are processed by AWS.

## Summary

| Factor | Better | Did it decide? |
|---|---|---|
| 1. Filler recall | **Transcribe** (90.9% vs 81.8%) | Yes, our top priority |
| 2. Word counts (WPM) | Whisper, slightly | No, the gap is too small to change a score |
| Cost at our volume | **Transcribe** | Yes |
| Effort to run | **Transcribe** | Yes |
| Pauses from word gaps | Whisper small | No, none was accurate enough. We plan a separate detector |
| Privacy | Whisper | No, we will just have to implemenet the opt-out and the notice. |

## Limits

- **We only compared Whisper.** We didn't test Google Speech-to-Text, Deepgram, AssemblyAI or WhisperX.
- **Small test set.** The decision rests on 66 fillers, so a 6-point gap is about 4 fillers.
- **Answer key times are to the second**, so we couldn't judge how precise each tool's timestamps were.
- **Default settings.** We didn't give Transcribe a custom vocabulary (a list of words to listen for), which might change its filler results.

## Sources

- AWS, [Amazon Transcribe pricing](https://aws.amazon.com/transcribe/pricing/): per-second billing, the free tier. The Ohio rate comes from AWS's public price list for Transcribe in us-east-2, [index.json](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/transcribe/current/us-east-2/index.json): "$0.0001 per second for TranscribeAudio in US East (Ohio)", which is $0.006 a minute.
- AWS, [EC2 On-Demand pricing](https://aws.amazon.com/ec2/pricing/on-demand/): g4dn.xlarge, Linux, US East (Ohio), $0.526 an hour, read from the page's price data (published 2026-11-10).
- AWS, [Free plan and Paid plan](https://aws.amazon.com/free/).
- AWS, [Opting out of using your data for service improvement (Amazon Transcribe)](https://docs.aws.amazon.com/transcribe/latest/dg/opt-out.html) and [AI services opt-out policies (AWS Organizations)](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_ai-opt-out_all.html).
- Optional, in this repo: [FILLER_RUBRIC.md](FILLER_RUBRIC.md) for which words count as fillers, and [full-pipeline-walkthrough.md](../full-pipeline-walkthrough.md) for how Transcribe fits the backend.
