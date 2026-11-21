# Frontend deployment and end-to-end validation: remaining work

## 1. Add production sign-in

- Replace the development-only guest session with a deployable user sign-in flow. The current browser uses `/api/speakup` guest mode, which is disabled in production; the Cognito client in `infra/speakup.yaml` does not configure hosted-login OAuth flows, callback URLs, or a domain.
- Configure the chosen Cognito flow, environment values, session refresh, logout, and rejected-session handling. Send the user's JWT on protected requests. Confirm the API and signed-upload CORS settings allow the deployed frontend origin.
- **Validate:** signed-in and signed-out browser states, token expiry and 401 handling, and authenticated `GET /projects` and `GET /account/limits` through the deployed app.

## 2. Run a real browser-to-backend smoke test

- Build the frontend for the development deployment and run one non-private speech sample through sign-in, project creation, signed S3 upload, processing, results, reload, and audio playback. Confirm the transcript and metrics belong to the uploaded recording. Check optional Bedrock coaching when enabled.
- The existing Playwright live-mode suite intercepts the API and S3; it does not prove Cognito, deployed CORS, signed PUT, or the AWS workflow together.
- **Done when:** the development browser flow reaches a review for its uploaded recording and playback works after reload.
