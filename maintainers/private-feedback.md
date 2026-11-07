# Private account feedback

The shared sidebar has a Feedback section with a message field. Sending requires a Cloud login. Each receipt uses the authenticated account ID and its server-verified email, rather than identity fields supplied by the browser. Feedback remains available after a trial ends.

The inbox is at `/cloud/feedback`. Configure its readers through `CLOUD_FEEDBACK_ADMIN_USER_IDS`, a comma-separated list of stable Cloud user IDs in the deployment environment file. An unset or empty value grants nobody access. Library ownership or administration does not grant inbox access. Do not put an email address or account ID into the source as a privileged default. Resolve the intended account through its verified identity before configuring its ID.

The page, its `/public/cloud-feedback-admin.html` alias, and every inbox API request enforce the same allowlist. Page requests require the existing browser session. The API also accepts existing Cloud CLI credentials for an allowed account. Session or credential validity is checked again after asynchronous key operations. Responses are private and use `Cache-Control: no-store`; the page clears its message contents when it leaves the browser history view and checks access again when restored or focused.

This follows the deny-by-default and per-request permission checks described in [OWASP's Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html). No new password or shared admin token is introduced.

## Storage

`cloud_private_feedback` and `cloud_feedback_key` live in the existing Cloud SQLite database and are included in its existing backups. Message text and the sender's name and email are encrypted together with AES-256-GCM. A dedicated random inbox data key is wrapped by the existing Cloud key provider. Managed deployments use the same KMS wrapping operation and environment context as existing library keys; the inbox key is separate from those library keys.

Authenticated encryption binds each message to its record ID, sender ID, creation time and deployment environment. The database retains these routing fields and an idempotency receipt, without plaintext message content, names or emails. The key provider owns its existing bounded unwrapped-key cache. The inbox clears temporary key copies after use.

The old anonymous `/api/feedback` and public `/feedback` feed remain separate. New sidebar submissions never enter that public database. The older trial-feedback endpoint is also unchanged by this feature.

## API

- `GET /api/cloud/v1/feedback/status`: signed-in users receive `can_view_inbox` for their own account.
- `POST /api/cloud/v1/feedback`: submit `{ "message": "...", "idempotency_key": "unique-request-id" }`. Success is a compact receipt, with no inbox contents.
- `GET /api/cloud/v1/feedback/inbox`: allowed administrators receive up to 50 messages and `next_cursor`.
- `GET /api/cloud/v1/feedback/inbox?after=CURSOR`: continue to the next page. Ordering is creation time and ID, both descending.

Browser writes use the existing same-origin checks. The message limit reuses the existing general-feedback limit of 4,096 UTF-8 bytes. The existing feedback submission frequency of ten per hour is applied per authenticated account. Retrying the same message and receipt ID does not create another record or consume another submission. A changed message with a reused receipt ID returns an idempotency conflict. The sidebar retains drafts after failures and preserves new typing while an older message is being sent.

Inbox messages render as text, never HTML or Markdown. There is no public list, email broadcast, automatic document attachment, or collection of a document URL or URL fragment.

## Validation

`test/cloud-feedback.spec.js` exercises cross-account and cross-company denial, missing admin configuration, cookie authentication, cross-origin writes, caller-supplied identities, encrypted storage and metadata tampering, restart recovery, concurrent retries, rate limits, pagination, desktop/mobile submission, HTML input rendered as text, preserved drafts, expired sessions, and access rechecks after asynchronous work and browser history restoration.
