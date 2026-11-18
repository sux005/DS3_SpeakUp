# Which pauses count: period rule vs comma rule

A pause only hurts the pause score when it is "inside a sentence". Until now the code
decided that from Transcribe's sentence punctuation: a pause after `.`, `?` or `!` was fine and
every other pause counted. That rule counts list pauses ("apples, | pears") and pauses before
and/but/so clauses as hesitations, which the hand labels call good.

## Rules tested

- **Period rule (what main did):** fine only after `.`, `?` or `!`.
- **Comma rule:** fine after `.`, `?`, `!` or `,`.
- **After um/uh:** a pause right after um or uh always counts, in every rule.
- **Repeat check:** a pause after a comma still counts when the 1 to 3 words after it repeat the
  words before it, skipping um/uh ("by saving, | saving money"). Periods are exempt, because good
  speakers repeat on purpose after a full stop ("three types of tears. | Tears of joy").

## Results

220 pauses marked by hand as good or bad on 7 two-minute clips (Links 13 to 19: a mix of
polished and hesitant speakers, including a Toastmasters world-championship final). Links
15 to 19 were marked blind, without seeing any model output. The clip score column counts how
many of the 7 clips get the same 0 to 4 pause score as the hand labels.

| Rule | Punctuation from | Agrees with hand labels | Clip score matches |
|---|---|---|---|
| Period (main before this PR) | Transcribe | 179/220 (81%) | 4/7 |
| Comma | Transcribe | 189/220 (86%) | 5/7 |
| Comma + repeat check (this PR) | Transcribe | 193/220 (88%) | 5/7 |
| Period | Whisper | 188/220 (85%) | 5/7 |
| Comma | Whisper | 194/220 (88%) | 6/7 |
| Comma + repeat check | Whisper | 197/220 (90%) | 5/7 |

The period rule gives the world-championship speech 1 or 3 out of 4 (hand label 4) because it
penalizes the speaker's list and dramatic pauses. The comma rule gives it 3 to 4.

## End-to-end check on the pipeline code

The table above comes from the research scripts. This one runs the real
`score_transcribe_items` on Transcribe's output for the same 7 clips, with energy + Silero pause
inputs from `src/audio/pause_detection.py` (the live path). "Found" = hand pauses the code also
detected. Agreement is on the found pauses.

| Version | Found | Agrees with hand labels | Clip score matches |
|---|---|---|---|
| Main before this PR | 144/220 | 111/144 (77%) | 5/7 |
| Comma rule only | 144/220 | 122/144 (85%) | 4/7 |
| Pause-finding fix only (period rule) | 205/220 | 163/205 (80%) | 3/7 |
| Both (this PR) | 205/220 | 172/205 (84%) | 5/7 |

The two changes need each other: finding more pauses with the period rule counts more list and
clause pauses as hesitations, and the comma rule alone cannot fix scores while a third of the
pauses are missing. With both, the clips that still miss are Link 14 (2 vs hand 0, hesitant
speaker) and Link 18 (3 vs hand 4, world-championship speech).

## What this PR does and does not do

- Uses the comma rule + repeat check on Transcribe's punctuation. No new model or AWS step.
- Whisper punctuation scores a little higher but would need a Whisper step in the pipeline just
  for punctuation (Transcribe would still give words, timing, WPM and fillers). Not included.
- Remaining misses are mostly hesitation commas in the middle of a phrase ("if you, | speaking")
  that no punctuation rule can tell apart from a list comma.
- Only 7 clips, so differences of 1 to 3 pauses are within noise.
