# SpeakUp Rubric

SpeakUp scores a speech on three things, each from 0 to 4:

1. **Speaking speed** (words per minute)
2. **Filler words** (um, uh, and similar)
3. **Pauses inside sentences** (hesitations)

The 0 to 4 scale and level names come from the Public Speaking Competence Rubric (Schreiber et al. 2012), which college speech classes use: 0 Deficient, 1 Minimal, 2 Basic, 3 Proficient, 4 Advanced.

This page explains each score, where the cutoffs came from, and how we checked them on real speeches. Longer write-ups: `FILLER_RUBRIC.md`, `PAUSE_RESEARCH.md`. The cutoffs live in `src/scoring/rubrics/speaking-2026-10-31.csv` and are applied by `src/scoring/rubric.py`.

---

## 1. Speaking speed (WPM)

**How it's measured:** spoken words divided by total minutes, from the first word to the last. Pauses count as time. Fillers don't count as words.

| Score | WPM |
|---|---|
| 4 | 135 to 155 |
| 3 | within 15 of that range (120 to 134, or 156 to 170) |
| 2 | within 30 (105 to 119, or 171 to 185) |
| 1 | within 45 (90 to 104, or 186 to 200) |
| 0 | under 90 or over 200 |

Being too slow and being too fast are penalized the same way.

**Why 135 to 155:**

| Source | What it shows |
|---|---|
| 2,273 TED talks (TED-LIUM) | Median 152 WPM. Middle half: 135 to 167 |
| 100 conference talks (NUTSHELL, ACL) | Median 140 WPM. Middle half: 127 to 158 |
| Wingrove 2017, Yuan et al. 2006 | Studies of lecture and conversation speed, used as a check on the range |
| Munro & Derwing 2001, Foulke & Sticht 1969 | Studies of what speeds listeners prefer and can follow, used as a check on the range |

The 4 band sits where the TED and conference medians overlap.

**What we found when testing:** famous TED speakers often talk fast (158 to 231 WPM in 10 well known talks), so many of them score a 2 or 3. We kept the range anyway. The goal is a speed most audiences can follow, not copying star speakers.

---

## 2. Filler words

**What counts:** um, uh, er, erm, ah, and "you know" (but not in phrases like "do you know"). Words like "like", "so" and "I mean" are shown to the user but not scored, since they often aren't fillers.

**How it's measured:** fillers per 100 spoken words.

| Score | Fillers per 100 words |
|---|---|
| 4 | under 2 |
| 3 | 2 to 3.5 |
| 2 | 3.5 to 5.5 |
| 1 | 5.5 to 8 |
| 0 | 8 or more |

**Why per 100 words and not per minute:** fast talkers say more of everything, including fillers. In 100 conference talks, fillers per minute was partly tied to speed (r = 0.26). Fillers per 100 words was not (r = 0.09). Speed already has its own score, so we don't want to count it twice.

**Where the cutoffs came from:**

| Source | Finding |
|---|---|
| Laske & DiGennaro Reed 2024 | Listeners rated speeches with fillers at 0, 2, 5 and 12 per minute. 5 a minute or fewer was fine. 12 a minute clearly hurt |
| Niebuhr & Fischer 2019 | 68 untrained managers averaged 6.3 fillers a minute. The more fillers listeners noticed, the worse they rated the talk |
| Our 100 conference talks | 6.2 fillers a minute, about the same as the managers |

At about 145 WPM, 5 a minute is about 3.5 per 100 words (the bottom of a 3) and 12 a minute is about 8 per 100 words (a 0).

**What we found when testing:**

| Speeches | Result |
|---|---|
| 18 TED talks | 15 of 18 scored a 4 |
| Conference talks (ACL) | Median 2.96 per 100 words, a 3 |
| 2 thesis defenses (hand checked) | Scored 0 and 1 |
| 6 street interviews | Spread from 0 to 4 |

Polished speakers score high and hesitant ones score low, which is what we want.

**Model note:** normal Whisper leaves most fillers out of its transcript. It caught only 13% of um/uh. Our "verbatim" Whisper setup caught 83%. The team has since picked Amazon Transcribe, which keeps um/uh. James is checking its filler accuracy.

---

## 3. Pauses inside sentences

**What counts:** a silence of 0.3 seconds or more in the middle of a sentence, like "We trained the ‖ model". Pauses between sentences are fine and are not scored.

**How it's measured:** pauses inside sentences per minute of speaking time. Speaking time is total time minus all pauses.

| Score | Inside-sentence pauses per speaking minute |
|---|---|
| 4 | under 9 |
| 3 | 9 to 12 |
| 2 | 12 to 15 |
| 1 | 15 to 18 |
| 0 | 18 or more |

**Why 0.3 seconds:**

