# Frontend

James's frontend application is not present on this branch yet. Framework-neutral
mock responses for the wireframe are available in
[`sample-payloads/`](sample-payloads/README.md). The backend is designed for an
authenticated client, and its current request and response contract is in
[the payload API guide](../docs/aws-payload-api.md). Deployment CORS settings
and the proposed microphone and file-picker flows are in
[the infrastructure guide](../infra/README.md).

The client will authenticate with Cognito, create a project, reserve an upload
with the file's content type, byte length, and Base64 SHA-256, send the original
bytes with all returned signed headers, confirm the upload, and request
processing. Project entries do not contain recording counts or references;
recordings identify their project and are listed through
`GET /projects/{projectId}/recordings`. A completed review then loads
`transcript`, `analysis`, and `feedback` from the owner-checked artifact route.

There is no frontend build or run command yet because James's source tree is
not in this checkout. The checked-in tests validate the full review mock JSON
against the public-field contract, but they do not exercise a browser UI.
