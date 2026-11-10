# Link 15 (Headlee TED, blind pass): raw vs cleaned audio

Answer key: Allen's blind tracker, 21 pauses (8 noisy: laughter, clapping, breathing, mumbling or noise in the notes). Script: `link15_tests.py`.

## 1. What fills each hand pause (PANNs on raw audio)

Mean speech probability and peak laughter / applause / breathing probability inside each pause.

| # | time | dur | Allen | note | speech | laughter | applause | breathing |
|---|---|---|---|---|---|---|---|---|
| 1 | 3:01.99 | 0.4 | IN | - | 0.53 | 0.00 | 0.00 | 0.00 |
| 2 | 3:03.60 | 1.23 | BETWEEN | - | 0.32 | 0.00 | 0.00 | 0.01 |
| 3 | 3:09.03 | 0.45 | IN | - | 0.43 | 0.00 | 0.00 | 0.00 |
| 4 | 3:12.74 | 0.57 | BETWEEN | - | 0.69 | 0.00 | 0.00 | 0.00 |
| 5 | 3:17.02 | 0.84 | BETWEEN | - | 0.76 | 0.25 | 0.00 | 0.00 |
| 6 | 3:20.71 | 0.33 | BETWEEN | - | 0.75 | 0.00 | 0.00 | 0.00 |
| 7 | 3:23.75 | 3.04 | BETWEEN | Laughter in background, speaker not actually  | 0.16 | 0.26 | 0.12 | 0.00 |
| 8 | 3:32.62 | 1.24 | IN | More laughter at the end but the speaker is p | 0.53 | 0.30 | 0.00 | 0.00 |
| 9 | 3:35.06 | 4.71 | BETWEEN | More laughter and clapping | 0.24 | 0.35 | 0.10 | 0.00 |
| 10 | 3:45.24 | 0.46 | BETWEEN | Breathing sound | 0.49 | 0.00 | 0.00 | 0.00 |
| 11 | 3:47.30 | 0.83 | IN | Laughing mumble | 0.53 | 0.00 | 0.00 | 0.01 |
| 12 | 3:58.45 | 0.33 | IN | Very brief pause but not very noticeable | 0.49 | 0.00 | 0.00 | 0.00 |
| 13 | 4:00.33 | 0.54 | BETWEEN | Little background noise | 0.68 | 0.03 | 0.00 | 0.00 |
| 14 | 4:08.52 | 0.43 | BETWEEN | Some breathing sounds | 0.37 | 0.00 | 0.00 | 0.00 |
| 15 | 4:12.93 | 0.71 | BETWEEN | Slight breathing sounds | 0.70 | 0.00 | 0.00 | 0.00 |
| 16 | 4:27.42 | 0.49 | BETWEEN | - | 0.67 | 0.01 | 0.00 | 0.00 |
| 17 | 4:36.62 | 0.48 | BETWEEN | - | 0.58 | 0.00 | 0.00 | 0.00 |
| 18 | 4:38.90 | 0.52 | BETWEEN | - | 0.49 | 0.00 | 0.00 | 0.00 |
| 19 | 4:49.67 | 0.66 | BETWEEN | - | 0.75 | 0.00 | 0.00 | 0.00 |
| 20 | 4:50.83 | 0.38 | IN | Marked as inside sentence but it may also be  | 0.71 | 0.00 | 0.00 | 0.00 |
| 21 | 4:52.39 | 0.38 | BETWEEN | - | 0.50 | 0.00 | 0.00 | 0.01 |

## 2. Finding the pauses (>= 0.3 s)

hand caught = Allen's pauses with an overlapping detection; real = detections that overlap one of Allen's pauses; errors = median start/end offset in seconds.

