# Proposed voice analysis contract

Status: proposal, 2026-11-22. No separate voice model or voice score is implemented.

## Decision to make

The current pipeline already measures speaking rate, scored fillers, and pauses from the timed transcript and prepared audio. A new stage should only be added if it answers a different question, such as whether the speaker's volume is consistent or speech is intelligible. The product owner should select the exact attributes and decide whether each is diagnostic or scored before model selection or UI work.

## Candidate output

One versioned, owner-scoped artifact per recording, using the prepared audio rather than browser speech-recognition text:

```json
{
  "schema_version": 1,
  "recording_id": "recording-id",
  "source_audio_version_id": "s3-version-id",
  "model_name": "chosen-model",
  "model_version": "pinned-version",
  "status": "complete",
  "measurements": {
    "volume_consistency": {"value": null, "unit": null, "confidence": null},
    "intelligibility": {"value": null, "unit": null, "confidence": null}
  },
  "segments": []
}
```

`segments` should contain only timestamped evidence needed for review, with explicit start and end seconds and the attribute observed. A failed or ineligible analysis should report a reason and leave measurements null. It must not invent values or silently substitute transcript-based pace, filler, or pause scores.

## Acceptance checks before scoring

- Specify the target speakers, recording conditions, supported languages, minimum usable duration, and handling of clipping or background noise.
- Define each metric's units, interpretation, confidence or quality threshold, and a human-labeled evaluation set. Compare repeated runs and devices before claiming improvement.
- Pin the model and artifact versions. Keep original audio immutable and retain the source version ID so a replay can be attributed to the exact input.
- Keep this output diagnostic until a reviewed rubric maps measured values to scores. Existing pace, filler, and pause scores remain authoritative.
