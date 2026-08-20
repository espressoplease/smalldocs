# SmallDocs Cloud operations

This document describes the Cloud services currently implemented in `server.js` and `lib/cloud-*.js`. It is the deployment and recovery reference for the current SQLite service. It does not define commercial allowance values.

## 1. Supported deployment shape

Run Cloud as one Node.js server process on one host with one persistent local volume.

The current databases use `better-sqlite3` in WAL mode. The job queue has leases and idempotency, but that does not make the complete service safe for horizontal replicas. Several databases participate in one user operation without a cross-database transaction, the job worker runs inside the web process, and SQLite locking depends on a shared local filesystem with correct POSIX semantics.

Do not run multiple application replicas against copied databases or a network filesystem. Do not use an ephemeral container filesystem for any Cloud database. Moving to multiple replicas requires a transactional shared database, an external worker, coordinated migrations, and provider webhook routing that preserves idempotency.

The local `CLOUD_MASTER_KEY` provider is for development and disposable staging data. Production document storage requires the built-in asynchronous AWS KMS provider. Run the server on Node.js 20 or later.

`CLOUD_MODE` controls the deployed Cloud boundary:

- `off` is the default and preserves the existing SmallDocs server behavior.
- `staging` requires a complete isolated Cloud configuration but permits either a staging KMS key or a local test key.
- `production` requires AWS KMS and rejects the local key provider.

`CLOUD_PUBLIC_MODE` controls whether people can reach or discover Cloud through the
served application. It defaults to `hidden`. In that state the editor omits the
Cloud stylesheet and script, and Cloud pages and APIs return 404. Set it to
`enabled` in isolated staging. Set it in production only when the public Cloud
surface is ready to launch. This switch does not weaken the configuration
checks selected by `CLOUD_MODE`.

Staging and production each use their own `CLOUD_AUTH_PUBLIC_ORIGIN`. OAuth callbacks, invitation URLs, checkout returns, billing portal returns, and sign-in return paths are built from that origin, so a staging flow stays on the staging hostname. Do not reuse production databases, Stripe resources, OAuth clients, mail credentials, secrets, encryption context, or customer data in staging.

The first staging process uses the same immutable application release as
production but runs as `smalldocs-staging` on loopback port 3004. Its state is
under `/var/lib/smalldocs-staging`, its root-managed configuration and
credentials are under `/etc/smalldocs-staging`, and Nginx is the only public
caller. The committed service, environment template, and virtual host live
under `ops/`.

## 2. Configuration

Keep secrets in the deployment secret manager, not an environment file committed to the repository. Set file permissions so only the service account and backup process can read Cloud databases.

### 2.1 Process and request boundary

| Variable | Required | Current behavior |
| --- | --- | --- |
| `CLOUD_MODE` | Yes for deployed Cloud | `off`, `staging`, or `production`. Deployed modes validate their complete configuration before opening the HTTP listener. |
| `CLOUD_PUBLIC_MODE` | Only to expose Cloud | `hidden` or `enabled`. Defaults to `hidden`. Hidden mode omits Cloud controls and returns 404 for Cloud pages and APIs. |
| `PORT` | Platform dependent | HTTP listen port. Defaults to `3000`. |
| `NODE_ENV` | Yes in production | Set to `production`. `development` and `test` are the only environments in which development code delivery can be enabled. |
| `SDOCS_DEV` | No in production | Enables general development cache behavior. Leave unset in production. |
| `TRUST_PROXY` | Only behind a trusted proxy | Set to `1` only when the immediate proxy overwrites `X-Forwarded-For`. Otherwise a client can choose the address used by rate limits. When unset, the socket address is used. |
| `CLOUD_AUTH_PUBLIC_ORIGIN` | Yes | Exact public HTTP or HTTPS origin, without a path, query, credentials, or fragment. Production must use the externally visible HTTPS origin. It determines callback URLs, cookie security, same-origin checks, checkout returns, and invitation links. |
| `CLOUD_RECENT_AUTH_MS` | Recommended | Maximum browser-session age for billing, export, ownership, membership, invitations, and workspace deletion or recovery. Defaults to 30 minutes. CLI bearer credentials cannot call these routes. |

### 2.2 Authentication and OAuth

