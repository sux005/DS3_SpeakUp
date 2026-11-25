# Measuring recording latency

The opt-in two-user backend test in `tests/test_live_backend_e2e.py` reports these elapsed times for each upload:

| Measurement | Starts | Ends | Includes |
| --- | --- | --- | --- |
| `reserve_seconds` | project creation request | upload reservation response | project and reservation API calls |
| `put_seconds` | signed PUT request | successful S3 response | client-to-S3 transfer |
| `put_to_first_active_status_seconds` | successful PUT | first poll observing an active or complete state | S3 event, EventBridge, workflow start, and polling delay |
| `put_to_complete_seconds` | successful PUT | first poll observing `COMPLETE` | all processing and polling delay |

Run it with `SPEAKUP_LIVE_TWO_USER_E2E=1`, `SPEAKUP_E2E_API_URL`, `SPEAKUP_E2E_JWT_A`, `SPEAKUP_E2E_JWT_B`, `SPEAKUP_E2E_WAV_PATH_A`, `SPEAKUP_E2E_WAV_PATH_B`, and `SPEAKUP_E2E_EXPECTED_TEXT_A/B` set. Use two different non-private spoken WAVs and a short, distinctive expected phrase from each clip; this checks that the processed transcript belongs to the correct audio. Run `python -m pytest -q -s tests/test_live_backend_e2e.py -k two_users_upload_and_process`. The test creates records and uploads audio in the configured backend, so use a development environment and dedicated test users.

Record the WAV duration and size, region, network type, and time of each run. Repeat with short and long clips and report median and slowest observed times. These timings cannot isolate AWS service time from client/network time or polling delay. The browser polls recording status every three seconds, so browser review visibility can be later than workflow completion.

Live-word latency needs a separate device check. Record the microphone audio and screen together, then compare the audible onset of a word with its first visible interim transcript. Note browser, device, operating system, microphone, and network. Time from clicking Record includes permission and the intentional three-second countdown; report it separately from speech-to-word latency. Browser speech-recognition results do not carry a reliable spoken-word onset timestamp in this app, so `onresult` timing alone cannot establish speech-to-word latency.
