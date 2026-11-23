# Frontend

The Next.js frontend lives in [`web/`](web/README.md). It runs a local
fixture-backed preview by default and can connect to the AWS workflow through
its development-only guest bridge. Framework-neutral mock responses for the
wireframe are available in
[`sample-payloads/`](sample-payloads/README.md). The backend is designed for an
authenticated client, and its current request and response contract is in
[the payload API guide](../docs/aws-payload-api.md). Deployment CORS settings
and the proposed microphone and file-picker flows are in
[the infrastructure guide](../infra/README.md).

An authenticated client creates a project, reserves
an upload with the file's content type, byte length, and Base64 SHA-256, then
sends the original bytes with all returned signed headers. The S3 object event
starts processing automatically. Project entries do not contain recording counts or references;
recordings identify their project and are listed through
`GET /projects/{projectId}/recordings`. A completed review can load the
transcript, compact metrics, and optional feedback from `/review`; fetch the
owner-checked `analysis` artifact separately for timed filler and pause markers.

Recording, the single start/resume countdown, Pause / Resume, preview, and
retakes are local UI actions. Paused time does not use the active recording
limit. In live mode, **Start presentation with audio** on the home form or New attempt page is
the write boundary for project creation and audio upload. The page still reads
session, project, and limit data on load. Browser speech recognition provides
provisional live words and pace; the live UI does not show filler counts. A
browser vendor may process speech for recognition. Only the submitted audio enters SpeakUp's scoring
pipeline. The retake confirmation's **Don't show again** choice is stored in
that browser's `localStorage`, not in the user account. See the
[web app guide](web/README.md#recording-and-submission-boundary) for details.

Run and check the app with the commands in [`web/README.md`](web/README.md).
The browser tests exercise local and intercepted live flows; they do not prove
an authenticated deployed workflow.

## Recording review screen contract

After a recording reaches `COMPLETE`, request
`GET /recordings/{recordingId}/review`. When `feedback` is null, show the timed
transcript and `summary_metrics` without category coaching. The current page
shows three metric cards: pace (including WPM), filler words, and pauses.
When feedback exists, its category observations and `next_step` text appear
with those cards; general coaching appears in the takeaway and next-step
sections above them.

The playback view uses the transcript's timed `items` to highlight
words as the audio plays. It marks intervals from `feedback.moments` on the
same timeline. Selecting a marked phrase seeks to its `start_seconds` and
shows its `observation` and `next_step`; `kind` distinguishes a strength
from an improvement. Moment timing is based on Transcribe word positions, and
not every phrase has feedback. Older feedback artifacts have only a summary
string, which the review screen formats in a collapsed detail section when it
contains multiline headings, lists, or an exercise table.