| Variable | Required | Current behavior |
| --- | --- | --- |
| `CLOUD_AUTH_PEPPER` | Yes | Stable server secret of at least 16 bytes. It keys session, email-code, CLI-token, rate-limit, and OAuth-state digests. Rotation invalidates active credentials and pending transactions. Store it with backups and restore procedures. |
| `CLOUD_AUTH_DB` | Yes for an explicit production path | Authentication SQLite path. Defaults to `cloud_auth.db` beside `server.js`. |
| `CLOUD_OAUTH_DB` | Recommended | OAuth transaction SQLite path. Defaults to `CLOUD_AUTH_DB`, then `cloud_auth.db`. A separate path makes ownership and retention clearer but must be included in backup policy. |
| `CLOUD_OAUTH_PROVIDER_TIMEOUT_MS` | No | Total timeout for each outbound Google or GitHub request. Defaults to 10 seconds and aborts a stalled request. |
| `CLOUD_AUTH_DEV_LOG_CODES` | No in production | Logs live email codes only when set to `1`, `NODE_ENV` is `development` or `test`, and the public origin is loopback. Leave unset in production. |
| `GOOGLE_OAUTH_CLIENT_ID` | For Google sign-in | Google OpenID Connect client ID. Google remains unavailable unless both Google variables are set. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | For Google sign-in | Google client secret. |
| `GITHUB_OAUTH_CLIENT_ID` | For GitHub sign-in | GitHub OAuth app client ID. GitHub remains unavailable unless both GitHub variables are set. |
| `GITHUB_OAUTH_CLIENT_SECRET` | For GitHub sign-in | GitHub OAuth app client secret. |

The sign-in page shows only providers whose client ID and secret are both
configured. Email-only staging therefore does not display inactive Google or
GitHub controls.

### 2.2.1 Reusable staging acceptance identities

`ops/seed-cloud-staging.js` creates or reuses a fixed Personal identity, a
fixed demo Team, and a separate fixed `SmallDocs Acceptance` Team used only by
automated access tests. Re-running it does not create a second account for the
same email. It also restores an acceptance member whose membership was
disabled by an earlier access-revocation check. Automated tests do not remove
people from the demo Team used for visual review.

The optional `/api/cloud/auth/test-login` route exists only when all of these
conditions are true:

- `CLOUD_MODE=staging`;
- `CLOUD_TEST_LOGIN_ENABLED=1`;
- the requested email is in the exact `CLOUD_TEST_LOGIN_EMAILS` allowlist;
- the request supplies the secret held in the root-managed systemd credential.

Production configuration rejects every staging test-login setting at startup.
The endpoint is same-origin protected, rate-limited, returns no token in its
body, and creates the normal HttpOnly Secure browser cookie. Do not place the
secret in a URL, repository file, Playwright report, or command-line argument.

Run the complete permission, tag, two-account merge, Cloud comment, and
access-revocation matrix against an isolated local staging-shaped process with:

```text
npm run test:cloud-e2e
```

For the live staging site, put a copy of the staging test-login secret in an
owner-only file, then run:

```text
CLOUD_E2E_BASE_URL=https://cloud-staging.smalldocs.org \
CLOUD_E2E_TEST_SECRET_FILE=/absolute/path/to/owner-only-secret \
npm run test:cloud-e2e
```

The live test target is pinned to `cloud-staging.smalldocs.org` so a mistyped
or hostile URL cannot receive the staging secret. Playwright creates one
browser context and one normal session per required identity, uses those
sessions for the complete run, removes its test document, and restores the
member removed by the access-revocation check. It also starts a fresh CLI with
an isolated owner-only credential store, authorizes that machine through the
normal browser page, and exercises status, members, tags, permission groups,
list, search, create, access, pull, push, history, delete, undelete, logout, and
post-logout rejection. The CLI document is removed during cleanup.

The server writes one aggregate `cloud_collaboration_metrics` JSON record per
active minute. It includes lightweight head-check totals and change counts,
target-save merge classifications, merge retry counts and latency, and expired
target counts. It also counts saves recovered from a client-provided merge base
after the server revision was pruned. The record contains no document ids,
account ids, Markdown, or search terms. Set
`CLOUD_COLLABORATION_METRICS_INTERVAL_MS` to shorten the aggregation window
during a focused staging check.

Browser and CLI target saves include the exact Markdown base that the writer
opened. The browser keeps that base in memory. The CLI reads it from the
owner-only cache under `~/.sdocs/cloud/bases/`. The server uses its encrypted
revision when it is still retained. If pruning has removed that revision, an
authorized editor's supplied base is used for the same three-way merge. The
request base is bounded by the document request limit, is not logged, and is
not stored in idempotency records. Only the resulting encrypted revision is
persisted.

