# Testing SmallDocs email

Read this guide when changing authentication email, account invitations,
document notifications, billing-state notifications, SMTP delivery, or email templates.

## What runs where

SmallDocs uses three email test layers:

1. `node test/run.js` checks template content, HTML escaping, MIME construction,
   and a complete SMTP exchange against an in-process capture server.
2. Playwright renders each HTML template at a phone-sized viewport and checks
   for overflow and valid links.
3. Mailpit provides a local inbox for human review. It captures messages and
   does not deliver them to the internet.

Staging continues to use Resend. Mailpit is not deployed with SmallDocs and
there is no test-inbox route in the application.

## Open the preview inbox

Run:

```bash
npm run email:preview
```

The command starts the pinned Mailpit Docker service when it is not already
running, then sends previews for:

- a sign-in code;
- an account invitation;
- a document notification containing three document links and a sender note;
- a subscription confirmation with renewal, terms, cancellation, and refund information;
- payment failure, payment received, and payment read-only states;
- cancellation scheduled, cancellation removed, and cancellation effective states;
- the final deletion warning.

Open [http://127.0.0.1:8025](http://127.0.0.1:8025). Mailpit shows the rendered
HTML, plain text, headers, raw MIME, link checks, and phone-sized previews.

Stop and remove the local service with:

```bash
npm run email:preview:stop
```

The inbox is temporary. Stopping the Compose service removes captured
messages. No SmallDocs or Resend credentials are required.

If Mailpit is already running as a native binary, use:

```bash
node scripts/email-preview.js --no-start
```

Set `MAILPIT_SMTP_PORT` and `MAILPIT_UI_PORT` if that process uses different
ports.

## Change an email

Templates live in `lib/email-templates.js`. Each template returns:

```js
{ subject, text, html }
```

Change the text and HTML together. Keep the plain-text version complete enough
to use without HTML.

After changing a template:

```bash
node test/run.js
npx playwright test test/email-render.spec.js
npm run email:preview
```

In Mailpit, inspect both HTML and text. Check narrow-screen rendering, links,
long names, long document titles, and any user-supplied text.

## Document notification notes

The CLI accepts an optional note when notifying existing account members:

```bash
sdoc cloud notify DOCUMENT_UUID --member USER_UUID --note "Review this before Monday."
```

One notification can contain several `--document` and `--member` values. The
same note appears in each recipient's email. The sender must be able to edit
every document. Every recipient must already belong to the account and be able
to open every document. Sending a notification does not grant access or create
an invitation.

The note is encrypted in the Cloud database with the account key and decrypted
by the delivery worker. The email provider and recipient can read it after the
message is sent. Agent credentials use the name of the human who connected the
machine.

## SMTP configuration

Production and staging use authenticated TLS SMTP. The local preview sets:

```text
NOTIFY_SMTP_HOST=127.0.0.1
NOTIFY_SMTP_PORT=1025
NOTIFY_SMTP_SECURITY=none
```

The mailer accepts plaintext SMTP only for `127.0.0.1`, `::1`, or `localhost`.
It rejects plaintext configuration for remote hosts.

## Provider checks

Use Resend only for an occasional staging integration check. Resend test
addresses can exercise delivered, bounced, complained, and suppressed events.
Do not make the normal test suite depend on Resend availability or a real
mailbox.

## Inspect staging delivery jobs

On a host with read access to the staging jobs database, run:

```bash
npm run cloud:jobs -- --email
```

The command opens `CLOUD_JOBS_DB` read-only and reports counts for invitation,
document-notification, and billing-state email jobs. It does not print job IDs,
payloads, recipient addresses, document titles, or notes. Use `--db PATH` when
inspecting a copied database rather than the configured service database.

For monitoring or a deployment check, use:

```bash
npm run cloud:jobs -- --email --json
npm run cloud:jobs -- --email --fail-on-dead
```

`--fail-on-dead` exits with status 2 when matching jobs are dead or have an
expired worker lease. A queued job is not treated as failed because it may be
waiting for its scheduled retry. The output includes the oldest pending age
so the operator can apply the environment's alert threshold.

During a staging check, capture the status before sending, trigger one sign-in
code, one invitation, one document notification, and the relevant Stripe test
state, then run the command again. Confirm the new delivery work reaches
`complete`. Compare the result with the Resend activity view when diagnosing
provider delivery after SMTP acceptance.
