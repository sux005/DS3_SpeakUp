# SpeakUp frontend

This Next.js frontend supports two modes. Without `NEXT_PUBLIC_SPEAKUP_API_URL`, it runs a local fixture-backed preview. With that variable set and `SPEAKUP_DEV_GUEST_MODE=1`, it connects the local development server to the existing AWS audio-analysis workflow through a server-only guest bridge.

## Run locally

Use Node.js 20.9 or newer. From `frontend/web`:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Run `npm run lint` and `npm run build` to check the app.

### Connect to the backend

Set `NEXT_PUBLIC_SPEAKUP_API_URL=/api/speakup`, `SPEAKUP_DEV_GUEST_MODE=1`, and `AWS_PROFILE=speakup` for local development. The server bridge invokes `speakup-dev-api` with an owner-scoped guest session; browser code receives no AWS credentials or JWT. The bridge refuses requests in production. The AWS CLI and an active profile session are required on the development machine.

```bash
AWS_PROFILE=speakup SPEAKUP_DEV_GUEST_MODE=1 NEXT_PUBLIC_SPEAKUP_API_URL=/api/speakup npm run dev
```

The browser creates projects, reserves an upload, sends the original file to the signed S3 URL, polls the recording, then loads the transcript, analysis metrics, optional coaching, and a signed playback URL. The backend performs noise cancellation, transcription, scoring, and optional Bedrock generation. Set the stack parameter `EnableBedrockFeedback=true` to generate coaching; otherwise a completed review can return `feedback: null`.

### Recording and submission boundary

On **New presentation**, opening the form, recording, the 3–2–1 countdown, previewing, cancelling, and recording again stay in the browser. The form scrolls into view when opened. After a recorded take, **Record again** asks for confirmation; the current take remains available through microphone setup and the countdown, then is replaced when the new recording starts. Confirming with **Don’t show again** stores only `speakup-skip-record-again-confirmation=true` in this browser's `localStorage`. Cancelling does not save that choice. The preference survives reloads on this browser profile, is not account-scoped, and is removed by clearing site data.

Browser `SpeechRecognition` supplies the live transcript and provisional filler and pace estimates. Recognition may use a browser vendor's speech service before submission. The live estimates are not sent to SpeakUp or used for rubric scores; browser recognition may miss filler sounds. The scored review comes from the submitted audio and the backend's timed transcript and analysis.

In live mode, the page makes read-only `/session`, `/projects`, `/account/limits`, and existing-recording requests to load account data. Recorder interactions add no SpeakUp API requests. **Start presentation with audio** is the explicit write boundary on both the home form and the live New attempt page: it creates a project when needed, reserves an upload, and PUTs the audio to the signed S3 URL. In demo mode, submission saves to the browser preview rather than AWS.

The development API contract supports `/recordings/{recordingId}/review` with Bedrock categories and anchored moments when coaching is enabled. The frontend reads the transcript, analysis, and feedback artifacts if that route returns 404; the feedback artifact also includes the structured coaching fields. This response has not been verified through an authenticated browser flow against the deployed stack. A local guest session uses a process-local signing secret unless `SPEAKUP_DEV_GUEST_SECRET` is set, so restarting or reloading the development server may start a new guest session.

## Tests

```bash
npm run test       # unit and component/integration tests
npm run test:coverage # instrument frontend source for unit/integration coverage
npm run test:all   # coverage, production build, and browser tests
```

The browser suite runs against a local production server on port 3102. It uses the local demo fixtures and browser storage; it does not need the backend or AWS. On macOS it uses installed Google Chrome when available. Microsoft Edge also works: set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its binary. On other systems install Playwright Chromium with `npx playwright install chromium` or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to a Chromium-compatible browser.
Use the configured Turbopack build for visual checks; it runs the app's Tailwind loader.
Run `npm run build` first when invoking `npm run test:e2e` by itself; `npm run test:all` includes the build.
The coverage report measures unit and integration execution of the frontend source. Browser tests are reported separately by Playwright.

### Live API browser QA

The live-mode suite builds the app with `NEXT_PUBLIC_SPEAKUP_API_URL=/api/speakup`, then intercepts the development guest bridge API calls and signed S3 `PUT` in Playwright. It does not contact AWS and does not use the local demo fixtures.

```bash
npm run test:e2e:live
```

This command runs a production build first, then `e2e/live-api-flow.spec.ts` on port 3103. The suite checks that recorder selection causes no additional API requests or writes before **Start presentation with audio**. It also covers project creation, signed upload, processing-to-complete transitions, reload during processing, transcript/metrics/feedback rendering (including nullable feedback and the deployed API artifact fallback), failed processing, and a 429 rate-limit response. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when a compatible Chromium browser is not installed.