If neither the server revision nor the client base is available, the server
returns `target_too_old`. The browser then blocks further Cloud autosaves while
keeping the live editor contents and offers copy, download, or replacement with
the latest Cloud copy. The CLI returns the error without changing its binding
or local file.

Register these exact callback URLs with the providers:

```text
${CLOUD_AUTH_PUBLIC_ORIGIN}/api/cloud/auth/oauth/google/callback
${CLOUD_AUTH_PUBLIC_ORIGIN}/api/cloud/auth/oauth/github/callback
```

Google uses `openid email`, state, nonce, and S256 PKCE. The server exchanges the code, verifies the RS256 ID token against Google JWKS, and checks issuer, audience, expiry, nonce, verified email, and subject. The host needs outbound HTTPS access to Google token and JWKS endpoints.

GitHub requests `user:email`, uses state and S256 PKCE, exchanges the code, reads `/user`, and selects a verified primary email from `/user/emails`. The host needs outbound HTTPS access to GitHub OAuth and API endpoints.

OAuth state is also bound to a short-lived HttpOnly SameSite browser cookie. Start and callback traffic must reach the same service database and public hostname. Provider access tokens exist only during the callback and are not stored.

### 2.3 Email delivery

Email codes and workspace invitations use `teams/notify.js`:

| Variable | Required | Current behavior |
| --- | --- | --- |
| `NOTIFY_SMTP_USER` | Yes for production email | SMTP login. Resend uses the literal value `resend`. |
| `NOTIFY_SMTP_PASS` | Yes for production email | SMTP password or provider app password. |
| `NOTIFY_SMTP_PASS_FILE` | Alternative to `NOTIFY_SMTP_PASS` | Read the SMTP password from a root-managed systemd credential. Production uses this path. |
| `NOTIFY_EMAIL_FROM` | Yes for production email | Envelope and header sender address, for example `login@smalldocs.org`. |
| `NOTIFY_EMAIL_TO` | No for Cloud delivery | Defaults to `NOTIFY_EMAIL_FROM`. It is used for internal notification mail; Cloud sign-in and invitation mail supply their recipient directly. |
| `NOTIFY_SMTP_HOST` | No | Defaults to `smtp.gmail.com`. |
| `NOTIFY_SMTP_PORT` | No | Defaults to `587` with STARTTLS. Port `465` uses implicit TLS. |

The service refuses to issue an email login transaction when neither production SMTP nor the restricted development code logger is available. The production SMTP path delivered a sandboxed test through Resend to Gmail on 14 August 2026. Confirm delivery across the remaining launch mailbox set, spam placement, DMARC reporting, bounce handling, and abuse limits before launch.

`TEAMS_DB` configures the separate business-interest database. It is not a Cloud account database, but it is used by the same notification module and should have its own backup and retention decision.

### 2.4 Document encryption and storage

| Variable | Required | Current behavior |
| --- | --- | --- |
| `CLOUD_DB` | Yes for an explicit production path | Cloud workspaces, membership, projects, wrapped keys, encrypted revisions, invitations, idempotency records, and audit events. Defaults to `cloud.db` beside `server.js` when a key provider is configured. |
| `CLOUD_ENVIRONMENT` | Yes | Included in authenticated encryption context. Use a stable value for the lifetime of the data. Changing it makes existing ciphertext fail authentication. Defaults differ between managed and local providers, so set it explicitly. |
| `CLOUD_IDEMPOTENCY_SECRET` | Yes | Stable HMAC secret for idempotency and invitation-token digests. It falls back to `CLOUD_AUTH_PEPPER`, but production should set a separate stable secret. Rotation invalidates outstanding invitation tokens and changes request digests. |
| `CLOUD_CURSOR_SECRET` | Recommended | Stable HMAC secret for scoped pagination cursors. It falls back to `CLOUD_IDEMPOTENCY_SECRET`, then `CLOUD_AUTH_PEPPER`. Rotation invalidates outstanding cursors but does not change stored resources. |
| `CLOUD_KMS_KEY_ID` | Yes in production | AWS KMS key ARN, key ID, or alias used to wrap workspace data keys and project keys. |
| `CLOUD_KMS_REGION` | Yes unless an AWS region variable is set | AWS region containing the key. Falls back to `AWS_REGION`, then `AWS_DEFAULT_REGION`. |
| `CLOUD_KMS_MAX_ATTEMPTS` | Recommended | AWS SDK attempt count. Defaults to 3 and is capped at 5. |
| `CLOUD_KMS_CONNECTION_TIMEOUT_MS` | Recommended | Per-connection timeout. Defaults to 3000 milliseconds. |
| `CLOUD_KMS_REQUEST_TIMEOUT_MS` | Recommended | Per-request socket timeout. Defaults to 10000 milliseconds. |
| `CLOUD_KMS_OPERATION_TIMEOUT_MS` | Recommended | Total deadline for one AWS KMS operation, including retries. Defaults to 15000 milliseconds. |
| `CLOUD_KMS_CLIENT_MODULE` | No | Compatibility override for a trusted custom adapter. Leave unset to use the built-in AWS KMS adapter. |
| `CLOUD_MASTER_KEY` | Development only | Base64 encoding of exactly 32 bytes for the local key provider. Do not use this provider for customer data. |
| `CLOUD_KEY_REFERENCE` | Development only | Label stored with locally wrapped keys. Defaults to `local-development-key`. |

