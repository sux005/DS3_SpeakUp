# Frontend

No frontend application has been implemented yet. The backend is designed for
an authenticated client, and its current request and response contract is in
[the payload API guide](../docs/aws-payload-api.md). Deployment CORS settings
and the proposed microphone and file-picker flows are in
[the infrastructure guide](../infra/README.md).

The client will authenticate with Cognito, create a project, reserve an upload
with the file's content type, byte length, and Base64 SHA-256, send the original
bytes with all returned signed headers, confirm the upload, and request
processing. Project entries do not contain recording counts or references;
recordings identify their project and are listed through
`GET /projects/{projectId}/recordings`.

There is no frontend build or run command yet. Backend unit tests do not
exercise a browser UI.
