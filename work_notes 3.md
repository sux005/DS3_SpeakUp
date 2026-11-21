# AWS security review: remaining work

Review and test the deployed S3 permissions, IAM permissions, credential handling, owner access control, and data retention and deletion. Include the signed-upload and download boundaries, and verify the development and production configurations separately. Code-level controls and mocked tests do not establish the deployed policy or data lifecycle.

## Development review, 2026-11-20

- Read-only checks used AWS account `110359221190`, Region `us-east-2`, profile `speakup`. The `speakup-dev` stack was `UPDATE_COMPLETE`; `speakup-prod` did not exist in that account and Region.
- The deployed data bucket has all four public-access blocks enabled, reports `IsPublic=false`, enforces bucket-owner ownership and versioning, defaults to AES256 encryption, and denies insecure transport in its bucket policy. CORS allows `http://localhost:3000` for development. Lifecycle aborts incomplete multipart uploads after 7 days and expires noncurrent versions after 30 days. This rule does not expire current object versions.
- All six deployed Lambda functions were active and used their corresponding stack roles. Each role had one expected inline policy and no attached managed policy. The inspected policies scope S3 object access to this bucket's `users/*` prefix; processor and audio-prep roles can list the bucket. Lambda environment variable *names* showed no access-key or secret-key fields. The application uses the Lambda credential chain, including for its signed Bedrock request.
- `GET /health` returned 200; unsigned `GET /projects` returned 401. Local S3/API/retention tests: `35 passed` (`tests/test_aws_payload_s3.py`, `tests/test_aws_payload_api_handler.py`, `tests/test_retention_cleanup_handler.py`, `tests/test_aws_payload_moto.py`). The declared Moto dev dependency was installed in the existing virtual environment to run the version-purge test.
- IAM policy simulation returned an Organizations explicit deny even for actions allowed in the API role's inline policy. `organizations:ListPoliciesForTarget` was denied to this identity, so the organization policy could not be inspected. Treat simulation as an unresolved account-level signal, not a successful effective-access test. Check organization policy evaluation and an authenticated development workflow before relying on S3 or DynamoDB access.

## Still to verify

- With two dedicated Cognito test users, exercise cross-owner API reads and downloads, signed PUT header/checksum/length tampering, URL expiry, soft deletion, permanent deletion, and S3 version removal using synthetic non-private audio. No test JWT was available for this review.
- Verify a production deployment separately when one exists, including bucket settings, IAM policies, Lambda configuration, CORS, retention, and the same owner-boundary tests.
