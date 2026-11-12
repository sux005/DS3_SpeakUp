# Frontend

James's frontend application is not present on this branch yet. Framework-neutral
mock responses for the wireframe are available in
[`sample-payloads/`](sample-payloads/README.md). The backend is designed for an
authenticated client, and its current request and response contract is in
[the payload API guide](../docs/aws-payload-api.md). Deployment CORS settings
and the proposed microphone and file-picker flows are in
[the infrastructure guide](../infra/README.md).

The client will authenticate with Cognito, create a project, reserve an upload
with the file's content type, byte length, and Base64 SHA-256, send the original
bytes with all returned signed headers, confirm the upload, and request
processing. Project entries do not contain recording counts or references;
recordings identify their project and are listed through
`GET /projects/{projectId}/recordings`. A completed review then loads
`transcript`, `analysis`, and `feedback` from the owner-checked artifact route.

There is no frontend build or run command yet because James's source tree is
not in this checkout. The checked-in tests validate the full review mock JSON
against the public-field contract, but they do not exercise a browser UI.
## Recording review screen contract

After a recording reaches `COMPLETE`, request
`GET /recordings/{recordingId}/review`. When `feedback` is null, show the timed
transcript and `summary_metrics` without coaching cards. Otherwise show four coaching cards for general
speech, pace (including WPM), filler words, and pauses. Each card should put
the measured value or observation beside the specific `next_step`, so the user
can see what to practice. Keep the short overview above the cards.

For the planned playback view, use the transcript's timed `items` to highlight
words as the audio plays. Mark intervals from `feedback.moments` on that same
timeline. Selecting a marked phrase should seek to its `start_seconds` and
show its `observation` and `next_step`; use `kind` to distinguish a strength
from an improvement. Moment timing is based on Transcribe word positions, and
not every phrase will have feedback. Older feedback artifacts have only a
summary string, so the review screen should still display that summary.
