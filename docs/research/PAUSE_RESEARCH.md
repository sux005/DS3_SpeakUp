# SpeakUp pause metric: research and current implementation

The studies and hand-labeling comparisons below are historical research. The
current scorer uses a 0.3 s floor and determines sentence boundaries from
Transcribe punctuation (`.`, `?`, and `!`).

## What we measure

Every silence in the recording is sorted by **length** (using the research below) and by **location** (inside a sentence vs. between sentences or phrases).

- **Scored:** pauses inside a sentence (hesitations), per minute of speaking time.
- **Reported, not scored:** pauses between sentences or ideas and total time spent pausing. The `long_pauses` list flags inside-sentence pauses from 1 s and pauses anywhere from 3 s.

Examples:
- "We trained the ‖ model on…": pause inside a sentence, **counted**
- "…that's our method. ‖ Now, the results.": pause between ideas, **not counted**

## Research on pause length

**1. Goldman-Eisler: where the 0.25-second rule comes from**
- Frieda Goldman-Eisler, a pioneer of pause research, proposed that silences **shorter than 0.25 s are "articulatory"** (the mouth moving between sounds) and **longer ones are "hesitation" pauses** (the speaker planning what to say). This cutoff became the standard in pause research.
- Her 1958 work found that speakers tend to **pause before words that are harder to predict** from context, which links pauses inside sentences to searching for the next word or idea.
- Goldman-Eisler, F. (1968). *Psycholinguistics: Experiments in Spontaneous Speech.* Academic Press.
- Goldman-Eisler, F. (1958). Speech production and the predictability of words in context. *Quarterly Journal of Experimental Psychology, 10*, 96–106. https://doi.org/10.1080/17470215808416261
- Goldman-Eisler, F. (1961). The distribution of pause durations in speech. *Language and Speech, 4*, 232–237. https://doi.org/10.1177/002383096100400405

**2. Campione & Véronis (2002): the three types of pauses** (full paper read)
- Analyzed about **6,000 pauses in 5.5 hours** of speech: read passages by 50 speakers in five languages (including English), plus 10 unscripted interviews.
- Pause lengths fall into **three natural groups**:

| Type | Length | What they found |
|---|---|---|
| Brief | under 0.2 s | Hard to tell apart from the silent part of consonants like "p" or "t" |
| Medium | 0.2–1 s | The most common type. In read speech, 77–96% of pauses, centered around 0.5 s (English: about 0.5 s) |
| Long | over 1 s | **Only in unscripted speech**, about 14% of pauses, centered around 1.6 s |

- They warn that fixed cutoffs can distort comparisons between speakers or speech styles, so the cutoffs below should be checked against hand-marked recordings.
- Campione, E., & Véronis, J. (2002). A large-scale multilingual study of silent pause duration. *Speech Prosody 2002*, 199–202. https://doi.org/10.21437/SpeechProsody.2002-35 · PDF: https://www.isca-archive.org/speechprosody_2002/campione02_speechprosody.pdf

**3. De Jong & Bosker (2013): testing the minimum pause length** (full paper read)
- Tested every cutoff from 0.02 to 1 s on **9.7 hours of speech from 51 speakers** (10,668 hand-measured pauses), comparing the counts with speaking ability and with listeners' fluency ratings.
- **22–27% of all silences were shorter than 0.25 s**, but counting them made the measure worse. A cutoff of **0.25–0.3 s worked best**, and above 0.3 s the measure got worse again.
- Listeners' fluency ratings matched counts of **longer pauses (over about 0.4 s)** most strongly. Longer pauses are what audiences notice most.
- De Jong, N. H., & Bosker, H. R. (2013). Choosing a threshold for silent pauses to measure second language fluency. *Proceedings of DiSS 2013*, 17–20. PDF: https://pure.mpg.de/rest/items/item_1900232_6/component/file_1900231/content

**4. Jefferson (1989): the one-second rule**
- From recordings of everyday conversations, Gail Jefferson found that about **1 second is the "standard maximum" silence** people treat as normal. Longer silences get noticed and treated as a sign of trouble.
- This is from conversation, not presentations, but it explains why pauses over 1 s stand out to listeners.
- Jefferson, G. (1989). Preliminary notes on a possible metric which provides for a "standard maximum" silence of approximately one second in conversation. In D. Roger & P. Bull (Eds.), *Conversation: An Interdisciplinary Perspective* (pp. 166–196). Multilingual Matters. https://emcawiki.net/Jefferson1989a

