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
4. The seeded [sample review](http://localhost:3000/recordings/8f2d9305-51f8-5ea1-9dbf-d5fc94b87f08) shows example transcript, metrics, and coaching. Those artifacts belong only to that recording. New recordings show no invented scores.

Presentation and recording state is held in `lib/demo-store.tsx`, seeded from `data/`, and saved in browser `localStorage`. Recording audio uses an in-memory object URL, so playback is unavailable after a full page reload. Clear the `speakup-frontend-demo-v1` localStorage entry to reset the preview.

## Code map

| Path | Purpose |
| --- | --- |
| `app/` | Presentation, recording, status, and review routes |
| `lib/demo-store.tsx` | Single client-side source for presentations, recordings, reviews, and status progression |
| `lib/recordings.ts` | Pure selectors and display formatting |
| `components/RecorderUploader.tsx` | Microphone capture, file selection, and local preview |
| `components/AudioReviewPlayer.tsx` | Playback and time-linked review moments |
| `data/` | Seed API payloads for this frontend preview |

`frontend/sample-payloads/` contains the original example API payloads. The runtime reads only `frontend/web/data/`; when refreshing demo examples, update that set deliberately and keep recording IDs consistent across transcript, analysis, and feedback.

The AWS API contract is documented in [docs/aws-payload-api.md](../../docs/aws-payload-api.md). Authentication, upload, processing, and generated analysis still require backend integration.

## Integrated MVP features

The interactive demo also retains `/rubric`, `/login` (demo only), and the
unused AWS helpers in `lib/api.ts`. Review transcripts preserve punctuation,
filler highlighting, filtering, and clickable words/timestamps with a 0.5-second
lead-in when audio is available. Seed feedback stays attached to its original
recording; new local recordings do not receive sample analysis.

The MVP's real transcript and analysis remain in `data/demo/`. They belong to
`public/demo/sample-take.mp3` (not committed) and are not substituted for unrelated
recordings. The legacy `TranscriptPlayer` remains available for that demo.