The built-in adapter uses the AWS SDK default credential chain. On the Hetzner host, supply a narrowly scoped workload credential that can call `kms:Encrypt` and `kms:Decrypt` on the SmallDocs key. Do not use an Identity Center administrator session or the management-account IAM user as the runtime identity.

When a deployed mode uses KMS, startup performs a bounded wrap, cache clear, unwrap, and comparison before opening the HTTP listener. The temporary data key and plaintext copies are wiped. A wrong region, disabled key, denied key policy, or unavailable credential causes startup to fail without accepting traffic.

The adapter records the concrete key ARN returned by AWS with every wrapped key. Decryption uses that recorded reference, so changing an alias does not silently redirect old ciphertext to a new key. Keep old KMS key versions or key resources available until every dependent ciphertext has been rewrapped and verified.

If `CLOUD_KMS_CLIENT_MODULE` is set, the module must export either a client object or `createKmsClient({ environment })`. The resulting client can provide synchronous or asynchronous methods:

```js
encrypt({ keyId, plaintext, encryptionContext })
// returns { ciphertext } or { CiphertextBlob }
// may also return keyId, KeyId, or reference

decrypt({ keyId, keyReference, ciphertext, encryptionContext })
// returns { plaintext } or { Plaintext }
// plaintext must be exactly 32 bytes
```

Both byte results must be a `Buffer` or `Uint8Array`. Preserve and enforce the supplied encryption context. KMS calls have bounded retries and an abortable total deadline. Provider failures are returned to clients as `temporary_service_failure`; provider details are not included in HTTP responses.

### 2.5 Search safety limits

These variables bound one in-memory search operation. They are technical safety limits, not subscription allowances:

| Variable | Meaning |
| --- | --- |
| `CLOUD_SEARCH_MAX_PROJECTS` | Maximum authorized projects scanned by one search. |
| `CLOUD_SEARCH_MAX_DOCUMENTS` | Maximum current documents decrypted and scanned. This is not a document-count subscription limit. |
| `CLOUD_SEARCH_MAX_BYTES` | Maximum uncompressed bytes scanned. |
| `CLOUD_SEARCH_DEADLINE_MS` | Wall-clock deadline for the scan. |
| `CLOUD_SEARCH_SOURCE_LIMIT` | Search requests permitted from one source address in the source window. Defaults to 60. |
| `CLOUD_SEARCH_SOURCE_WINDOW_MS` | Source-address search window. Defaults to one minute. |

The store applies internal defaults and hard caps when these variables are absent or out of range. Choose production values through load and memory testing. Search decrypts authorized current revisions in application memory and does not persist a keyword index.

Workspace creation and invitation delivery have additional abuse limits:

