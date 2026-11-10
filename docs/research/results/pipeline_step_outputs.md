# What comes out of each step (Link 16 example)

Clip: Link 16, a student class speech (2 minutes). Script: `pipeline_outputs.py` (research repo). The files are not in this repo; this page describes their format.

| Step | File | Format | What it holds |
|---|---|---|---|
| 1. Amazon Transcribe | `1_transcribe_raw.json` | JSON | Full transcript text, plus one item per word (start time, end time, confidence) and one item per punctuation mark. Trimmed to the first 12 items here |
| 2. Volume (energy) detector | `2_energy_pauses.json` | list of `{start, end, seconds}` | Every stretch quieter than the clip's threshold for 0.3 s or more |
| 3. Silero | `3_silero_speech_segments.json` | list of `{start, end}` | Where Silero hears talking. The gaps between these are "no talking" |
| 4. Word gaps + Silero check | `4_word_gaps_and_silero_check.json` | two lists of `{start, end, seconds}` | Gaps of 0.3 s or more between Transcribe words, and the spots where Silero and a word gap agree |
| 5. Final pauses | `5_final_pauses.json` | list of `{start, end, seconds, sentence}` | Volume pauses plus the Silero/word gap ones, merged (two silences under 0.3 s apart with no word between = one pause). `sentence` is "inside" or "between", from Transcribe's punctuation |
| 6. Rubric scores | `6_rubric_metrics.json` | JSON | The team scorer's output (`src/scoring/rubric.py`): word count, WPM, fillers, pause counts and rates, long pauses, and the three 0 to 4 scores. This is what gets saved as `summary_metrics` |
| 7a. Bedrock request | `7a_bedrock_request.json` | JSON | What we send: the system prompt, and a user message holding the step 6 metrics plus the transcript text |
| 7b. Bedrock raw response | `7b_bedrock_raw_response.json` | JSON | What Bedrock sends back: the reply text, why it stopped, and token counts |
| 7c. Saved feedback | `7c_feedback_saved_to_s3.json` | `{feedback, model_id}` | Only the reply text and model name. This is the file the app saves |

Times are seconds from the start of the clip. Times in steps 2 to 5 are the clip's, not the video's (Link 16 starts at 1:00 in the video).

## Link 16 numbers

- 387 words in 119.9 s (104.2 s of speaking): 193.7 WPM, score 1
- 0 fillers: score 4
- 3 pauses inside sentences, 18 between (Transcribe word gaps, team code): 1.7 per speaking minute, score 4
- Final pause list from step 5 (our new method): 21 pauses, 2 inside

## What's wrong with the Bedrock feedback right now

Model: Amazon Nova Lite (the team default), same prompt as the team code, run twice.

- The reply is free text (markdown headings and bullets), not JSON. The app can't pull out parts like "strengths" without parsing text
- It never mentions the scores or the numbers, even though they're in the input
- Run 1 said to slow down (right, 194 WPM). Run 2 didn't mention speed at all, the one thing this speaker most needs
- Both runs said to "reduce pauses, especially between sentences". That's wrong: her pause score is 4, and we never count pauses between sentences against anyone
- Both runs added a random section called "Polite Response to Roast Queries" that has nothing to do with the speech

Next step: rewrite the prompt so it explains what each metric means and how it's scored, and ask for JSON with fixed fields.
