# SpeakUp AWS access handoff

SpeakUp development runs in AWS account `110359221190`, Region `us-east-2`,
with the CLI profile name `speakup-dev`. Resource identifiers in
`.env.development.example` are configuration, not credentials.

## What access teammates need

- Give every developer an individual AWS identity. Never share the root user,
  passwords, access keys, or one teammate's CLI credential files.
- Assign only the existing SpeakUp development permissions appropriate to that
  person's work. Do not grant broad administrator access just to unblock local
  development.
- Browser users do **not** receive IAM access. The web app authenticates them
  through Cognito and calls API Gateway with a JWT.
- Lambda, Step Functions, and other AWS services use the service roles defined
  in `infra/speakup.yaml`; teammates should not assume those roles manually.

The administrator should privately send each developer the account sign-in
details for their individual identity and tell them which SpeakUp role or group
was assigned. Do not put temporary passwords or sign-in links containing
one-time information in GitHub, Slack channels, or this repository.

## Local CLI sign-in

The preferred local flow uses short-lived credentials from `aws login`. It
requires AWS CLI `2.32.0` or newer and the AWS-managed
`SignInLocalDevelopmentAccess` policy on the developer's identity.

```powershell
aws --version
aws login --profile speakup-dev
aws sts get-caller-identity --profile speakup-dev
```

The identity check should return account `110359221190`. Commands for this
project should include `--profile speakup-dev --region us-east-2`, or the shell
can be scoped for the current session:

```powershell
$env:AWS_PROFILE = "speakup-dev"
$env:AWS_REGION = "us-east-2"
```

If the team already uses IAM Identity Center profiles, keep that established
flow and use `aws sso login --profile speakup-dev` instead of changing it.
Never store AWS access keys in `.env.development` or `.env.production`.

## Verification checklist

1. `aws sts get-caller-identity --profile speakup-dev` returns the expected
   account and the teammate's own identity.
2. The teammate can run the read-only command needed for their role.
3. A command outside their assigned role is denied as expected.
4. MFA is enabled for the individual identity.
5. The administrator records who has access and removes it when the teammate
   no longer needs the environment.

An expired session is normal; run `aws login --profile speakup-dev` again. An
`AccessDenied` after a successful login is a permissions issue, not a reason to
share another person's credentials.

## Copy/paste team message

> SpeakUp AWS development is in account `110359221190`, Region `us-east-2`.
> You will receive your own AWS sign-in details privately; please do not share
> them or create long-lived access keys. Install AWS CLI 2.32+ and use profile
> `speakup-dev`. Sign in with `aws login --profile speakup-dev`, then verify
> with `aws sts get-caller-identity --profile speakup-dev`. The returned
> account must be `110359221190`. Browser testing uses Cognito and does not
> require IAM credentials. Reply privately with the exact command and error if
> access is denied.
