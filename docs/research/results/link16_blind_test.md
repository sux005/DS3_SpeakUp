# Link 16 (Vandervort COM 100 student speech, blind pass): raw vs cleaned audio

Answer key: Allen's blind tracker, 20 pauses. Notes: tongue click in 11, static from ~2:40 in 2 (#19, #20), list pauses #3 and #7. Script: `link16_tests.py`.

## 1. Each hand pause: PANNs speech probability and loudness inside the pause (dB, per audio version)

| # | time | dur | Allen | note | speech prob | pause dB raw | pause dB df | pause dB rn |
|---|---|---|---|---|---|---|---|---|
| 1 | 1:02.71 | 1.01 | BETWEEN | click  | 0.39 | -49 | -48 | -49 |
| 2 | 1:07.69 | 0.95 | BETWEEN | click  | 0.32 | -56 | -56 | -56 |
| 3 | 1:13.32 | 0.32 | IN | list | 0.49 | -65 | -65 | -65 |
| 4 | 1:19.02 | 0.97 | BETWEEN | - | 0.57 | -50 | -48 | -50 |
| 5 | 1:29.64 | 1.46 | BETWEEN | click  | 0.29 | -49 | -46 | -48 |
| 6 | 1:39.01 | 0.75 | BETWEEN | click  | 0.53 | -47 | -44 | -47 |
| 7 | 1:41.18 | 0.46 | IN | click list | 0.56 | -54 | -52 | -53 |
| 8 | 1:47.12 | 0.57 | BETWEEN | click  | 0.59 | -47 | -49 | -46 |
| 9 | 1:51.64 | 0.63 | IN | - | 0.39 | -59 | -62 | -59 |
| 10 | 1:56.08 | 0.95 | BETWEEN | click  | 0.26 | -50 | -49 | -50 |
| 11 | 2:00.84 | 0.96 | BETWEEN | - | 0.64 | -67 | -65 | -66 |
| 12 | 2:04.57 | 1.07 | BETWEEN | click  | 0.47 | -46 | -43 | -46 |
| 13 | 2:10.76 | 0.57 | BETWEEN | - | 0.56 | -70 | -76 | -70 |
| 14 | 2:15.07 | 0.94 | BETWEEN | click  | 0.65 | -48 | -45 | -48 |
| 15 | 2:16.69 | 0.33 | IN | - | 0.61 | -65 | -67 | -64 |
| 16 | 2:20.44 | 0.72 | BETWEEN | click  | 0.66 | -53 | -50 | -52 |
| 17 | 2:27.23 | 0.75 | BETWEEN | click  | 0.66 | -52 | -49 | -52 |
| 18 | 2:33.90 | 0.97 | BETWEEN | - | 0.76 | -67 | -66 | -67 |
| 19 | 2:43.96 | 1.33 | BETWEEN | static  | 0.48 | -51 | -60 | -51 |
| 20 | 2:52.10 | 0.98 | BETWEEN | static  | 0.69 | -48 | -53 | -47 |

Noise floor before vs during the static:

