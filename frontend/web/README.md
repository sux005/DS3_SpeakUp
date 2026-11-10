# SpeakUp frontend

The SpeakUp MVP frontend, built from the Figma file. It runs on fake JSON, so it works without AWS. Nothing is connected to the backend yet, but `lib/api.ts` has the calls ready.

## Run it

You need [Node.js](https://nodejs.org) 20.9 or newer. Check with `node -v`.

```bash
cd frontend/web
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). Pages update when you save a file. Press `Ctrl+C` to stop the server.

`npm install` is only needed the first time, and again after `package.json` changes.

## Screens

| Figma screen | URL |
| --- | --- |
| A · Your presentations | [/](http://localhost:3000/) |
| B · Project & progress | [/projects/project-demo-day](http://localhost:3000/projects/project-demo-day) |
| C · Record or upload | [/projects/project-demo-day/new](http://localhost:3000/projects/project-demo-day/new) |
| D · Analyzing | [/recordings/ec4bb4c2-f423-5f06-86b7-5ee814c4b598/analyzing](http://localhost:3000/recordings/ec4bb4c2-f423-5f06-86b7-5ee814c4b598/analyzing) |
| E1 · Results | [/recordings/8f2d9305-51f8-5ea1-9dbf-d5fc94b87f08](http://localhost:3000/recordings/8f2d9305-51f8-5ea1-9dbf-d5fc94b87f08) |
| Rubric | [/rubric](http://localhost:3000/rubric) |
| Sign in (demo) | [/login](http://localhost:3000/login) |

Screen D shows whichever stage matches the recording's status. The failed sample recording is at `/recordings/63c7255c-c5fd-5d77-86c2-b9ad4ec15498/analyzing`.

On screen E1, filler words are red. Click any word, timestamp or moment chip to play the audio from 0.5 seconds before it. The word being spoken is highlighted as the audio plays, and the transcript scrolls inside its own box.

## Fake data

`data/` is a copy of [`frontend/sample-payloads/`](../sample-payloads/README.md), Arjun's sample API responses. The copy is needed because Next.js can't import files from outside `frontend/web`.

If the samples change, refresh the copy from the repo root:

```bash
cp frontend/sample-payloads/*.json frontend/web/data/
```

## Demo audio

Screen E1 plays `public/demo/sample-take.mp3`. Git ignores it, because the team doesn't commit audio. Without it, the page still works but shows a "No audio file found" note.

To make it, you need `clip5_acl.wav` (a public ACL 2022 conference talk) from the team's clip tool, and `ffmpeg` (`brew install ffmpeg`). From the repo root:

```bash
ffmpeg -i path/to/clip5_acl.wav -b:a 64k frontend/web/public/demo/sample-take.mp3
```

`data/demo/transcript.json` and `data/demo/analysis.json` are that talk's real Amazon Transcribe output (from the clip tool's `results/raw/transcribe/clip5_acl.json`), scored by the backend's own `score_transcribe_items`. That's why they line up with the audio. They're separate from Arjun's samples, whose talk has no audio file.

## Where things are

| Path | What's there |
| --- | --- |
| `app/page.tsx` | Screen A |
| `app/projects/[projectId]/` | Screens B and C |
| `app/recordings/[recordingId]/` | Screens D and E1 |
| `app/rubric/`, `app/login/` | Rubric page and demo sign-in page |
| `components/` | Shared pieces: nav, buttons, headings, progress charts, rubric score |
| `components/TranscriptPlayer.tsx` | Audio player and clickable transcript (a client component) |
| `lib/transcript.ts` | Turns transcript words into sentences and marks fillers |
| `lib/rubric.ts` | Copy of `src/scoring/rubrics/speaking-2026-10-31.csv`, plus coaching tips per score |
| `lib/api.ts` | Ready-to-use API calls, including the full upload flow. Not used yet |
| `lib/recordings.ts` | Reads the fake data and formats dates, times and scores |
| `lib/types.ts` | The shape of each API response |
| `public/figma/` | Mascot and waveform images exported from Figma |

## Not connected yet

These are placeholders until the app talks to AWS. The calls for each are in `lib/api.ts`, which is written against [docs/aws-payload-api.md](../../docs/aws-payload-api.md) but **not tested against the real API yet**.

- **API URL:** set `NEXT_PUBLIC_SPEAKUP_API_URL` in `frontend/web/.env.local`. The value is `SPEAKUP_API_URL` in `.env.development.example`.
- **Data:** everything comes from `data/`. Replace the JSON imports in `lib/recordings.ts` and in `app/recordings/[recordingId]/page.tsx` with `getProjects`, `getProjectRecordings` and `getArtifact`.
- **Sign-in:** `/login` doesn't check anything yet. It just goes to the home page. Connect it to Cognito and keep the JWT, which every API call needs.
- **Recording and upload:** the buttons on screen C don't do anything yet. `uploadRecording()` does the whole flow: `POST /uploads`, `PUT` the file, then poll.
- **Analyzing:** screen D doesn't refresh. Use `waitForRecording()`.
- **Audio playback:** E1 plays the local demo file. Use `getDownloadUrl()` for the real recording's `download_url`.
- **Coaching:** the "Overall" card shows `feedback.json`. The per-metric cards use fixed tips from `lib/rubric.ts`, chosen by score. Bedrock feedback is off in deployment right now.
- **File types:** screen C accepts WAV, MP3 and M4A, as in the Figma design currently. Check what is wanted to be accepted in the MVP.

## Checks

```bash
npm run lint
npm run build
```
