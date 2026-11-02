# S3 payload design

S3 holds original recordings and large/versioned artifacts. The adapter pins a
single configured bucket, validates every owner scope, and constructs all keys
server-side. Objects use SSE-S3 (`AES256`), TLS-only bucket access, bucket-owner
ownership, and bucket versioning.

Managed file transfers handle multipart behavior. JSON uses conditional
`PutObject` so retries cannot replace a different immutable artifact. Streaming
bodies are context-managed and always closed. Reads head-check JSON size before
allocating the body. Permanent purge uses `ListObjectVersions` pagination and
`DeleteObjects` batches of at most 1,000 entries under one exact prefix.

SSE-KMS would add customer-managed key policy control and a separate audit
boundary, but it also adds key administration and KMS request cost. SSE-S3 is
appropriate for the constrained MVP budget; revisit KMS if compliance or
customer-controlled key requirements change.

S3 server access logs and CloudTrail data events are intentionally deferred.
They add storage and event costs at recording-level request volume. Built-in S3
metrics and structured application failures are the initial signal; enable data
events for a narrower production prefix if audit requirements grow.