| Source | Finding |
|---|---|
| Goldman-Eisler 1968 | Silences under about 0.25 s are just the mouth moving between sounds, not hesitation |
| De Jong & Bosker 2013 | Tested every cutoff on 51 speakers. 0.25 to 0.3 s worked best |
| Our choice | 0.3 s, the top of that best range. It also cuts down on tiny gaps the detector over-counts |

**Why per speaking minute:** per 100 words, pause counts were strongly tied to speed (r = -0.52). Per speaking minute, they weren't (r = -0.09).

**Why these cutoffs and not the research ones:** we started with Kahng 2014 (fluent speakers 6.6 a minute, less fluent 13.8). When we measured exactly, even TED speakers paused 8 to 25 times a minute, so most of them scored 0. That said more about how we measure than about the speakers. So we set the bands from our own data:

| Speeches | Median pauses per speaking minute | Average score with our bands |
|---|---|---|
| 18 TED talks | 9.0 | 3.2 (15 of 18 score 3 or 4) |
| Hesitant clips (defenses, street interviews) | about 15 | 1.5 |

With the Kahng bands, TED averaged only 2.3.

**Rules we decided on:**
- Two silences less than 0.3 s apart with no word between them count as one pause
- A pause right after "um" counts as inside the sentence. The speaker gets marked for the filler and for the pause. That's on purpose
- A pause between a period and "um" counts as between sentences
- A new thought starting with "and" counts as a new sentence

---

## 4. Models proposed (tested 11/09, not on main yet)

This section is a proposal. `main` still finds pauses from Transcribe word gaps. The method below will go up as its own PR.

| Job | Pick | Why |
|---|---|---|
| Speech to text | Amazon Transcribe | Team pick. Keeps um and uh, and gives a time for every word |
| Finding pauses | Volume detector at 0.3 s, plus any spot where Silero hears no talking AND the transcript has a word gap | Caught the most hand pauses on both blind clips |
| Inside vs between | Transcribe's own punctuation (a period right before the pause means "between") | Beat the extra punctuation model on Links 13, 14 and 16, and needs no extra model |
| Noise cleanup | DeepFilterNet (already on main, PR #5) | Neither cleaner changed the pause results in these tests |

Not used: the punctuation model (oliverguhr), PANNs, and the breathing check.

**Finding the pauses.** Tested on two clips we marked blind: Link 15 (TED talk, 21 pauses, 8 with laughter, clapping or breathing) and Link 16 (student class speech, 20 pauses, tongue clicks in 11, background static in the last 2).

| Method | Link 15 found | Link 15 real | Link 16 found | Link 16 real |
|---|---|---|---|---|
| Volume (energy) detector, 0.3 s | 18 of 21 | 71% | 19 of 20 | 95% |
| Silero (AI model that hears talking) | 15 of 21 | 89% | 19 of 20 | 90% |
| Gaps between words in Transcribe's output | 18 of 21 | 86% | 19 of 20 | 90% |
| **Volume, plus Silero and a word gap agreeing** | **20 of 21** | **74%** | **19 of 20** | **95%** |

"Real" is the share of detections that matched a hand pause.

The volume detector misses pauses filled with laughter or clapping because they aren't quiet. The "Silero hears no talking AND the transcript has a gap" check fills those in, and it was never wrong on either clip (9 of 9, then 15 of 15). The only misses left were a breathing pause on Link 15 and a pause on Link 16 that is exactly 0.3 s, right at the cutoff. Tongue clicks and the static didn't throw anything off.

We tried an extra breathing rule. It caught the Link 15 breath but only added false pauses on Link 16, so we dropped it.

Noise cleanup (DeepFilterNet and RNNoise) barely changed anything on either clip. DeepFilterNet did cut the Link 16 static by about 7 dB, but Silero then missed 2 more pauses.

**Deciding inside vs between a sentence.**

| Method | Links 13 and 14 (78 pauses) | Link 15 (21, blind) | Link 16 (20, blind) |
|---|---|---|---|
| Transcribe's own punctuation | 94% | 71% | 95% |
| Punctuation model (oliverguhr) on Transcribe's text | 82% | 76% | 90% |
| Whisper's own punctuation | not fair to compare (we labeled from its text) | 86% | 100% |

Transcribe seems to put periods where people pause, so it struggles with speakers who pause for effect mid-sentence, like Link 15. Whisper did best, but it isn't part of our pipeline.

On the final pause score, Transcribe's punctuation matched the hand score on all four clips. The punctuation model gave Link 13 a 1 instead of a 2. Link 16 scored a 4 in every setup.

---

## 5. Still open

- The pause bands come from 18 TED talks and a few hesitant clips. Links 15 and 16 were both fluent, so we still need hesitant student speeches.
- List pauses: Link 16 had two pauses inside a sentence but between items of a list ("first, the history ‖ secondly, the popularity"). We haven't decided if these should count. On Link 16 it doesn't change the score.
