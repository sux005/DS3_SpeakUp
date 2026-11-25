# SpeakUp sign-in process

SpeakUp has two separate kinds of sign-in. They must not be mixed:

- **App users** sign in through Amazon Cognito. They receive tokens that let the
  browser call the SpeakUp API, but they never receive AWS credentials.
- **Developers** sign in to AWS with their own team identity and the
  `speakup-dev` command-line profile. That access is only for development and
  operations.

## App-user signup and verification

The Cognito user pool uses email addresses as usernames and automatically
verifies email ownership.

1. The user submits an email and a password directly to Cognito.
2. The password must be at least 12 characters and include uppercase,
   lowercase, number, and symbol characters.
3. Cognito emails a confirmation code.
4. The user enters the code and Cognito changes the account to `CONFIRMED`.
5. Sign-in uses Secure Remote Password (`USER_SRP_AUTH`). The browser app client
   is public and has no client secret.

Do not send passwords, confirmation codes, or tokens through the SpeakUp API,
store them in DynamoDB/S3, or write them to application logs.

## Signed-in session

Cognito returns three tokens after successful authentication:

| Token | Purpose | Current lifetime |
|---|---|---:|
| Access token | Sent as `Authorization: Bearer <token>` to protected API routes | 1 hour |
| ID token | Displays identity claims in the browser; not the API credential | 1 hour |
| Refresh token | Obtains a new session without another password prompt | 7 days in development; 30 days in production |

API Gateway validates the access token's signature, issuer, expiry, and app
client audience before invoking the API Lambda. The Lambda uses the verified
Cognito `sub` claim as the owner ID for projects and recordings. It never trusts
an owner ID supplied by the browser.

Development supports refresh-token authentication. Production enables refresh
token rotation with a 30-second retry grace period. The client must replace the
stored production refresh token after every successful refresh rather than
reusing the old token.

## MFA and account recovery

- Development offers authenticator-app TOTP MFA but does not require it.
- Production requires authenticator-app TOTP MFA.
- Password recovery is sent only to the verified email address.
- Cognito deliberately hides whether a user exists, so the application should
  use neutral errors such as “Email or password is incorrect.”

## Sign out

Sign out should revoke the Cognito session when possible, clear access, ID, and
refresh tokens from browser storage, clear cached user-owned API data, and send
the user back to the login page. Closing a page without clearing the session is
not sign out.

## Developer sign-in

Developers use short-lived, auto-refreshing AWS credentials. They do not reuse
an app-user Cognito token for AWS Console or command-line access.

Install the repository dependencies before running Python AWS utilities;
`botocore[crt]` is required for boto3 to read an `aws login` profile.

```powershell
aws --version
aws login --profile speakup-dev
aws sts get-caller-identity --profile speakup-dev
```

The identity check must return AWS account `110359221190`. Commands for this
project use Region `us-east-2`. Never create or distribute long-lived AWS access
keys and never add credentials to an `.env` file.

See `docs/team-aws-access.md` for IAM distribution and developer onboarding.

## QA checklist

1. A new user receives a confirmation code and cannot sign in before confirming.
2. A confirmed user can sign in with SRP and call `GET /projects` with the access
   token.
3. Missing, expired, malformed, ID, or wrong-audience tokens are rejected.
4. One Cognito user cannot read another user's project, recording, download URL,
   or artifact.
5. Refresh obtains new one-hour tokens; production also replaces the refresh
   token.
6. Sign out removes the local session and revoked tokens cannot be reused.
7. Development TOTP is optional and production TOTP is required.