| Variable | Meaning |
| --- | --- |
| `CLOUD_WORKSPACE_CREATE_SOURCE_LIMIT` | Team workspace creations permitted from one source address. Defaults to 10. |
| `CLOUD_WORKSPACE_CREATE_SOURCE_WINDOW_MS` | Source-address workspace-creation window. Defaults to one hour. |
| `CLOUD_WORKSPACE_CREATE_USER_LIMIT` | Team workspace creations permitted by one user. Defaults to 5. |
| `CLOUD_WORKSPACE_CREATE_USER_WINDOW_MS` | Per-user workspace-creation window. Defaults to one day. |
| `CLOUD_INVITATION_SOURCE_LIMIT` | Invitations permitted from one source address. Defaults to 30. |
| `CLOUD_INVITATION_SOURCE_WINDOW_MS` | Source-address invitation window. Defaults to one hour. |
| `CLOUD_INVITATION_WORKSPACE_LIMIT` | Invitations permitted for one user and workspace. Defaults to 100. |
| `CLOUD_INVITATION_WORKSPACE_WINDOW_MS` | User-workspace invitation window. Defaults to one day. |

### 2.6 Billing and Stripe

| Variable | Required | Current behavior |
| --- | --- | --- |
| `CLOUD_BILLING_DB` | Yes for Cloud billing | Billing subscriptions and processed webhook events. Billing is disabled when absent. |
| `CLOUD_PLAN_LIMITS_JSON` | Before paid launch | JSON configuration for Personal and Team stored bytes, maximum file bytes, revision retention days, projects, members, and search workload. Values must be positive integers or `null`. There is no document-count limit. Invalid JSON stops startup. |
| `CLOUD_PAYMENT_GRACE_MS` | Before paid launch | Length of a newly observed `past_due` grace period. The code has a default, but production must set and publish the intended policy. Repeated `past_due` webhooks preserve the existing grace end. |
| `STRIPE_SECRET_KEY` | For Stripe | Stripe server secret supplied directly. Use `STRIPE_SECRET_KEY_FILE` in production instead. |
| `STRIPE_SECRET_KEY_FILE` | Alternative to `STRIPE_SECRET_KEY` | Read the Stripe server secret from a root-managed systemd credential. Production uses this path. |
| `STRIPE_WEBHOOK_SECRET` | For Stripe webhooks | Verifies the raw request body and Stripe signature when supplied directly. Use `STRIPE_WEBHOOK_SECRET_FILE` in production instead. |
| `STRIPE_WEBHOOK_SECRET_FILE` | Alternative to `STRIPE_WEBHOOK_SECRET` | Reads the signing secret from a root-managed systemd credential. The webhook endpoint returns unavailable when neither source is configured. |
| `STRIPE_API_VERSION` | Recommended | Pins Stripe response semantics. If absent, the account default applies. Pin and test a version before launch. |
| `STRIPE_PORTAL_CONFIGURATION_ID` | For the customer portal | Pins portal sessions to the reviewed configuration instead of whichever configuration later becomes the Stripe account default. |
| `STRIPE_PERSONAL_PRICE_ID` | For Personal checkout | Stripe recurring price ID used by Personal checkout. |
| `STRIPE_TEAM_PRICE_ID` | For Team checkout | Stripe recurring per-seat price ID used by Team checkout. |

The initial plans use a 10 MB file limit and 90-day age limit for retained history. The JSON shape is:

```json
{
  "personal": {
    "maxStoredBytes": null,
    "maxFileBytes": 10485760,
    "revisionRetentionDays": 90,
    "maxProjects": null,
    "maxMembers": null,
    "search": { "maxRequests": null, "windowMs": null }
  },
  "team": {
    "maxStoredBytes": null,
    "maxFileBytes": 10485760,
    "revisionRetentionDays": 90,
    "maxProjects": null,
    "maxMembers": null,
    "search": { "maxRequests": null, "windowMs": null }
  }
}
```

If a search request limit is set, its window must also be set. Personal membership is fixed at one. Team membership is bounded by the configured `maxMembers` plan limit. Stripe seat quantity is reported separately as `billedSeats`; it is not the admission limit.

### 2.7 Durable jobs and retention

| Variable | Required | Current behavior |
| --- | --- | --- |
| `CLOUD_JOBS_DB` | Recommended before customer use | Durable job SQLite path. Without it, revision pruning, delayed deletion purge, queued invitation email, and deferred seat reconciliation are not durable. |
| `CLOUD_JOB_POLL_MS` | No | In-process worker polling interval. The implementation applies a lower bound and defaults to one second. |
| `CLOUD_REVISION_KEEP_PREVIOUS` | No | Defaults to three. Cloud keeps at most this many non-current revisions per document. The current document is retained separately. |
| `CLOUD_REVISION_RETENTION_DAYS` | No | Defaults to 90 days. Non-current revisions expire at this age even when fewer than the count limit remain. |
| `CLOUD_DOCUMENT_RESTORE_WINDOW_MS` | No | Defaults to 30 days. Deleted documents and their retained revisions remain recoverable for this period. |
| `CLOUD_WORKSPACE_RESTORE_WINDOW_MS` | Before team-workspace deletion is enabled | Positive team-workspace restore window in milliseconds. During this window an owner can restore the workspace from the Cloud account page or API. The store has an implementation default when absent. Production must set and publish the intended retention period. Personal workspaces cannot be deleted through this operation. |

