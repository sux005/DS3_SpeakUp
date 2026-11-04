# Frontend sample API payloads

These fixtures match the public JSON fields returned by the current API Lambda.
They contain no real user data, credentials, S3 URLs, or usable presigned URLs.

| Fixture | API route | Suggested wireframe use |
| --- | --- | --- |
| `account-limits.json` | `GET /account/limits` | Upload size/time copy and concurrent-processing state. |
| `projects.json` | `GET /projects` | Project list and empty-pagination state. |
| `project-recordings.json` | `GET /projects/{projectId}/recordings` | Complete, processing, and failed recording cards plus score display. |
| `transcript.json` | `GET /recordings/{recordingId}/artifacts/transcript` | Timestamp-synced transcript. |
| `analysis.json` | `GET /recordings/{recordingId}/artifacts/analysis` | Filler and pause markers plus full rubric metrics. |
| `feedback.json` | `GET /recordings/{recordingId}/artifacts/feedback` | Generated coaching copy. |
| `upload-reservation.json` | `POST /uploads` | Upload progress flow; its URL is intentionally nonfunctional. |
| `active-workflow-limit-error.json` | Processing HTTP 429 | Retry/error state; production also returns `Retry-After: 60`. |

Use these as fetch mocks until James's frontend branch is available. The live
client should read the base URL from `SPEAKUP_API_URL`, attach the Cognito JWT as
`Authorization: Bearer <token>`, and treat statuses as a state machine rather
than assuming processing finishes in one request.

The browser upload sequence is:

1. `POST /uploads` with `project_id`, `content_type`, Base64 SHA-256,
   `content_length`, and a stable `idempotency_key`.
2. `PUT` the unchanged file bytes to `upload_url` with every
   `required_headers` entry.
3. `POST /recordings/{recordingId}/confirm-upload`.
4. `POST /recordings/{recordingId}/process`.
5. Poll `GET /recordings/{recordingId}` until `COMPLETE` or `FAILED`.
6. For a completed review, fetch the three artifact routes above in parallel.

Recording lists intentionally contain only compact `summary_metrics`. Exact
filler and pause occurrences live in the analysis artifact so DynamoDB does not
duplicate review-detail data stored in S3.

Do not expose server-only environment variables through a frontend public
prefix. The full route contract is in `docs/aws-payload-api.md`.
