# SpeakUp frontend

This Next.js frontend is a local, interactive preview of the SpeakUp presentation practice flow. It does not call AWS or generate speech analysis.

## Run locally

Use Node.js 20.9 or newer. From `frontend/web`:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Run `npm run lint` and `npm run build` to check the app.

## Tests

```bash
npm run test       # unit and component/integration tests
npm run test:coverage # instrument frontend source for unit/integration coverage
npm run test:all   # coverage, production build, and browser tests
```

The browser suite runs against a local production server on port 3102. It uses the local demo fixtures and browser storage; it does not need the backend or AWS. On macOS it uses installed Google Chrome when available. On other systems install Playwright Chromium with `npx playwright install chromium` or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to a Chromium-compatible browser.
If Turbopack fails because the environment restricts local worker ports,
`npx next build --webpack` is an alternative production build.
Run `npm run build` first when invoking `npm run test:e2e` by itself; `npm run test:all` includes the build.
The coverage report measures unit and integration execution of the frontend source. Browser tests are reported separately by Playwright.

## Try the flow

1. On the home page, choose **New presentation** and upload or record audio immediately. A title is optional; the presentation is created when you start the demo review. You can also open the seeded [Demo Day presentation](http://localhost:3000/projects/project-demo-day).
2. For another attempt in an existing presentation, choose **New attempt**. Preview or discard the audio before starting the demo processing flow.
3. Watch the recording move through simulated processing stages, then open its review. The local recording can be played during this browser session.
4. The seeded [sample review](http://localhost:3000/recordings/8f2d9305-51f8-5ea1-9dbf-d5fc94b87f08) shows a real 2-minute demo talk: its transcript, timeline markers, scores and summary (see [Results page](#results-page)). Those artifacts belong only to that recording. New recordings show no invented scores.

Presentation and recording state is held in `lib/demo-store.tsx`, seeded from `data/`, and saved in browser `localStorage`. Recording audio uses an in-memory object URL, so playback is unavailable after a full page reload. Clear the `speakup-frontend-demo-v1` localStorage entry to reset the preview.

## Results page

`/recordings/{recordingId}` has three sections, top to bottom:

1. **Listen back.** Playback controls, timestamped markers above the progress bar, and the transcript in one dark panel. The `<audio>` element's `currentTime` is the only playback clock; the time display, progress bar, markers and transcript highlight all read it.
   - Markers: scored fillers (rose), pauses inside sentences (peach) and coaching moments (mint). Markers closer than 24 px merge into one with a count; **← Previous / Next →** step through them. Clicking a marker seeks there, plays, and scrolls its sentence into view.
   - Transcript: one button per sentence (click seeks to its start; a click on a word seeks to the word with a 0.5 s lead-in). The current sentence gets a slightly lighter background. Fillers are highlighted inline; pauses inside sentences show as ‖ and natural pauses between sentences as a quiet line between them.
   - Follow mode keeps the current sentence in view during playback. Scrolling the transcript yourself turns it off; **Resume following** or clicking a sentence turns it back on.
2. **Your scores.** One card each for speaking rate, filler words and pauses inside sentences: measured value and unit, score out of 4, target range, what the metric measures, coaching for that metric (or the rubric tip, labelled), and an expandable full rubric.
3. **Overall summary.** What happened → supporting evidence (timestamps that play from that point) → what to try next. Without coaching it says so and uses only measurements and the rubric, labelled as such.

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

## Code map

| Path | Purpose |
| --- | --- |
| `app/` | Presentation, recording, status, and review routes |
| `lib/demo-store.tsx` | Single client-side source for presentations, recordings, reviews, and status progression |
| `lib/recordings.ts` | Pure selectors and display formatting |
| `components/RecorderUploader.tsx` | Microphone capture, file selection, and local preview |
| `components/AudioReviewPlayer.tsx` | Playback controls and timeline markers |
| `components/SyncedTranscript.tsx` | Transcript synced to playback, with follow mode |
| `components/ScoreCards.tsx` | Combined score, rubric and feedback cards |
| `components/SummaryFeedback.tsx` | Overall summary: what happened, evidence, next step |
| `lib/markers.ts` | Building and clustering timeline markers |
| `lib/transcript.ts` | Sentences, the playing sentence, and pause placement |
| `data/` | Seed API payloads for this frontend preview; `data/demo/` holds the seeded review |

`frontend/sample-payloads/` contains the original example API payloads. The runtime reads only `frontend/web/data/`; when refreshing demo examples, update that set deliberately and keep recording IDs consistent across transcript, analysis, and feedback.

The AWS API contract is documented in [docs/aws-payload-api.md](../../docs/aws-payload-api.md). Authentication, upload, processing, and generated analysis still require backend integration.

## Integrated MVP features

The interactive demo also retains `/rubric`, `/login` (demo only), and the
unused AWS helpers in `lib/api.ts`. New local recordings do not receive sample
analysis.

The seeded review uses `data/demo/` (see [Demo audio](#demo-audio)).
`data/transcript.json`, `data/analysis.json` and `data/feedback.json` remain as short
API payload examples and test fixtures; the app no longer shows them. `data/feedback.json`
was written for that short example, so the demo clip has no coaching. The legacy
`TranscriptPlayer` remains in `components/` but is not used by any page.