Implemented job types are:

- `document_purge`: remove documents whose restore window has elapsed
- `workspace_purge`: remove a deleted Team workspace after its restore window
- `revision_prune`: preserve the current head, retain up to three previous revisions, and schedule the next retained revision's 90-day expiry
- `team_seat_sync`: reconcile Stripe quantity after membership changes
- `auth_cleanup`: prune expired authentication and OAuth records
- `invitation_email`: send a workspace invitation
- `document_notification_email`: send document links and an optional sender note to an existing account member

Jobs use an idempotency key, a lease, bounded retries, exponential backoff, and terminal `dead` state. Only error codes are stored as job errors. Job payloads can contain an invitation email address and acceptance URL, so the jobs database is sensitive.

The current worker runs in the web process and handles one claimed job at a time. There is no scheduler that periodically enqueues `auth_cleanup`, and completed or dead job cleanup is not scheduled by `server.js`. Direct authentication cleanup runs once at startup and daily. Add monitoring and explicit recurring maintenance for dead jobs, completed-job retention, missing purges, and authentication cleanup before launch.

`npm run cloud:jobs -- --email` opens `CLOUD_JOBS_DB` read-only and summarizes email delivery state without printing payloads, recipient addresses, document data, or job identifiers. Add `--json` for monitoring input. Add `--fail-on-dead` to return status 2 for dead jobs or expired leases. Queue age remains visible in the output and should use an explicit environment-specific alert threshold.

## 3. Database inventory

| Database | Contents | Default |
| --- | --- | --- |
| Authentication | Users, identities, email codes, browser sessions, rate events, CLI device transactions, CLI credentials, access tokens | `CLOUD_AUTH_DB`, otherwise `cloud_auth.db` |
| OAuth | One-time OAuth state, nonce, PKCE verifier, return path, expiry | `CLOUD_OAUTH_DB`, otherwise the authentication database |
| Cloud store | Encrypted workspace and project names, membership, wrapped keys, encrypted revisions and metadata, invitations, idempotency records, audit events | `CLOUD_DB`, otherwise `cloud.db` |
| Billing | Subscription state, seat quantity, provider IDs, webhook event digest | `CLOUD_BILLING_DB`, no default activation |
| Jobs | Queue payload, state, lease, retry metadata, error code | `CLOUD_JOBS_DB`, no default activation |

Authentication identities contain normalized verified email addresses in plaintext. Billing contains provider customer and subscription IDs. Jobs can contain recipient email and invitation URLs. Cloud content and invitation addresses in the Cloud store are encrypted, but the collection of databases is not free of personal or security-sensitive metadata.

Each SQLite database may have `-wal` and `-shm` sidecars while the process is running. Do not copy only the main `.db` file from a live service.

## 4. Backup and restore

### 4.1 Backup procedure

1. Record the deployed commit, configuration names, public origin, `CLOUD_ENVIRONMENT`, KMS key ID, and database paths.
2. Preserve `CLOUD_AUTH_PEPPER` and `CLOUD_IDEMPOTENCY_SECRET` in the secret manager backup. Do not place their values in the database archive or operator log.
3. Confirm the configured KMS key and any older key references remain enabled for decrypt.
4. Quiesce writes for a coordinated snapshot. Stop the web process for the simplest current procedure.
5. Checkpoint each WAL, then use SQLite's backup facility or copy the closed database files. If the process cannot be stopped, use an online SQLite backup API for each database and understand that separate database backups are not one atomic service snapshot.
6. Back up authentication, OAuth if separate, Cloud store, billing, and jobs. Include business-interest or analytics databases only according to their separate policies.
7. Encrypt the backup archive at rest, restrict access, record a checksum, and copy it to a separate failure domain.
8. Restart the service and verify health, authentication, one authorized document read, and job processing.

Cross-database consistency matters. A restore can otherwise contain a document without its current billing state, or a job referring to state from another point in time. A stopped-process snapshot of all databases is the supported recovery source for this implementation.

