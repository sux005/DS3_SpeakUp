# Hand Measure - 2: punctuation model test (Links 13, 14)

Answer key: Allen's pause tracker tables in the meeting-notes doc (snapshot 2026-11-01). Model: oliverguhr/fullstop-punctuation-multilang-large on the verbatim-Whisper transcript. Script: `hm2_punct.py` + `hm2_punct_report.py`.

## 1. Allen's notes applied

| clip | detector rows | merged pairs | dropped (no pause) | moved by Allen | pauses kept | kept >= 0.3 s |
|---|---|---|---|---|---|---|
| Link 13 | 38 | 2 | 0 | 2 | 36 | 34 |
| Link 14 | 51 | 3 | 2 | 12 | 46 | 44 |

- Merged pauses use the full span (start of first to end of second), per the rubric's one-pause rule. The doc's duration cell for merged rows is the sum of the two silences, so it reads shorter (e.g. L13 #25: doc 1.17 s, span 1.47 s).
- L13 #10 and #11 are 0.27 s apart with no word between them in the transcript, so the rubric would count them as one pause. Kept as two here, as in the doc.

## 2. Setups

| setup | what |
|---|---|
| A | Model, um/uh removed (pipeline design) |
| B | Model, um/uh kept |
| W | Whisper's own punctuation (baseline) |
| C | A + pause before and/but/so = BETWEEN (exploratory) |

Every setup labels the same pauses, placed by Allen's words (time is used only for the 7 rows with no words). Label = punctuation after the last real word before the pause (um/uh skipped): `.` `?` = BETWEEN, `,` `:` `-` or nothing = IN.

## 3. Accuracy vs Allen (all kept pauses)

| clip | setup | agree | IN caught (recall) | IN calls right (precision) | BETWEEN caught |
|---|---|---|---|---|---|
| Link 13 | A | 31/36 (86%) | 24/24 (100%) | 24/29 (83%) | 7/12 (58%) |
| Link 13 | B | 28/36 (78%) | 24/24 (100%) | 24/32 (75%) | 4/12 (33%) |
| Link 13 | W | 35/36 (97%) | 24/24 (100%) | 24/25 (96%) | 11/12 (92%) |
| Link 13 | C | 32/36 (89%) | 23/24 (96%) | 23/26 (88%) | 9/12 (75%) |
| Link 14 | A | 39/46 (85%) | 32/33 (97%) | 32/38 (84%) | 7/13 (54%) |
| Link 14 | B | 40/46 (87%) | 32/33 (97%) | 32/37 (86%) | 8/13 (62%) |
| Link 14 | W | 45/46 (98%) | 32/33 (97%) | 32/32 (100%) | 13/13 (100%) |
| Link 14 | C | 40/46 (87%) | 28/33 (85%) | 28/29 (97%) | 12/13 (92%) |
| Both | A | 70/82 (85%) | 56/57 (98%) | 56/67 (84%) | 14/25 (56%) |
| Both | B | 68/82 (83%) | 56/57 (98%) | 56/69 (81%) | 12/25 (48%) |
| Both | W | 80/82 (98%) | 56/57 (98%) | 56/57 (98%) | 24/25 (96%) |
| Both | C | 72/82 (88%) | 51/57 (89%) | 51/55 (93%) | 21/25 (84%) |

Same thing on pauses >= 0.3 s only (what the rubric counts):

| setup | agree | IN caught (recall) | IN calls right (precision) | BETWEEN caught |
|---|---|---|---|---|
| A | 67/78 (86%) | 53/54 (98%) | 53/63 (84%) | 14/24 (58%) |
| B | 65/78 (83%) | 53/54 (98%) | 53/65 (82%) | 12/24 (50%) |
| W | 77/78 (99%) | 53/54 (98%) | 53/53 (100%) | 24/24 (100%) |
| C | 70/78 (90%) | 49/54 (91%) | 49/52 (94%) | 21/24 (88%) |

## 4. Setup A confusion (both clips)

|  | model: no punct (IN) | model: , (IN) | model: . or ? (BETWEEN) |
|---|---|---|---|
| Allen: IN | 49 | 7 | 1 |
| Allen: BETWEEN | 5 | 6 | 14 |

## 5. Pause score (IN pauses >= 0.3 s per speaking-minute)

| clip | speaking min | WPM (Whisper) | Allen | A | B | W | C |
|---|---|---|---|---|---|---|---|
| Link 13 | 1.68 | 150.0 | 23 -> 13.7/min -> 2 | 27 -> 16.1/min -> 1 | 30 -> 17.9/min -> 1 | 23 -> 13.7/min -> 2 | 24 -> 14.3/min -> 2 |
| Link 14 | 1.6 | 140.0 | 31 -> 19.4/min -> 0 | 36 -> 22.5/min -> 0 | 35 -> 21.9/min -> 0 | 30 -> 18.8/min -> 0 | 28 -> 17.5/min -> 1 |

Cells: IN pauses -> per speaking-minute -> 0-4 score. Bands: 4 <9, 3 <12, 2 <15, 1 <18, 0 >=18.

## 6. Every setup-A disagreement

| clip | # | time | dur | words (‖ = pause) | Allen | model | C fixes? |
|---|---|---|---|---|---|---|---|
| 13 | 4 | 50:18.54 | 0.27 | before the question? Okay, ‖ all right. Um, first | BETWEEN | IN (phrase) | no |
| 13 | 5 | 50:19.89 | 0.33 | question? Okay, all right. ‖ Um, first and foremost, | BETWEEN | IN (phrase) | no |
| 13 | 6 | 50:20.58 | 0.3 | Okay, all right. Um, ‖ first and foremost, I'd | BETWEEN | IN (phrase) | no |
| 13 | 10 | 50:34.14 | 0.39 | time in our discussions. ‖ And, uh, since then, | BETWEEN | IN (phrase) | yes |
| 13 | 11 | 50:34.80 | 0.33 | time in our discussions. ‖ And, uh, since then, | BETWEEN | IN (phrase) | yes |
| 14 | 8 | 9:39.53 | 0.93 | students, but he persevered. ‖ And, um, I I | BETWEEN | IN (mid) | yes |
| 14 | 11 | 9:43.76 | 0.33 | he's a great colleague. ‖ He's a great friend. | BETWEEN | IN (phrase) | no |
| 14 | 15 | 9:48.92 | 0.39 | his friends here. Um, ‖ he's wonderful to to | IN | BETWEEN (sentence) | no |
| 14 | 26 | 10:10.43 | 1.08 | project related to cancer. ‖ And, uh, we have | BETWEEN | IN (mid) | yes |
| 14 | 33 | 10:24.83 | 0.84 | there was no conclusion. ‖ And we really needed | BETWEEN | IN (mid) | yes |
| 14 | 37 | 10:34.76 | 0.99 | up to the challenge. ‖ And I'm very proud | BETWEEN | IN (mid) | yes |
| 14 | 38 | 10:37.73 | 0.96 | proud of his accomplishments. ‖ And, uh, especially the | BETWEEN | IN (mid) | yes |

New errors setup C adds:

| clip | # | words (‖ = pause) | Allen |
|---|---|---|---|
| 13 | 23 | respect your efforts, um, ‖ and this project would | IN |
| 14 | 22 | we we traveled internationally ‖ and he's a good | IN |
| 14 | 32 | project. It was solid, ‖ but there was no | IN |
| 14 | 47 | do search in PubMed, ‖ and you put, uh, | IN |
| 14 | 49 | put, uh, dot, myc, ‖ and, uh, proteasome, uh, | IN |

## 7. All pauses

### Link 13

| # | start | dur | status | words (‖ = pause) | Allen | A | A punct | B | W |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 50:13.89 | 0.39 | as detected | Okay, so, um, ‖ I have a few | IN | IN | mid | IN | IN |
| 2 | 50:15.81 | 0.39 | as detected | few acknowledgements, but should ‖ we, uh, do those | IN | IN | mid | IN | IN |
| 3 | 50:17.79 | 0.54 | as detected | first before the question? ‖ Okay, all right. Um, | BETWEEN | BETWEEN | sentence | BETWEEN | BETWEEN |
| 4 | 50:18.54 | 0.27 | as detected | before the question? Okay, ‖ all right. Um, first | BETWEEN | IN | phrase | IN | IN |
| 5 | 50:19.89 | 0.33 | as detected | question? Okay, all right. ‖ Um, first and foremost, | BETWEEN | IN | phrase | IN | BETWEEN |
| 6 | 50:20.58 | 0.3 | as detected | Okay, all right. Um, ‖ first and foremost, I'd | BETWEEN | IN | phrase | IN | BETWEEN |
| 7 | 50:24.72 | 0.39 | as detected | advisor, for these past, ‖ oh, well, five years | IN | IN | phrase | IN | IN |
| 8 | 50:25.77 | 0.33 | as detected | for these past, oh, ‖ well, five years for | IN | IN | mid | IN | IN |
| 9 | 50:31.02 | 0.45 | as detected | came to MIT, I ‖ was wrong almost all | IN | IN | mid | IN | IN |
| 10 | 50:34.14 | 0.39 | as detected | time in our discussions. ‖ And, uh, since then, | BETWEEN | IN | phrase | IN | BETWEEN |
| 11 | 50:34.80 | 0.33 | as detected | time in our discussions. ‖ And, uh, since then, | BETWEEN | IN | phrase | IN | BETWEEN |
| 12 | 50:36.60 | 0.72 | as detected | uh, since then, we've, ‖ um, had more interesting | IN | IN | mid | IN | IN |
| 13 | 50:37.83 | 0.33 | as detected | since then, we've, um, ‖ had more interesting discussions | IN | IN | mid | IN | IN |
| 14 | 50:45.60 | 0.36 | as detected | respect your vision that's ‖ allowed me to, um, | IN | IN | mid | IN | IN |
| 15 | 50:48.81 | 0.63 | as detected | um, gain that understanding. ‖ Um, I I have | BETWEEN | BETWEEN | sentence | IN | BETWEEN |
| 16 | 50:52.68 | 0.3 | as detected | lot about science in ‖ my time here, um, | IN | IN | mid | IN | IN |
| 17 | 50:56.52 | 1.26 | as detected | way, in my opinion. ‖ I'd like to thank | BETWEEN | BETWEEN | sentence | BETWEEN | BETWEEN |
| 18 | 51:02.37 | 0.75 | as detected | Brandenmark, MD, PhD, um, ‖ taking his father's work | IN | IN | phrase | IN | IN |
| 19 | 51:05.55 | 0.6 | as detected | implants and actually finding ‖ a completely different but | IN | IN | mid | IN | IN |
| 20 | 51:11.85 | 0.57 | as detected | of work to get ‖ OSE integration, um, working | IN | IN | mid | IN | IN |
| 21 | 51:13.35 | 0.33 | as detected | get OSE integration, um, ‖ working at all levels | IN | IN | mid | IN | IN |
| 22 | 51:16.20 | 0.45 | as detected | And so I I ‖ respect your efforts, um, | IN | IN | mid | IN | IN |
| 23 | 51:17.76 | 0.72 | as detected | respect your efforts, um, ‖ and this project would | IN | IN | mid | IN | IN |
| 24 | 51:20.85 | 1.47 | as detected | been possible without you. ‖ Um, finally, I'd like | BETWEEN | BETWEEN | sentence | BETWEEN | BETWEEN |
| 25 | 51:24.09 | 1.47 | merged #25+#26 | like to thank, uh, ‖ uh, Nidhi Sitappati, um, | IN | IN | mid | IN | IN |
| 27 | 51:26.52 | 0.27 | as detected | uh, uh, Nidhi Sitappati, ‖ um, uh, my third | IN | IN | phrase | IN | IN |
| 28 | 51:29.70 | 0.75 | as detected | my third committee member. ‖ Uh, you know, Hogan, | BETWEEN | BETWEEN | sentence | IN | BETWEEN |
| 29 | 51:34.23 | 0.87 | merged #29+#30 | Hogan, Neville Hogan, um, ‖ he is, uh, he's | IN | IN | mid | IN | IN |
| 31 | 51:38.37 | 0.51 | as detected | is, uh, he's getting ‖ more mature. Um, and | IN | IN | mid | IN | IN |
| 32 | 51:42.81 | 0.3 | moved by Allen | out 40 years ago. ‖ We need Impedance Control | BETWEEN | BETWEEN | sentence | BETWEEN | BETWEEN |
| 33 | 51:44.82 | 0.6 | as detected | Impedance Control V2 to ‖ make the next step | IN | IN | mid | IN | IN |
| 34 | 51:47.94 | 0.36 | as detected | function improvement in, um, ‖ rehabilitation, in my opinion. | IN | IN | mid | IN | IN |
| 35 | 51:54.18 | 0.63 | as detected | type of work, and ‖ I respect that. So, | IN | IN | mid | IN | IN |
| 36 | 51:56.70 | 0.39 | as detected | respect that. So, um, ‖ thank you for doing | IN | IN | mid | IN | IN |
| 37 | 51:57.96 | 0.57 | moved by Allen | um, thank you for ‖ doing research in your | IN | IN | mid | IN | IN |
| 38 | 52:07.80 | 0.66 | as detected | time here. Thank you. ‖ Uh, I'd like to | BETWEEN | BETWEEN | sentence | IN | BETWEEN |

### Link 14

| # | start | dur | status | words (‖ = pause) | Allen | A | A punct | B | W |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 9:11.39 | 0.3 | as detected | He worked, uh, ‖ with postdocs, uh, for | IN | IN | mid | IN | IN |
| 2 | 9:12.47 | 0.96 | as detected | uh, with postdocs, uh, ‖ for a few years | IN | IN | mid | IN | IN |
| 3 | 9:20.57 | 0.48 | as detected | or mentor to undergrads. ‖ Um, there was a | BETWEEN | BETWEEN | sentence | BETWEEN | BETWEEN |
| 4 | 9:23.15 | 0.33 | as detected | was a period in ‖ the middle that was | IN | IN | mid | IN | IN |
| 5 | 9:26.09 | 0.42 | as detected | with, uh, with COVID ‖ that was, uh, trying | IN | IN | phrase | IN | IN |
| 6 | 9:27.26 | 0.66 | as detected | COVID that was, uh, ‖ trying period, where Guillen | IN | IN | mid | IN | IN |
| 7 | 9:29.12 | 0.33 | as detected | was, uh, trying period, ‖ where Guillen was my | IN | IN | mid | IN | IN |
| 8 | 9:39.53 | 0.93 | merged #8+#9, moved by Allen | students, but he persevered. ‖ And, um, I I | BETWEEN | IN | mid | IN | BETWEEN |
| 10 | 9:41.27 | 0.54 | as detected | he persevered. And, um, ‖ I I want to | IN | IN | mid | IN | IN |
| 11 | 9:43.76 | 0.33 | as detected | he's a great colleague. ‖ He's a great friend. | BETWEEN | IN | phrase | IN | BETWEEN |
| 12 | 9:45.32 | 0.39 | as detected | great friend. I that's ‖ why I see a | IN | IN | mid | IN | IN |
| 13 | 9:46.16 | 0.27 | as detected | I that's why I ‖ see a lot of | IN | IN | mid | IN | IN |
| 14 | 9:47.96 | 0.3 | as detected | of his friends here. ‖ Um, he's wonderful to | BETWEEN | BETWEEN | sentence | BETWEEN | BETWEEN |
| 15 | 9:48.92 | 0.39 | as detected | his friends here. Um, ‖ he's wonderful to to | IN | BETWEEN | sentence | BETWEEN | BETWEEN |
| 16 | 9:49.55 | 0.33 | as detected | here. Um, he's wonderful ‖ to to to give | IN | IN | mid | IN | IN |
| 17 | 9:53.60 | 0.63 | as detected | and help anybody who ‖ needs his help. He's | IN | IN | mid | IN | IN |
| 18 | 9:54.26 | 0.48 | as detected | help anybody who needs ‖ his help. He's excited | IN | IN | mid | IN | IN |
| 19 | 9:55.16 | 0.6 | as detected | who needs his help. ‖ He's excited to present | BETWEEN | BETWEEN | sentence | BETWEEN | BETWEEN |
| 20 | 9:56.00 | 0.36 | moved by Allen | needs his help. He's ‖ excited to present his | IN | IN | mid | IN | IN |
| 21 | 9:57.77 | 0.39 | as detected | present his work and ‖ we we traveled internationally | IN | IN | mid | IN | IN |
| 22 | 9:59.36 | 0.27 | as detected | we we traveled internationally ‖ and he's a good | IN | IN | mid | IN | IN |
| 23 | 10:03.02 | 0.81 | merged #23+#24 | had good time in ‖ Glasgow. But scientifically, Guillen | IN | IN | mid | IN | IN |
| 25 | 10:04.94 | 0.66 | moved by Allen | good time in Glasgow. ‖ But scientifically, Guillen really | BETWEEN | BETWEEN | sentence | BETWEEN | BETWEEN |
| 26 | 10:10.43 | 1.08 | as detected | project related to cancer. ‖ And, uh, we have | BETWEEN | IN | mid | IN | BETWEEN |
| 27 | 10:12.29 | 0.57 | as detected | to cancer. And, uh, ‖ we have this exciting | IN | IN | mid | IN | IN |
| 28 | 10:15.02 | 0.36 | as detected | this exciting but, um, ‖ very challenging project that | IN | IN | mid | IN | IN |
| 29 | 10:16.79 | 0.45 | as detected | very challenging project that ‖ was that had a | IN | IN | mid | IN | IN |
| 30 | 10:18.83 | 0.87 | as detected | that had a beginning. ‖ A lot of people | BETWEEN | BETWEEN | sentence | BETWEEN | BETWEEN |
| 31 | 10:22.67 | 0.33 | dropped (no pause) | - | - | - | - | - | - |
| 32 | 10:23.36 | 0.51 | moved by Allen | project. It was solid, ‖ but there was no | IN | IN | phrase | IN | IN |
| 33 | 10:24.83 | 0.84 | as detected | there was no conclusion. ‖ And we really needed | BETWEEN | IN | mid | IN | BETWEEN |
| 34 | 10:29.42 | 0.33 | as detected | this hurdle and find ‖ a reasonable conclusion for | IN | IN | mid | IN | IN |
| 35 | 10:31.58 | 0.33 | moved by Allen | a reasonable conclusion for ‖ the story. And Guillen | IN | IN | mid | IN | IN |
| 36 | 10:32.60 | 0.33 | moved by Allen | conclusion for the story. ‖ And Guillen was up | BETWEEN | BETWEEN | sentence | BETWEEN | BETWEEN |
| 37 | 10:34.76 | 0.99 | moved by Allen | up to the challenge. ‖ And I'm very proud | BETWEEN | IN | mid | IN | BETWEEN |
| 38 | 10:37.73 | 0.96 | merged #38+#39, moved by Allen | proud of his accomplishments. ‖ And, uh, especially the | BETWEEN | IN | mid | BETWEEN | BETWEEN |
| 40 | 10:39.32 | 0.3 | moved by Allen | his accomplishments. And, uh, ‖ especially the last two | IN | IN | mid | IN | IN |
| 41 | 10:43.37 | 0.78 | moved by Allen | designed beautiful experiments and ‖ seeing that his hypothesis | IN | IN | mid | IN | IN |
| 42 | 10:48.05 | 0.51 | as detected | satisfying, I'm sure. And ‖ he essentially did genetic | IN | IN | mid | IN | IN |
| 43 | 10:54.62 | 0.69 | as detected | do in C. elegans. ‖ And, um, if you, | BETWEEN | BETWEEN | sentence | BETWEEN | BETWEEN |
| 44 | 10:55.34 | 0.39 | as detected | in C. elegans. And, ‖ um, if you, speaking | IN | IN | mid | IN | IN |
| 45 | 10:56.51 | 0.36 | as detected | C. elegans. And, um, ‖ if you, speaking about | IN | IN | mid | IN | IN |
| 46 | 10:57.41 | 0.3 | moved by Allen | And, um, if you, ‖ speaking about novelty of | IN | IN | mid | IN | IN |
| 47 | 11:02.03 | 0.57 | moved by Allen | do search in PubMed, ‖ and you put, uh, | IN | IN | mid | IN | IN |
| 48 | 11:04.07 | 0.33 | as detected | you put, uh, dot, ‖ myc, and, uh, proteasome, | IN | IN | phrase | IN | IN |
| 49 | 11:04.61 | 0.72 | as detected | put, uh, dot, myc, ‖ and, uh, proteasome, uh, | IN | IN | mid | IN | IN |
| 50 | 11:06.83 | 0.75 | as detected | myc, and, uh, proteasome, ‖ uh, meaning combination of | IN | IN | phrase | IN | IN |
| 51 | 11:09.29 | 0.27 | dropped (no pause) | - | - | - | - | - | - |