| audio | pause dB before 2:40 (median) | pause dB with static (median) | quietest 10% of frames before 2:40 | quietest 10% after 2:40 |
|---|---|---|---|---|
| raw audio | -52.6 | -49.5 | -65.3 | -50.5 |
| DeepFilterNet (PR #5) | -49.6 | -56.1 | -66.5 | -57.4 |
| RNNoise (main) | -52.2 | -49.4 | -64.8 | -50.4 |

## 2. Finding the pauses (>= 0.3 s)

hand caught = Allen's pauses with an overlapping detection; real = detections overlapping one of Allen's pauses; errors = median start/end offset (s).

| audio | detector | found | hand caught | click caught | static caught | real | start err | end err |
|---|---|---|---|---|---|---|---|---|
| raw audio | energy | 22 | 19/20 | 11/11 | 2/2 | 21/22 (95%) | 0.04 | 0.22 |
| raw audio | silero | 21 | 19/20 | 11/11 | 2/2 | 19/21 (90%) | 0.06 | 0.03 |
| raw audio | panns | 33 | 13/20 | 8/11 | 1/2 | 13/33 (39%) | 0.44 | 0.81 |
| raw audio | whisper gaps | 21 | 18/20 | 11/11 | 2/2 | 18/21 (86%) | 0.20 | 0.27 |
| raw audio | transcribe gaps | 21 | 19/20 | 11/11 | 2/2 | 19/21 (90%) | 0.05 | 0.03 |
| raw audio | silero+words | 15 | 15/20 | 9/11 | 2/2 | 15/15 (100%) | 0.06 | 0.29 |
| raw audio | energy/s+w | 22 | 19/20 | 11/11 | 2/2 | 21/22 (95%) | 0.04 | 0.22 |
| raw audio | T-unvoiced | 19 | 17/20 | 11/11 | 1/2 | 17/19 (89%) | 0.05 | 0.03 |
| raw audio | energy/s+w/T-unvoiced | 24 | 19/20 | 11/11 | 2/2 | 21/24 (88%) | 0.04 | 0.22 |
| DeepFilterNet (PR #5) | energy | 20 | 19/20 | 11/11 | 2/2 | 20/20 (100%) | 0.04 | 0.24 |
| DeepFilterNet (PR #5) | silero | 18 | 17/20 | 9/11 | 2/2 | 17/18 (94%) | 0.06 | 0.03 |
| DeepFilterNet (PR #5) | panns | 30 | 11/20 | 8/11 | 1/2 | 11/30 (37%) | 0.42 | 0.65 |
| DeepFilterNet (PR #5) | whisper gaps | 22 | 18/20 | 11/11 | 2/2 | 18/22 (82%) | 0.19 | 0.29 |
| DeepFilterNet (PR #5) | transcribe gaps | 21 | 19/20 | 11/11 | 2/2 | 19/21 (90%) | 0.06 | 0.04 |
| DeepFilterNet (PR #5) | silero+words | 13 | 13/20 | 8/11 | 2/2 | 13/13 (100%) | 0.06 | 0.29 |
| DeepFilterNet (PR #5) | energy/s+w | 20 | 19/20 | 11/11 | 2/2 | 20/20 (100%) | 0.04 | 0.24 |
| DeepFilterNet (PR #5) | T-unvoiced | 18 | 16/20 | 10/11 | 1/2 | 16/18 (89%) | 0.05 | 0.04 |
| DeepFilterNet (PR #5) | energy/s+w/T-unvoiced | 22 | 19/20 | 11/11 | 2/2 | 20/22 (91%) | 0.04 | 0.24 |
| RNNoise (main) | energy | 23 | 19/20 | 11/11 | 2/2 | 21/23 (91%) | 0.04 | 0.22 |
| RNNoise (main) | silero | 21 | 19/20 | 11/11 | 2/2 | 19/21 (90%) | 0.06 | 0.03 |
| RNNoise (main) | panns | 35 | 13/20 | 8/11 | 1/2 | 13/35 (37%) | 0.44 | 0.88 |
| RNNoise (main) | whisper gaps | 21 | 19/20 | 11/11 | 2/2 | 19/21 (90%) | 0.20 | 0.25 |
| RNNoise (main) | transcribe gaps | 21 | 19/20 | 11/11 | 2/2 | 19/21 (90%) | 0.05 | 0.03 |
| RNNoise (main) | silero+words | 14 | 14/20 | 9/11 | 2/2 | 14/14 (100%) | 0.06 | 0.27 |
| RNNoise (main) | energy/s+w | 23 | 19/20 | 11/11 | 2/2 | 21/23 (91%) | 0.04 | 0.22 |
| RNNoise (main) | T-unvoiced | 19 | 17/20 | 11/11 | 1/2 | 17/19 (89%) | 0.05 | 0.03 |
| RNNoise (main) | energy/s+w/T-unvoiced | 25 | 19/20 | 11/11 | 2/2 | 21/25 (84%) | 0.04 | 0.22 |

Per pause (x = caught):

| # | time | dur | note | raw energy | raw silero | raw energy|s+w | df energy | df silero | df energy|s+w | rn energy | rn silero | rn energy|s+w | raw transcribe gaps | raw energy|s+w|T-unvoiced | df transcribe gaps | df energy|s+w|T-unvoiced | rn transcribe gaps | rn energy|s+w|T-unvoiced |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1:02.71 | 1.01 | click  | x | x | x | x | x | x | x | x | x | x | x | x | x | x | x |
| 2 | 1:07.69 | 0.95 | click  | x | x | x | x | x | x | x | x | x | x | x | x | x | x | x |
| 3 | 1:13.32 | 0.32 | list | x | x | x | x | x | x | x | x | x | x | x | x | x | x | x |
| 4 | 1:19.02 | 0.97 | - | x | x | x | x | x | x | x | x | x | x | x | x | x | x | x |
| 5 | 1:29.64 | 1.46 | click  | x | x | x | x | x | x | x | x | x | x | x | x | x | x | x |
| 6 | 1:39.01 | 0.75 | click  | x | x | x | x | . | x | x | x | x | x | x | x | x | x | x |
| 7 | 1:41.18 | 0.46 | click list | x | x | x | x | . | x | x | x | x | x | x | x | x | x | x |
| 8 | 1:47.12 | 0.57 | click  | x | x | x | x | x | x | x | x | x | x | x | x | x | x | x |
| 9 | 1:51.64 | 0.63 | - | x | x | x | x | x | x | x | x | x | x | x | x | x | x | x |
| 10 | 1:56.08 | 0.95 | click  | x | x | x | x | x | x | x | x | x | x | x | x | x | x | x |
| 11 | 2:00.84 | 0.96 | - | x | x | x | x | x | x | x | x | x | x | x | x | x | x | x |
| 12 | 2:04.57 | 1.07 | click  | x | x | x | x | x | x | x | x | x | x | x | x | x | x | x |
| 13 | 2:10.76 | 0.57 | - | x | x | x | x | x | x | x | x | x | x | x | x | x | x | x |
| 14 | 2:15.07 | 0.94 | click  | x | x | x | x | x | x | x | x | x | x | x | x | x | x | x |
| 15 | 2:16.69 | 0.33 | - | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . |
| 16 | 2:20.44 | 0.72 | click  | x | x | x | x | x | x | x | x | x | x | x | x | x | x | x |
| 17 | 2:27.23 | 0.75 | click  | x | x | x | x | x | x | x | x | x | x | x | x | x | x | x |
| 18 | 2:33.90 | 0.97 | - | x | x | x | x | x | x | x | x | x | x | x | x | x | x | x |
| 19 | 2:43.96 | 1.33 | static  | x | x | x | x | x | x | x | x | x | x | x | x | x | x | x |
| 20 | 2:52.10 | 0.98 | static  | x | x | x | x | x | x | x | x | x | x | x | x | x | x | x |

## 3. Inside vs between

| setup | what | agree | IN caught | BETWEEN caught |
|---|---|---|---|---|
| W raw | Whisper punctuation, raw audio | 20/20 (100%) | 4/4 | 16/16 |
| WB raw | Whisper + oliverguhr, raw audio | 17/20 (85%) | 3/4 | 14/16 |
| T raw | Transcribe punctuation, raw audio | 19/20 (95%) | 3/4 | 16/16 |
| TB raw | Transcribe + oliverguhr, raw audio | 18/20 (90%) | 3/4 | 15/16 |
| W df | Whisper punctuation, DeepFilterNet (PR #5) | 20/20 (100%) | 4/4 | 16/16 |
| WB df | Whisper + oliverguhr, DeepFilterNet (PR #5) | 17/20 (85%) | 3/4 | 14/16 |
| T df | Transcribe punctuation, DeepFilterNet (PR #5) | 19/20 (95%) | 3/4 | 16/16 |
| TB df | Transcribe + oliverguhr, DeepFilterNet (PR #5) | 18/20 (90%) | 3/4 | 15/16 |
| W rn | Whisper punctuation, RNNoise (main) | 20/20 (100%) | 4/4 | 16/16 |
| WB rn | Whisper + oliverguhr, RNNoise (main) | 17/20 (85%) | 3/4 | 14/16 |
| T rn | Transcribe punctuation, RNNoise (main) | 19/20 (95%) | 3/4 | 16/16 |
| TB rn | Transcribe + oliverguhr, RNNoise (main) | 18/20 (90%) | 3/4 | 15/16 |

Disagreements (raw audio setups):

| # | time | Allen | W raw | WB raw | T raw | TB raw | words T raw |
|---|---|---|---|---|---|---|---|
| 5 | 1:29.64 | BETWEEN | BETWEEN | IN | BETWEEN | BETWEEN | of the gold card. ‖ Coffee is an integral |
| 6 | 1:39.01 | BETWEEN | BETWEEN | IN | BETWEEN | IN | so important among many. ‖ First, the history of |
| 7 | 1:41.18 | IN | IN | BETWEEN | BETWEEN | BETWEEN | history of its origin. ‖ Secondly, the popularity of |

## 4. Pause score (Allen's pauses, each setup's IN/BETWEEN call; list pauses #3 #7 counted and not)

| setup | IN pauses | per speaking-min | score | IN without list pauses | score without list pauses |
|---|---|---|---|---|---|
| Allen | 4 | 2.3 | 4 | 2 | 4 |
| W raw | 4 | 2.3 | 4 | 2 | 4 |
| WB raw | 5 | 2.9 | 4 | 4 | 4 |
| T raw | 3 | 1.7 | 4 | 2 | 4 |
| TB raw | 4 | 2.3 | 4 | 3 | 4 |
| W df | 4 | 2.3 | 4 | 2 | 4 |
| WB df | 5 | 2.9 | 4 | 4 | 4 |
| T df | 3 | 1.7 | 4 | 2 | 4 |
| TB df | 4 | 2.3 | 4 | 3 | 4 |
| W rn | 4 | 2.3 | 4 | 2 | 4 |
| WB rn | 5 | 2.9 | 4 | 4 | 4 |
| T rn | 3 | 1.7 | 4 | 2 | 4 |
| TB rn | 4 | 2.3 | 4 | 3 | 4 |

