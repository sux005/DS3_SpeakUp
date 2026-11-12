# Hand Measure - 2: Amazon Transcribe, pauses only

Answer key: Allen's doc pauses with notes applied, >= 0.3 s (78 pauses). Script: `transcribe_pauses_hm2.py`.

## 0. What came back

| clip | Transcribe words | Transcribe um/uh | Whisper words | Whisper um/uh |
|---|---|---|---|---|
| Link 13 | 329 | 28 | 328 | 28 |
| Link 14 | 306 | 20 | 296 | 17 |

## 1. Word gaps as a pause detector (>= 0.3 s)

| clip | detector | found | hand caught | detections real | median start error (s) | median end error (s) |
|---|---|---|---|---|---|---|
| Link 13 | Transcribe gaps | 38 | 25/34 (74%) | 24/38 (63%) | 0.13 | 0.02 |
| Link 13 | Whisper gaps | 34 | 19/34 (56%) | 18/34 (53%) | 0.25 | 0.12 |
| Link 13 | Energy 0.3 s | 33 | 31/34 (91%) | 33/33 (100%) | 0.0 | 0.0 |
| Link 14 | Transcribe gaps | 19 | 17/44 (39%) | 16/19 (84%) | 0.35 | 0.03 |
| Link 14 | Whisper gaps | 20 | 18/44 (41%) | 17/20 (85%) | 0.11 | 0.2 |
| Link 14 | Energy 0.3 s | 41 | 40/44 (91%) | 40/41 (98%) | 0.0 | 0.0 |

Energy is favoured: Allen's pause list started from the energy detector's output.

Hand pauses with no Transcribe word gap:

| clip | # | time | dur | words | Allen |
|---|---|---|---|---|---|
| 13 | 2 | 50:15.81 | 0.39 | but should [#2 0.39s]we, uh, do those firs | IN |
| 13 | 13 | 50:37.83 | 0.33 | Um, [#13 0.33s]had more interesting discussions | IN |
| 13 | 14 | 50:45.60 | 0.36 | respect your vision that's [#14 0.36s]allowed me to | IN |
| 13 | 16 | 50:52.68 | 0.3 | about 50:52science in [#16 0.30s]my time here | IN |
| 13 | 21 | 51:13.35 | 0.33 | OSE integration, um, [#21 0.33s]working at all levels of amp | IN |
| 13 | 22 | 51:16.20 | 0.45 | And so I - I [#22 0.45s]respect your efforts, | IN |
| 13 | 32 | 51:42.81 | 0.3 | years ago. [#32 0.30s] We need Impedance Control V2 | BETWEEN |
| 13 | 34 | 51:47.94 | 0.36 | mprovement in, um, [#34 0.36s]rehabilitation, in my | IN |
| 13 | 36 | 51:56.70 | 0.39 | So, um, [#36 0.39s]thank you for doing | IN |
| 14 | 4 | 9:23.15 | 0.33 | there was a period in [#4 0.33s]the middle that was coincide | IN |
| 14 | 5 | 9:26.09 | 0.42 | with, uh, with COVID [#5 0.42s]that was, uh | IN |
| 14 | 6 | 9:27.26 | 0.66 | that was, uh, [#6 0.66s]trying period | IN |
| 14 | 7 | 9:29.12 | 0.33 | trying period, [#7 0.33s]where Guillen was my lab | IN |
| 14 | 10 | 9:41.27 | 0.54 | And, um, [#10 0.54s]9:41I - I want to say that he's | IN |
| 14 | 11 | 9:43.76 | 0.33 | great colleague. [#11 0.33s]He's a great friend. | BETWEEN |
| 14 | 12 | 9:45.32 | 0.39 | I - that's [#12 0.39s]why I | IN |
| 14 | 14 | 9:47.96 | 0.3 | his friends here. [#14 0.30s]Um, | BETWEEN |
| 14 | 15 | 9:48.92 | 0.39 | Um, [#15 0.39s]he's wonderful | IN |
| 14 | 16 | 9:49.55 | 0.33 | he's wonderful [#16 0.33s]to - 9:51to - to give | IN |
| 14 | 17 | 9:53.60 | 0.63 | help anybody who [#17 0.63s]needs | IN |
| 14 | 18 | 9:54.26 | 0.48 | needs [#18 0.48s]his help. | IN |
| 14 | 19 | 9:55.16 | 0.6 | his help. [#19 0.60s]He's excited | BETWEEN |
| 14 | 20 | 9:56.00 | 0.36 | He's[#20 0.36s] excited to present his work | IN |
| 14 | 21 | 9:57.77 | 0.39 | present his work and [#21 0.39s]we - we traveled internation | IN |
| 14 | 27 | 10:12.29 | 0.57 | And, uh, [#27 0.57s]we have this exciting but | IN |
| 14 | 28 | 10:15.02 | 0.36 | this exciting but, um, [#28 0.36s]very challenging project | IN |
| 14 | 29 | 10:16.79 | 0.45 | challenging project that [#29 0.45s]was - that had | IN |
| 14 | 32 | 10:23.36 | 0.51 | solid, [#32 0.51s] but there was no conclusion. | IN |
| 14 | 34 | 10:29.42 | 0.33 | hurdle and find [#34 0.33s]a reasonable conclusion | IN |
| 14 | 35 | 10:31.58 | 0.33 | reasonable conclusion 10:31for [#35 0.33s]the story | IN |
| 14 | 36 | 10:32.60 | 0.33 | story. [#36 0.33s]And Guillen was up to the challenge. | BETWEEN |
| 14 | 40 | 10:39.32 | 0.3 | uh,[#40 0.30s] especially the last two years | IN |
| 14 | 45 | 10:56.51 | 0.36 | um, [#45 0.36s]if you, speaking | IN |
| 14 | 46 | 10:57.41 | 0.3 | if you, [#46 0.30s]speaking about novelty of what | IN |
| 14 | 47 | 11:02.03 | 0.57 | search 11:01in PubMed,[#47 0.57s] and you put, uh, | IN |
| 14 | 48 | 11:04.07 | 0.33 | you put, uh, dot, [#48 0.33s]myc, | IN |

## 2. Inside vs between sentences

| setup | what |
|---|---|
| T | Transcribe's own punctuation |
| TB | oliverguhr on Transcribe text, um/uh kept |
| W | Whisper's own punctuation |
| B | oliverguhr on Whisper text, um/uh kept |

Placed by Allen's words in Transcribe's transcript for 70/78 pauses (time for the rest).

| clip | setup | agree | IN caught | IN calls right | BETWEEN caught |
|---|---|---|---|---|---|
| Link 13 | T | 31/34 (91%) | 23/23 (100%) | 23/26 (88%) | 8/11 (73%) |
| Link 13 | TB | 28/34 (82%) | 23/23 (100%) | 23/29 (79%) | 5/11 (45%) |
| Link 13 | W | 33/34 (97%) | 23/23 (100%) | 23/24 (96%) | 10/11 (91%) |
| Link 13 | B | 27/34 (79%) | 23/23 (100%) | 23/30 (77%) | 4/11 (36%) |
| Link 14 | T | 42/44 (95%) | 31/31 (100%) | 31/33 (94%) | 11/13 (85%) |
| Link 14 | TB | 37/44 (84%) | 31/31 (100%) | 31/38 (82%) | 6/13 (46%) |
| Link 14 | W | 44/44 (100%) | 31/31 (100%) | 31/31 (100%) | 13/13 (100%) |
| Link 14 | B | 39/44 (89%) | 31/31 (100%) | 31/36 (86%) | 8/13 (62%) |
| Both | T | 73/78 (94%) | 54/54 (100%) | 54/59 (92%) | 19/24 (79%) |
| Both | TB | 65/78 (83%) | 54/54 (100%) | 54/67 (81%) | 11/24 (46%) |
| Both | W | 77/78 (99%) | 54/54 (100%) | 54/55 (98%) | 23/24 (96%) |
| Both | B | 66/78 (85%) | 54/54 (100%) | 54/66 (82%) | 12/24 (50%) |

## 3. Pause score (IN pauses per speaking-minute -> 0-4)

| clip | speaking min | Allen | T | TB | W | B |
|---|---|---|---|---|---|---|
| Link 13 | 1.67 | 23 -> 13.8/min -> 2 | 26 -> 15.5/min -> 1 | 29 -> 17.3/min -> 1 | 24 -> 14.4/min -> 2 | 30 -> 17.9/min -> 1 |
| Link 14 | 1.6 | 31 -> 19.4/min -> 0 | 33 -> 20.7/min -> 0 | 38 -> 23.8/min -> 0 | 31 -> 19.4/min -> 0 | 36 -> 22.6/min -> 0 |

## 4. Disagreements with Allen (T and TB)

| clip | # | time | dur | Transcribe words (‖ = pause) | Allen | T | TB | W |
|---|---|---|---|---|---|---|---|---|
| 13 | 5 | 50:19.89 | 0.33 | question? OK, all right. ‖ Um, first and foremost, | BETWEEN | BETWEEN | IN | BETWEEN |
| 13 | 6 | 50:20.58 | 0.3 | OK, all right. Um, ‖ first and foremost, I'd | BETWEEN | IN | IN | IN |
| 13 | 10 | 50:34.14 | 0.39 | time in our discussions. ‖ And uh since then | BETWEEN | BETWEEN | IN | BETWEEN |
| 13 | 11 | 50:34.80 | 0.33 | time in our discussions. ‖ And uh since then | BETWEEN | BETWEEN | IN | BETWEEN |
| 13 | 15 | 50:48.81 | 0.63 | um gain that understanding ‖ um I I have | BETWEEN | IN | BETWEEN | BETWEEN |
| 13 | 28 | 51:29.70 | 0.75 | my third committee member, ‖ uh, you know, Hogan, | BETWEEN | IN | IN | BETWEEN |
| 13 | 38 | 52:07.80 | 0.66 | time here thank you. ‖ Uh, I'd like to | BETWEEN | BETWEEN | IN | BETWEEN |
| 14 | 8 | 9:39.53 | 0.93 | students but he persevered. ‖ And um I, I | BETWEEN | BETWEEN | IN | BETWEEN |
| 14 | 11 | 9:43.76 | 0.33 | he's a great colleague. ‖ He's a great friend. | BETWEEN | BETWEEN | IN | BETWEEN |
| 14 | 26 | 10:10.43 | 1.08 | project related to cancer. ‖ And uh we have | BETWEEN | BETWEEN | IN | BETWEEN |
| 14 | 33 | 10:24.83 | 0.84 | there was no conclusion. ‖ And we really needed | BETWEEN | BETWEEN | IN | BETWEEN |
| 14 | 36 | 10:32.60 | 0.33 | conclusion for the story, ‖ and Guillen was up | BETWEEN | IN | BETWEEN | BETWEEN |
| 14 | 37 | 10:34.76 | 0.99 | up to the challenge. ‖ And I'm very proud | BETWEEN | BETWEEN | IN | BETWEEN |
| 14 | 38 | 10:37.73 | 0.96 | proud of his accomplishments ‖ and uh especially the | BETWEEN | IN | IN | BETWEEN |
| 14 | 43 | 10:54.62 | 0.69 | do in C. elegans. ‖ And um if you, | BETWEEN | BETWEEN | IN | BETWEEN |

