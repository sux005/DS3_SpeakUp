# SpeakUp Filler Word Bank v1.0 (for hand labeling and tool comparison)

## Tier 1: Definite fillers (scored)

Always count these. Write the **standard label** no matter how it's spelled or how long it's held.

| Standard label | Also count (spellings / sounds) | Rule |
|---|---|---|
| **um** | umm, ummm, uhm, hmm-like "mm" *before* speech | Always a filler |
| **uh** | uhh, uhhh, "a" said as a hesitation sound ("and, a, the results") | Always a filler |
| **er** | erm, err | Always a filler |
| **ah** | ahh (hesitation only) | Filler only as a hesitation sound; NOT "ah, I see" (reaction) |
| **you know** | ya know, y'know | Filler **unless** it's a real question or takes an object: "do you know…", "did you know…", "if you know…", "as you know…", "you know the answer" |

Evidence: listener-rating harm for um/uh (Laske & DiGennaro Reed 2024; Niebuhr & Fischer 2019); "you know" is a filler 95% of the time in human-labeled Switchboard conversations.

## Tier 2: Investigate (label every use as FILLER or NOT; not scored yet)

These are real words that are sometimes fillers. Hand labels will tell us how often each is a filler in student presentations and how accurate our detector is.

| Word | Filler use (label FILLER) | Real use (label NOT) |
|---|---|---|
| **like** | "it was, like, really hard"; "and then like the model" | "I like this", "looks like", "things like that", "like a tree" (comparison), "she was like 'no way'" (quotative, label QUOTE) |
| **I mean** | "it's, I mean, it's fine" (no correction follows) | "I mean the second model" (correcting/clarifying what was said) |
| **so** | "So… um… so yeah" (no logical link, used as a crutch) | "so the accuracy improved" (means "therefore"), "so far", "so much" |
| **well** | "Well, um, the idea is…" (sentence opener with no meaning) | "works well", "as well" |
| **actually** | "it's actually, actually kind of…" (no contrast) | "it actually decreased, unlike before" (real contrast) |
| **basically** | "basically we just, basically…" (no summary) | "basically, the model has two parts" (real summary) |
| **right?** / **okay?** | "…the input, right? and then, right?" (habit tag) | "is that right?" (real question), "okay, let's move on" (transition) |
| **kind of / sort of** | "it's kind of, sort of working" (hedge) | "a kind of neural network" |
| **literally** | used for emphasis only | literal meaning |
| **hmm / mm** | thinking sound mid-speech | agreement sound |

Rule of thumb: **if you can delete the word and the meaning doesn't change, it's a FILLER.**

## Also label (not filler words, but tracked)

| Label | What | Example |
|---|---|---|
| **REPEAT** | A word or phrase said twice in a row by accident | "the the model", "we, we can" (label the extra copy) |
| **RESTART** | A sentence abandoned and started over | "We trained— we tested the model" |
| **MUMBLE** | A word you can't make out clearly (swallowed, slurred, too quiet) | "it's ab-… able to answer" |

These matter because plain Whisper deletes them.

## Not fillers (don't label)

- Reactions: "oh", "wow"
- Laughter, coughs, breaths (if you want, note them as NOISE)
- Drawn-out real words ("theeee model"): mark as a hesitation only if you're also labeling pauses

---

# Hand-labeling guide

## Tools
- **Audacity** (free): open the audio → Edit → Labels → Add Label at Selection (Cmd+B). Select the stretch of the waveform, type the label. File → Export → Export Labels gives a text file with start, end and label.
- Or **Praat** (TextGrid tiers) if you know it.

## What to label for each clip

**Track 1: Fillers.** Select just the filler sound (or both words of "you know") and type the label:
- Tier 1: `um`, `uh`, `er`, `ah`, `you know`
- Tier 2: `like:FILLER` / `like:NOT` / `like:QUOTE`, `so:FILLER` / `so:NOT`, etc.
- Other: `REPEAT`, `RESTART`

**Track 2: Pauses** (for the VAD test). Every silence of **0.25 s or longer**:
- `PAUSE:IN`: inside a sentence ("we trained the ‖ model")
- `PAUSE:BETWEEN`: between sentences or phrases ("our method. ‖ Now")
- Select from where the sound stops to where it starts again. Breaths count as part of the pause.

**Track 3: Transcript.** A word-for-word transcript **including** every um, uh and repeated word (used to compute word error rate and word counts).

## Labeling rules
1. Label **every** occurrence, even quiet or very short ones.
2. Two fillers in a row ("um, uh") = **two labels**.
3. If unsure whether a Tier 2 word is a filler, label it `:UNSURE` and keep going. Don't skip it.
4. Use the standard labels exactly as written above (lowercase, `:FILLER` / `:NOT`).
5. Two people label the same 1–2 clips separately first, then compare and agree on edge cases before splitting up the rest.

## File format

Save each clip's labels as CSV (`annotations/<clip_id>.csv`):

| clip_id | track | start_s | end_s | label | annotator | notes |
|---|---|---|---|---|---|---|
| s01_p1 | filler | 12.40 | 12.71 | um | allen | |
| s01_p1 | filler | 15.02 | 15.30 | like:FILLER | allen | |
| s01_p1 | pause | 18.10 | 18.95 | PAUSE:IN | allen | |

Template: `data/annotation_template.csv`. Audacity export can be converted with a short script.

---

# How each tool will be compared

1. **Normalize** every tool's output to the standard labels (e.g. Whisper "Um," → `um`; "uhm" → `um`; "Uh-huh" → not a filler).
2. A tool's filler **matches** a hand label if it's the same standard label and the times overlap (allowing ±0.35 s).
3. For each tool and each filler word, report:
   - **Recall**: share of hand-labeled fillers the tool found
   - **Precision**: share of the tool's fillers that are real
   - **Rate error**: tool's fillers per 100 words vs. the hand count
4. For pauses (VAD vs. noise-adaptive detector vs. Whisper word gaps): recall and precision of pauses ≥ 0.25 s, and the rate of in-sentence pauses per speaking-minute vs. the hand count.

| Tool | Expected behavior (from our earlier tests) |
|---|---|
| Plain Whisper | Catches only ~13% of um/uh; drops repeats |
| Verbatim Whisper (`whisper_verbatim.py`) | Catches ~83% of um/uh; keeps repeats; can loop on noisy audio |
| Amazon Transcribe | Unknown: this test answers it |
| WebRTC VAD | Good on clean audio, fails in noisy rooms |
| Noise-adaptive detector (`pause_detect.py`) | Best so far; may over-count very short in-sentence pauses |

Code that applies this word bank automatically: `filler_rules.py` (`find_fillers`).