**5. Pause location: inside vs. between sentences**
- **Kahng (2014):** in hand-marked recordings, fluent speakers averaged **6.6 pauses per speaking-minute inside clauses** (most between 4.4 and 8.8); less fluent speakers averaged **13.8**. Both groups paused about equally often **between** clauses (8–8.5 per minute). How often someone paused inside clauses was the strongest predictor of listeners' fluency ratings (r = −0.67). https://d.lib.msu.edu/etd/3005
- **Blau (1990):** pauses added at phrase boundaries **improved listening comprehension**. https://doi.org/10.2307/3587129
- **Suzuki, Kormos & Uchihara (2021),** meta-analysis: pauses in the middle of clauses are a key predictor of perceived fluency; end-of-clause pauses matter much less. https://doi.org/10.1111/modl.12706

## Pause types and how SpeakUp treats them

| Pause length | Research basis | Between sentences or ideas | Inside a sentence |
|---|---|---|---|
| Under 0.25 s | Articulation, not a pause (Goldman-Eisler); can't be separated from consonants (Campione & Véronis); irrelevant to fluency (De Jong & Bosker) | Not counted | Not counted |
| 0.25–1 s (medium) | The normal pause length (Campione & Véronis) | Normal, shown as a positive | **Counted as a hesitation** |
| 1 to under 3 s (long) | Only in unscripted speech (Campione & Véronis); stands out to listeners (Jefferson) | Allowed (deliberate pause for emphasis); reported but not flagged as long | **Counted and flagged** with a timestamp |
| 3 s or more | Far beyond the normal maximum (Jefferson) | Flagged with a timestamp ("lost your place?") | Flagged with a timestamp |

## Rubric

**Research threshold:** the hand-labeling studies below used pauses of 0.25 s or longer.
The runtime scorer applies a 0.3 s minimum (`MINIMUM_PAUSE_SECONDS` in
`src/scoring/rubric.py`) and uses the finalized bands in
`src/scoring/rubrics/speaking-2026-10-31.csv`.

| Score | Pauses inside sentences, per speaking-minute | Based on |
|---|---|---|
| 4 Advanced | under 9 | Current runtime rubric |
| 3 Proficient | 9 to under 12 | Current runtime rubric |
| 2 Basic | 12 to under 15 | Current runtime rubric |
| 1 Minimal | 15 to under 18 | Current runtime rubric |
| 0 Deficient | 18 or more | Current runtime rubric |

Why per speaking-minute: pauses slow down WPM directly. Per 100 words, the pause count was strongly tied to WPM (r = −0.52), which would double-count speed; per speaking-minute it wasn't (r = −0.09).

## Our data: 50 live conference talks (ACL 2019)

| Measure | Our talks | Research |
|---|---|---|
| Share of pauses that are long (1 s or more) | 12.4% | About 14% in unscripted speech (Campione & Véronis) |
| Where long pauses fall | 67% at sentence ends, 13% at phrase breaks, 20% inside sentences | — |
| Pauses between clauses, per speaking-minute | 8.4 | 8–8.5 (Kahng) |
| Time spent pausing | 19% | 17% for fluent speakers (Kahng) |
| Pauses inside sentences, per speaking-minute (0.25 s cutoff) | 14.1 | 6.6 fluent speakers (Kahng) |

Most measures match the research. The count of pauses inside sentences runs high, likely because our automatic detector picks up very short gaps that people marking by hand would skip; Campione & Véronis note that very short silences are hard to separate from consonants. Raising the detector's cutoff to 0.4 s brings our median to 7.8, inside the fluent range.

## Detection notes (for the Week 2 comparison)

- **Whisper word timestamps** miss about half of real pauses over 0.5 s; don't use them alone.
- **WebRTC VAD** (speech/silence detector) works on clean audio but failed in a noisy room.
- **Noise-adaptive silence detection** agreed with VAD 75–95% on clean audio and handled the noisy room. Recommended starting point.
- **Historical location experiment:** Whisper adds punctuation wherever it hears a pause, so the research compared a separate text-only model. The runtime uses Transcribe punctuation alone.

## Next steps

1. Extend hand-marked evaluation beyond the dated clips and compare the runtime acoustic path with the Transcribe-gap fallback.
2. Revisit the 0.3 s runtime floor if new labeled data shows systematic over- or under-counting.
3. Check that student presentations follow the same patterns as these studies.

## Current implementation files
- `src/audio/pause_detection.py`: energy and optional Silero pause inputs
- `src/scoring/pauses.py`: acoustic and transcript-gap interval combination
- `src/scoring/rubric.py`: 0.3 s floor, inside/between classification, and score application