The backup process can send a success heartbeat only after both the archive and
its checksum have uploaded. Put the monitor URL in a root-owned file rather
than an environment variable or command-line argument. Configure its path in
the optional `/etc/smalldocs/backup-monitor.env` file:

```text
SDOCS_BACKUP_HEARTBEAT_URL_FILE=/etc/smalldocs/backup-heartbeat-url
```

The credential file must contain one HTTPS URL. Configure the external monitor
to alert when the nightly heartbeat is more than 26 hours old. A backup or
heartbeat failure leaves `smalldocs-backup.service` failed and omits the remote
success signal. The heartbeat does not grant S3 list, read, delete, or KMS
decrypt access.

### 4.2 Restore procedure

1. Restore into an isolated environment with outbound email, Stripe writes, and the job worker disabled. Leave `CLOUD_JOBS_DB` unset until inspection is complete.
2. Restore all databases from the same snapshot and restore the exact `CLOUD_ENVIRONMENT`, pepper, idempotency secret, and KMS access needed by that snapshot.
3. Run `PRAGMA integrity_check` against each database.
4. Start one application process against the restored files with provider callbacks inaccessible from the public internet.
5. Clear any in-memory KMS cache by restarting the process, then decrypt a workspace name, project name, current document, and retained historical revision from a designated recovery fixture.
6. Export the recovery workspace and compare document and revision counts with the backup manifest.
7. Inspect queued and running jobs. Expired leases may be reclaimed. Prevent old invitation email, seat updates, or deletion jobs from running until their effects have been reviewed.
8. Revoke restored browser and CLI sessions if the restore moves authentication state backward or if credentials may have been exposed.
9. Enable provider callbacks, email, Stripe writes, and the job worker only after the data and KMS checks pass.
10. Record recovery time, data-loss window, checks performed, and any manual reconciliation required.

### 4.3 KMS key usability drill

Run this drill on a schedule and after KMS policy or key changes:

1. Create a recovery workspace, project, document, and more than one revision through the normal service path.
2. Record only opaque IDs and expected content digests in the drill record. Do not copy document plaintext into logs.
3. Take a coordinated backup.
4. Restore it on an isolated host with an empty process cache.
5. Use the managed KMS adapter to decrypt the workspace value, unwrap the project key, authenticate both revision ciphertexts, and export the workspace.
6. Verify a service restart can repeat the reads. A read served only from the prior in-memory cache is not a successful drill.
7. Verify the runtime KMS principal has no broader permissions than required and that denial produces an alert without returning partial plaintext.

Managed envelopes retain their KMS key reference. KMS rotation must preserve decrypt access to every reference present in backups and live rows. The current job worker does not implement project-key or workspace-envelope rewrap. Do not disable or schedule deletion of an old KMS key until rewrap exists, all live data and retained backups have been migrated or expired, and a restore drill succeeds with the intended key set.

## 5. Logging and data handling

Do not log request or response bodies for Cloud routes. In particular, exclude:

- Markdown, decrypted metadata, titles, filenames, tags, search queries, and snippets
- Email codes, OAuth authorization codes, state, nonce, PKCE verifier, sessions, CLI tokens, invitation tokens, and cookies
- Stripe secret keys, webhook signatures, raw webhook bodies, customer email, and payment details
- KMS plaintext keys, wrapped-key blobs, ciphertext, nonces, and encryption context containing resource IDs

Redact query parameters in proxy and platform access logs for OAuth callbacks, invitation acceptance, CLI authorization, and any route carrying a token or code. The application sets `Referrer-Policy: no-referrer` on OAuth redirects, but infrastructure access logs can still capture the incoming callback URL.

The billing database records a SHA-256 digest of each raw Stripe webhook payload, not the payload itself. Subscription state records both the Stripe event creation time and the Stripe subscription creation time. Event time orders updates to one subscription; subscription creation time prevents a delayed event from an older subscription replacing its successor. Cloud audit events contain opaque workspace, project, resource, user, and credential IDs plus action, result, and timestamp. Keep customer content out of audit rows, traces, metrics labels, exception metadata, and crash reports.

Development email-code logging is a local-only mechanism. Production startup configuration cannot enable it for a non-loopback public origin. Do not change that guard to diagnose mail delivery.

Disable production core dumps and unrestricted heap snapshots. Treat process memory, swap, SQLite files, backups, and job payloads as sensitive. Use encrypted host storage and encrypted or disabled swap according to the host platform.