## Try the flow

1. On the home page, choose **New presentation** and upload or record audio. A title is optional; the presentation is created only when you choose **Start presentation with audio** in live mode. You can also open the seeded [Demo Day presentation](http://localhost:3000/projects/project-demo-day).
2. For another attempt in an existing presentation, choose **New attempt**. Preview or discard the audio before starting the demo processing flow.
3. Watch the recording move through simulated processing stages, then open its review. The local recording can be played during this browser session.
4. The seeded [sample review](http://localhost:3000/recordings/8f2d9305-51f8-5ea1-9dbf-d5fc94b87f08) shows a real 2-minute demo talk: its transcript, timeline markers, scores and summary (see [Results page](#results-page)). Those artifacts belong only to that recording. New recordings show no invented scores.

Presentation and recording state is held in `lib/demo-store.tsx`, seeded from `data/`, and saved in browser `localStorage`. Recording audio uses an in-memory object URL, so playback is unavailable after a full page reload. Clear the `speakup-frontend-demo-v1` localStorage entry to reset the preview.

## Results page

`/recordings/{recordingId}` is ordered for understanding first and detail second:

1. **Header.** Presentation and take, date and length, and **Practice again**.
2. **Your takeaway.** One strength and one priority. With coaching they are the coach's first strength and first improvement moment, under the coach's summary. Without coaching they are the highest and lowest rubric scores, each labelled "From your measurements", and a note says coaching isn't available. "Strength" is only used for a score of 3 or 4 (otherwise "Closest to target"). Measures that tie for the top score are named together, and no strength is singled out when every score is level. There is no overall score.
3. **Your scores.** One concise card each for speaking rate, filler words and pauses inside sentences: measured value and unit, score out of 4, target, and one line of interpretation (the coaching for that metric, or the plain difference from target labelled "Measured"). **About this score** opens the definition, the rubric tip and the full rubric.
4. **Listen back.** One dark panel, two columns on wide screens: playback, timeline markers and **Moments to replay** on the left, the synced transcript on the right. The `<audio>` element's `currentTime` is the only playback clock; the time display, progress bar, markers and transcript highlight all read it.
   - Markers: scored fillers (rose), pauses inside sentences (orange) and coaching moments (mint). Markers closer than 24 px merge into one with a count; **← Previous / Next →** step through them. Clicking a marker seeks there, plays, and scrolls its sentence into view.
   - Moments to replay: the coach's moments, or else the first fillers and longest pauses inside sentences. Each plays from its time and reveals its sentence.
   - Transcript: one button per sentence (click seeks to its start; a click on a word seeks to the word with a 0.5 s lead-in). The current sentence gets a slightly lighter background. Fillers are highlighted inline; pauses inside sentences show as ‖ and natural pauses between sentences as a quiet line between them.
   - Follow mode keeps the current sentence in view during playback. Scrolling the transcript yourself turns it off; **Resume following** or clicking a sentence turns it back on.
5. **Your next practice step.** One sentence: the coach's general next step, or else the rubric tip for the lowest score, labelled as a rubric tip.
6. **History.** Trend charts once two attempts are scored. With one, a line says another scored attempt is needed to compare.

The wording for the takeaway, evidence and next step is built in `lib/takeaway.ts`, and target comparisons in `lib/targets.ts`. Comparisons are plain subtraction; whether a value is on target is taken from the backend's score, never decided here.

Data each part uses, from the analysis and feedback payloads (no scores are recalculated here):

| Shown | Payload field |
| --- | --- |
| Filler markers and highlights | `analysis.filler_occurrences` |
| Pause markers, inside vs natural | `analysis.pauses[].inside_sentence` |
| Card values and scores | `words_per_minute`, `fillers_per_100_words`, `pauses_per_speaking_minute`, `rubric_scores` |
| Filler and pause counts on the cards | `filler_count`, `filler_words`, `watch_words`, `pauses_inside_sentences`, `pauses_between_sentences` |
| Coaching moments, per-metric coaching, summary | `feedback.moments`, `feedback.categories`, `feedback.feedback` (schema 2) |

Not shown because the payloads don't include it: times for watch-list words (only counts exist), so they appear as a count on the fillers card rather than on the timeline.

Motion uses the tokens in `app/globals.css` (CSS transitions, 200 ms or less). With reduced motion on, colour and opacity changes stay and movement is removed.

### Demo audio

The seeded review's transcript and analysis in `data/demo/` were produced by the backend scorer from `public/demo/sample-take.mp3`, an excerpt of a public ACL 2022 conference talk. The mp3 is not committed (`.gitignore`). Ask a teammate for the file and place it at `public/demo/sample-take.mp3` to hear playback. Without it, the page shows "This recording could not be loaded." and turns off playback and transcript seeking; the transcript, markers, scores and summary still display.

## Theme

The app is set in a prehistoric valley, after the DS3 dinosaur mascot. The product name stays SpeakUp.

- **Layout.** Every page, the nav and the footer share one column (`pageColumn` in `components/PageHeading.tsx`, 1152px). Body text is 16 to 18px, metadata 14px, and monospace is kept for short details such as times.
- **Colours.** Tokens live at the top of `app/globals.css`: a cream page, lighter paper for content cards, forest green task panels, the mascot's orange for the one primary action on a screen, and its violet for selected states. Dark mode is the same valley at dusk. Each text pairing is at least 4.5:1.
- **Scenery.** `components/Scenery.tsx` holds original artwork: `ValleyBackdrop` (far mesas, lake and a ground slice with a cut edge), `Perch` (the rock ledge the mascot sits on), ferns and eggs. The backdrop and perch are used on the home page; the shared footer uses a quiet plant on working screens. Transcripts, scores and charts stay on plain surfaces.
- **Motion.** Mist drifts and ferns sway as whole elements, and both stop when the system asks for reduced motion. The mascot is a still image.

### Mascot

The mascot is the approved artwork in `public/mascot/`: three transparent PNGs, used as supplied.

| File | Used for |
| --- | --- |
| `mascot-neutral.png` | Welcome, empty states, loading, success, errors and unavailable content |
| `mascot-recording.png` | Ready to record and recording |
| `mascot-results.png` | Transcript, scores and feedback |

`components/Mascot.tsx` crops each file to its artwork, so all three draw at the same size and sit on the same baseline. The image never changes with state. State is shown beside it in ordinary text and small badges: `MascotState` adds loading dots or a warning badge, `MascotCoach` adds a speech bubble, and the recorder shows a red dot and timer. Do not redraw the mascot, recolour it or add expressions; to change it, replace the PNGs and update the `ART` bounds in `Mascot.tsx`. `app/icon.png` and `app/apple-icon.png` are crops of the neutral file's head.

## Code map

| Path | Purpose |
| --- | --- |
| `app/` | Presentation, recording, status, and review routes |
| `lib/live-store.tsx` | API state, uploads, status, review, and playback URLs |
| `lib/demo-store.tsx` | Local preview state and simulated status progression |
| `app/api/speakup/` | Development-only server bridge to the protected API |
| `lib/api.ts` | HTTP API and signed upload client |
| `lib/recordings.ts` | Pure selectors and display formatting |
| `components/RecorderUploader.tsx` | Microphone capture with a live level meter, file selection, and local preview |
| `components/Mascot.tsx`, `MascotCoach.tsx`, `MascotState.tsx` | The approved mascot PNGs, the speech bubble, and loading, empty and error panels |
| `components/Scenery.tsx` | Valley backdrop, rock ledge, ferns, eggs and the footer |
| `components/ProgressCharts.tsx` | Single-attempt summary with target comparison, or trend charts once two attempts are scored |
| `components/AudioReviewPlayer.tsx` | Playback controls and timeline markers |
| `components/SyncedTranscript.tsx` | Transcript synced to playback, with follow mode |
| `components/ScoreCards.tsx` | Concise metric cards with an expandable rubric |
| `components/ResultsSummary.tsx` | Takeaway, moments to replay, and the next practice step |
| `lib/takeaway.ts`, `lib/targets.ts` | Wording for the takeaway and next step; target comparisons |
| `lib/markers.ts` | Building and clustering timeline markers |
| `lib/transcript.ts` | Sentences, the playing sentence, and pause placement |
| `data/` | Seed API payloads for this frontend preview; `data/demo/` holds the seeded review |

`frontend/sample-payloads/` contains the original example API payloads. The runtime reads only `frontend/web/data/`; when refreshing demo examples, update that set deliberately and keep recording IDs consistent across transcript, analysis, and feedback.

The AWS API contract is documented in [docs/aws-payload-api.md](../../docs/aws-payload-api.md).

## Integrated MVP features

The interactive demo also retains `/rubric`. The review transcript preserves punctuation,
filler highlighting, and clickable timestamps with a 0.5-second lead-in when audio is
available. Seed feedback stays attached to its original recording; new local recordings
do not receive sample analysis.

The seeded review uses `data/demo/` (see [Demo audio](#demo-audio)).
`data/transcript.json`, `data/analysis.json` and `data/feedback.json` remain as short
API payload examples and test fixtures; the app no longer shows them. `data/feedback.json`
was written for that short example, so the demo clip has no coaching. The legacy
`TranscriptPlayer` remains in `components/` but is not used by any page.
