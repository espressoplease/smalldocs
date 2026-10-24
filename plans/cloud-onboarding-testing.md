# Testing Cloud onboarding

The homepage experiment sends Google sign-in and verified email sign-in through
`/cloud/profile` to `/cloud/start`. Existing profile values skip details capture.
An invitation keeps its validated continuation through profile completion.

## Implemented on this branch

- Normal new signups automatically get their library and arrive at Install. Existing team-only members and invitation continuations do not create an unused personal library. Optional team setup is available from settings.
- Create a team upgrades the same personal library after a review. Document IDs and permissions stay unchanged. The team trial keeps its original deadline and existing configured team limits.
- Existing Stripe personal subscriptions use a billing preview and an update to the same subscription item. Automated transport/failure tests cover this path; a live sandbox billing rehearsal is still needed before release.
- A personal library and its one-calendar-month trial are provisioned idempotently.
  Paid subscriptions take precedence. At trial expiry, reading remains available
  and saving requires a subscription. No payment is collected for the trial.
- The trial is recorded once per user and its verified email is hashed to prevent
  a second sign-in method resetting the same email's trial. Identities are not
  silently merged; an existing trial under a different sign-in method produces
  an actionable error.
- Install opens inside the existing Cloud settings shell, with the account box.
  Connected machines is reused. Join/create-team remains accessible from Install.
- Private company requests create a seven-day handoff link. No team directory or
  automatic domain delivery exists. The requester chooses who receives the link.
- Request review requires the link, a same-domain verified identity and owner/admin
  access to a team. It reveals only the consented request details and the reviewer's
  own teams. Allowed invitation domains are not reinterpreted as domain ownership.
- Review creates an ordinary member invitation with existing project permissions.
  Retries reuse one invitation for that request/team. Only the addressed identity
  may accept. Personal documents are not moved. Existing seat synchronization runs
  on acceptance, with concurrent/repeated acceptance handled idempotently.

Google requests identity, email and basic profile. Existing saved names are
preserved. Both given and family names prefill an empty profile when supplied;
partial names fall back to the details form. The additional Google consent needs
its normal live provider check; automated tests use signed synthetic token claims.

## Disposable backend preview

Run:

```sh
node scripts/onboarding-preview.js
```

Open <http://localhost:3102/>. The launcher starts an isolated application server
with temporary SQLite databases and fictional verified users. It uses the actual
backend and UI, not mocked API responses. It starts after authentication, so it
does not test code delivery or Google sign-in. Emails, payments and production
accounts are not touched. The preview-only gateway binds to loopback. Its user
switching does not exist in the application server.

Scenarios include new email, Google with/without a name, a direct invitation,
an existing personal account, a team member and a connected machine. New-user
scenarios create a fresh fictional identity, so they are repeatable.

For request review: create a request, open its link, and use “View as Bob (admin)”
in the preview bar. Send an invitation, copy its link, switch back to the requester,
and open that invitation. Membership begins only after acceptance.

To record desktop and phone walkthroughs:

```sh
node scripts/record-onboarding.js /tmp/smalldocs-onboarding-videos
```

## Actual local authentication

The private runner on this machine is
`/Users/mac/.sdocs/dev/run-smalldocs-google.cjs`. It loads OAuth credentials and
isolated development databases from outside the repository. Start it with Node,
then open <http://localhost:3099/home-next>.

Google's callback is registered for port 3099. Use the project owner's Google
test account. Email-code authentication needs local SMTP configured as described
in `maintainers/email-testing.md`.

To use the branch CLI instead of the published installer:

```sh
SDOCS_CLOUD_URL=http://localhost:3099 node cli/bin/sdocs-dev.js cloud login
```

Approve the machine in the browser, then open Connected machines. A connection
means valid credentials, not a running agent. Keep SDOCS_CLOUD_URL set for other
CLI operations against the local environment.

## Automated checks

- `test/test-cloud-join-requests.js`: consent, duplicate links, expiry and cancellation.
- `test/test-cloud-billing.js`: month-end trial dates, expiry, retries, subscription
  precedence and eligibility across sign-in identities.
- `test/test-cloud-onboarding-real.js`: actual HTTP APIs, authorization boundaries,
  concurrent retries, first document save, expiry and invitation acceptance.
- `test/cloud-onboarding-real.spec.js`: real browser and backend journeys on desktop
  and mobile, including invitation continuation and account selection.
- Existing homepage, settings, invitation, sign-in, Terms and checkout tests remain
  applicable. The full test runner includes the new backend tests.

## Deliberately deferred

Automatic domain request routing and DNS ownership verification are not part of
this version. Team creation retains explicit plan selection and checkout. This
version provisions a personal trial, not a new self-service team trial. Account
linking remains explicit in the underlying identity model. No deployment or npm
release has been performed.