## 6. Stripe webhook and seat reconciliation

Configure Stripe to send subscription events to:

```text
${CLOUD_AUTH_PUBLIC_ORIGIN}/api/cloud/billing/stripe/webhook
```

The endpoint must receive the unmodified raw body and `Stripe-Signature` header. A reverse proxy must not parse and reserialize JSON. The adapter verifies the signature and timestamp before parsing. Webhook event IDs are recorded transactionally with subscription updates, so a retry is idempotent. Only the payload digest is retained.

Checkout writes `workspace_id` and `plan` into Checkout Session and subscription metadata. Subscription webhooks map Stripe states into `active`, `past_due`, `read_only`, or `canceled`. Unknown states become read-only. Verify in Stripe test mode that all expected subscription lifecycle events contain this metadata and exactly one subscription item used for seat quantity.

Team checkout starts with the current active member count. Invitation acceptance is allowed while the configured Team `maxMembers` limit has capacity. Acceptance and member removal then attempt an immediate Stripe quantity update. If it fails, a `team_seat_sync` job is queued with an idempotency key derived from workspace and member count. Reconciliation reads the subscription again and updates its first item with prorations.

This ordering allows membership to change before billing reconciliation completes. Monitor the difference between active members and billed seats, retry dead seat-sync jobs through an operator procedure, and run scheduled reconciliation. The local `billedSeats` value changes when a matching Stripe subscription webhook is processed, not when the outbound quantity update returns.

Monitor:

- Webhook signature failures and event age
- Webhook delivery retries and unprocessed subscription changes
- Local subscription state compared with Stripe status, price, customer, and quantity
- Dead or repeatedly retried `team_seat_sync` jobs
- Team member count compared with billed quantity
- Grace periods approaching read-only transition

Run a scheduled reconciliation from Stripe to the local billing database. Webhooks are the normal update path, not the sole recovery mechanism.

## 7. Launch checks

### Service and storage

- Run one process on a persistent local volume.
- Use explicit absolute database paths and verify owner-only permissions.
- Confirm all database paths and sidecars are included in disk monitoring.
- Run a full backup, restore, and KMS usability drill.
- Alert on SQLite corruption, disk-full errors, WAL growth, lock timeouts, and backup age.
- Set and publish retention behavior before enabling revision pruning.

### Encryption

- Use `CLOUD_KMS_KEY_ID` and `CLOUD_KMS_REGION`; leave `CLOUD_MASTER_KEY` and normally `CLOUD_KMS_CLIENT_MODULE` unset.
- Pin `CLOUD_ENVIRONMENT` and test it against restored ciphertext.
- Restrict the KMS runtime principal and backup operator separately.
- Confirm old KMS references remain decryptable after rotation.
- Alert on KMS unavailable, invalid response, decrypt failure, and authentication failure.

### Authentication and email

- Set the exact HTTPS public origin and provider callback URLs.
- Verify Google issuer, audience, JWKS rotation, nonce, PKCE, and verified-email failure cases in production-like tests.
- Verify GitHub PKCE, numeric user ID, granted `user:email` scope, and verified primary-email failure cases.
- Confirm OAuth binding cookies are Secure, HttpOnly, SameSite=Lax, host-only, short-lived, and cleared after callback.
- Test email delivery on a second device, resend invalidation, expiry, throttling, and provider outage.
- Keep development code logging disabled.
- Configure trusted-proxy handling and test the client address used for rate limits.

### Billing

- Set and verify both Stripe price IDs and an explicit API version.
- Configure and test the webhook secret with raw-body delivery.
- Approve plan-limit JSON and payment-grace policy without adding a document-count limit.
- Exercise checkout, renewal, failed payment, recovery, cancellation, portal access, and read-only behavior.
- Test member admission at the configured plan limit and run seat reconciliation under retries, delayed webhooks, and duplicate webhooks.

### Jobs and observability

- Configure the durable jobs database.
- Use `npm run cloud:jobs -- --email --fail-on-dead` during staging email checks and deployment verification.
- Alert on queue age, expired leases, retries, and dead jobs by type.
- Add recurring job cleanup and reconciliation schedules.
- Verify deletion purge and revision pruning against restored backups.
- Confirm logs, traces, metrics, and proxy access logs follow the redaction rules above.
- Confirm no provider token, code, customer content, query, or snippet is present in a representative production diagnostic capture.