| audio | detector | found | hand caught | clean caught | noisy caught | real | start err | end err |
|---|---|---|---|---|---|---|---|---|
| raw audio | energy | 28 | 18/21 | 12/13 | 6/8 | 20/28 (71%) | 0.08 | 0.03 |
| raw audio | silero | 18 | 15/21 | 10/13 | 5/8 | 16/18 (89%) | 0.07 | 0.06 |
| raw audio | panns | 32 | 12/21 | 6/13 | 6/8 | 12/32 (38%) | 0.10 | 0.34 |
| raw audio | whisper gaps | 20 | 17/21 | 10/13 | 7/8 | 17/20 (85%) | 0.24 | 0.17 |
| raw audio | transcribe gaps | 21 | 18/21 | 11/13 | 7/8 | 18/21 (86%) | 0.08 | 0.03 |
| raw audio | silero+words | 9 | 8/21 | 5/13 | 3/8 | 9/9 (100%) | 0.10 | 0.05 |
| raw audio | energy/s+w | 31 | 20/21 | 13/13 | 7/8 | 23/31 (74%) | 0.09 | 0.03 |
| DeepFilterNet (PR #5) | energy | 28 | 17/21 | 12/13 | 5/8 | 21/28 (75%) | 0.07 | 0.02 |
| DeepFilterNet (PR #5) | silero | 17 | 16/21 | 10/13 | 6/8 | 16/17 (94%) | 0.06 | 0.05 |
| DeepFilterNet (PR #5) | panns | 32 | 12/21 | 6/13 | 6/8 | 12/32 (38%) | 0.08 | 0.32 |
| DeepFilterNet (PR #5) | whisper gaps | 20 | 17/21 | 10/13 | 7/8 | 17/20 (85%) | 0.24 | 0.17 |
| DeepFilterNet (PR #5) | transcribe gaps | 23 | 18/21 | 11/13 | 7/8 | 18/23 (78%) | 0.08 | 0.04 |
| DeepFilterNet (PR #5) | silero+words | 9 | 9/21 | 6/13 | 3/8 | 9/9 (100%) | 0.06 | 0.17 |
| DeepFilterNet (PR #5) | energy/s+w | 30 | 19/21 | 13/13 | 6/8 | 23/30 (77%) | 0.07 | 0.02 |
| RNNoise (main) | energy | 30 | 19/21 | 13/13 | 6/8 | 21/30 (70%) | 0.07 | 0.03 |
| RNNoise (main) | silero | 18 | 16/21 | 11/13 | 5/8 | 17/18 (94%) | 0.03 | 0.04 |
| RNNoise (main) | panns | 34 | 12/21 | 6/13 | 6/8 | 12/34 (35%) | 0.10 | 0.34 |
| RNNoise (main) | whisper gaps | 19 | 15/21 | 9/13 | 6/8 | 15/19 (79%) | 0.26 | 0.17 |
| RNNoise (main) | transcribe gaps | 20 | 17/21 | 10/13 | 7/8 | 17/20 (85%) | 0.08 | 0.03 |
| RNNoise (main) | silero+words | 9 | 9/21 | 7/13 | 2/8 | 9/9 (100%) | 0.06 | 0.06 |
| RNNoise (main) | energy/s+w | 31 | 20/21 | 13/13 | 7/8 | 22/31 (71%) | 0.07 | 0.03 |

Per pause (x = caught):

| # | time | dur | note | raw energy | raw silero | raw silero+words | df energy | df silero | df silero+words | rn energy | rn silero | rn silero+words |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 3:01.99 | 0.4 | - | x | . | . | x | . | . | x | . | . |
| 2 | 3:03.60 | 1.23 | - | x | x | x | x | x | x | x | x | x |
| 3 | 3:09.03 | 0.45 | - | x | x | . | x | x | x | x | x | x |
| 4 | 3:12.74 | 0.57 | - | x | x | x | . | x | x | x | x | x |
| 5 | 3:17.02 | 0.84 | - | . | x | x | x | x | x | x | x | x |
| 6 | 3:20.71 | 0.33 | - | x | x | . | x | x | . | x | x | . |
| 7 | 3:23.75 | 3.04 | Laughter in background, speaker not actu | x | x | x | x | x | x | x | x | x |
| 8 | 3:32.62 | 1.24 | More laughter at the end but the speaker | x | x | x | x | x | x | x | x | . |
| 9 | 3:35.06 | 4.71 | More laughter and clapping | . | x | x | . | x | x | . | x | x |
| 10 | 3:45.24 | 0.46 | Breathing sound | . | . | . | . | . | . | . | . | . |
| 11 | 3:47.30 | 0.83 | Laughing mumble | x | . | . | x | x | . | x | . | . |
| 12 | 3:58.45 | 0.33 | Very brief pause but not very noticeable | x | . | . | x | . | . | x | . | . |
| 13 | 4:00.33 | 0.54 | Little background noise | x | x | . | x | x | . | x | x | . |
| 14 | 4:08.52 | 0.43 | Some breathing sounds | x | . | . | . | . | . | x | . | . |
| 15 | 4:12.93 | 0.71 | Slight breathing sounds | x | x | . | x | x | . | x | x | . |
| 16 | 4:27.42 | 0.49 | - | x | x | x | x | x | x | x | x | x |
| 17 | 4:36.62 | 0.48 | - | x | x | . | x | x | . | x | x | x |
| 18 | 4:38.90 | 0.52 | - | x | x | . | x | x | . | x | x | . |
| 19 | 4:49.67 | 0.66 | - | x | x | x | x | x | x | x | x | . |
| 20 | 4:50.83 | 0.38 | Marked as inside sentence but it may als | x | . | . | x | . | . | x | x | x |
| 21 | 4:52.39 | 0.38 | - | x | x | . | x | x | . | x | x | . |

## 3. Inside vs between

| setup | what | agree | IN caught | BETWEEN caught |
|---|---|---|---|---|
| W raw | Whisper punctuation, raw audio | 18/21 (86%) | 6/6 | 12/15 |
| WB raw | Whisper + oliverguhr, raw audio | 16/21 (76%) | 6/6 | 10/15 |
| T raw | Transcribe punctuation, raw audio | 15/21 (71%) | 5/6 | 10/15 |
| TB raw | Transcribe + oliverguhr, raw audio | 16/21 (76%) | 6/6 | 10/15 |
| W df | Whisper punctuation, DeepFilterNet (PR #5) | 18/21 (86%) | 6/6 | 12/15 |
| WB df | Whisper + oliverguhr, DeepFilterNet (PR #5) | 17/21 (81%) | 6/6 | 11/15 |
| T df | Transcribe punctuation, DeepFilterNet (PR #5) | 15/21 (71%) | 5/6 | 10/15 |
| TB df | Transcribe + oliverguhr, DeepFilterNet (PR #5) | 16/21 (76%) | 6/6 | 10/15 |
| W rn | Whisper punctuation, RNNoise (main) | 20/21 (95%) | 6/6 | 14/15 |
| WB rn | Whisper + oliverguhr, RNNoise (main) | 19/21 (90%) | 6/6 | 13/15 |
| T rn | Transcribe punctuation, RNNoise (main) | 15/21 (71%) | 5/6 | 10/15 |
| TB rn | Transcribe + oliverguhr, RNNoise (main) | 16/21 (76%) | 6/6 | 10/15 |

Disagreements (raw audio setups):

| # | time | Allen | W raw | WB raw | T raw | TB raw | words W raw |
|---|---|---|---|---|---|---|---|
| 4 | 3:12.74 | BETWEEN | IN | IN | IN | IN | to discuss in advance, ‖ look, uh, nod and |
| 5 | 3:17.02 | BETWEEN | IN | IN | IN | IN | that you're paying attention, ‖ repeat back what you |
| 8 | 3:32.62 | IN | IN | IN | BETWEEN | IN | you are, in fact, ‖ paying attention. Now, I |
| 9 | 3:35.06 | BETWEEN | BETWEEN | BETWEEN | IN | BETWEEN | in fact, paying attention. ‖ Now, I actually use |
| 14 | 4:08.52 | BETWEEN | IN | IN | IN | IN | feeling engaged and inspired ‖ or where you feel |
| 17 | 4:36.62 | BETWEEN | BETWEEN | IN | IN | IN | I mean, be present. ‖ Be in that moment. |
| 21 | 4:52.39 | BETWEEN | BETWEEN | IN | BETWEEN | IN | Number two, don't pontificate. ‖ If you wanted to |

## 4. Pause score (IN pauses per speaking-minute, Allen's pauses, each setup's IN/BETWEEN call)

| setup | IN pauses | per speaking-min | score |
|---|---|---|---|
| Allen | 6 | 3.6 | 4 |
| W raw | 9 | 5.3 | 4 |
| WB raw | 11 | 6.5 | 4 |
| T raw | 10 | 5.9 | 4 |
| TB raw | 11 | 6.5 | 4 |
| W df | 9 | 5.3 | 4 |
| WB df | 10 | 5.9 | 4 |
| T df | 10 | 5.9 | 4 |
| TB df | 11 | 6.5 | 4 |
| W rn | 7 | 4.2 | 4 |
| WB rn | 8 | 4.8 | 4 |
| T rn | 10 | 5.9 | 4 |
| TB rn | 11 | 6.5 | 4 |

