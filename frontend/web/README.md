# SpeakUp frontend

A rough Next.js skeleton of the SpeakUp screens from the Figma file. It runs on fake JSON, so it works without AWS. Nothing is connected to the backend yet.

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

Screen D shows whichever stage matches the recording's status. The failed sample recording is at `/recordings/63c7255c-c5fd-5d77-86c2-b9ad4ec15498/analyzing`.

## Fake data

`data/` is a copy of [`frontend/sample-payloads/`](../sample-payloads/README.md), Arjun's sample API responses. The copy is needed because Next.js can't import files from outside `frontend/web`.

If the samples change, refresh the copy from the repo root:

```bash
cp frontend/sample-payloads/*.json frontend/web/data/
```

## Where things are

| Path | What's there |
| --- | --- |
| `app/page.tsx` | Screen A |
| `app/projects/[projectId]/` | Screens B and C |
| `app/recordings/[recordingId]/` | Screens D and E1 |
| `components/` | Shared pieces: nav, buttons, headings, progress charts |
| `lib/recordings.ts` | Reads the fake data and formats dates, times and scores |
| `lib/types.ts` | The shape of each API response |
| `public/figma/` | Mascot and waveform images exported from Figma |

## Not connected yet

These are placeholders until the app talks to AWS:

- **Data:** everything comes from `data/`. Replace the JSON imports in `lib/recordings.ts` and in `app/recordings/[recordingId]/page.tsx` with API calls. The routes are in [docs/aws-payload-api.md](../../docs/aws-payload-api.md).
- **Sign-in:** there's no Cognito login yet. API calls need the JWT as `Authorization: Bearer <token>`.
- **Recording and upload:** the buttons on screen C don't do anything yet. The upload flow is `POST /uploads`, then `PUT` the file, then poll the recording's status.
- **Analyzing:** screen D doesn't refresh. It should poll `GET /recordings/{recordingId}` until `COMPLETE` or `FAILED`.
- **Audio playback:** the waveform on screen E1 is a static image.
- **File types:** screen C accepts WAV, MP3 and M4A, as in the Figma design currently. Check what is wanted to be accepted in the MVP.

## Checks

```bash
npm run lint
npm run build
```
