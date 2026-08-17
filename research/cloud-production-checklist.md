---
title: SmallDocs Cloud production checklist
tags:
  - cloud
---

# SmallDocs Cloud production checklist

This is the work required before SmallDocs Cloud accepts paying customers and customer documents. It is written for the current `feature/cloud-foundation` implementation and the existing `smalldocs.org` server.

## Recommended launch path

Launch a small private beta before a public paid launch:

1. Run SmallDocs Cloud on its dedicated Hetzner CX23. Give SmallCRM a separate VM when it is ready for production.
2. Run one SmallDocs Node process against the current local SQLite stores. PostgreSQL 16 is installed but is not used by the current implementation. Migrate before horizontal replication, or earlier if private-beta measurements justify the engineering work.
3. Keep the existing shared host for staging with test data only after the `smalldocs.org` cutover is complete.
4. Invite a small number of known users and exercise recovery, billing, offboarding, conflicts, and search.
5. Move to a shared transactional database before horizontal scaling, not merely because the product has its first customers.

Do not add a second application replica until PostgreSQL-backed concurrency, jobs, migrations, and webhook behavior have passed the launch test matrix.

## Provisioned AWS foundation

Completed on 14 August 2026:

- [x] Enabled a single-Region IAM Identity Center organization instance in `eu-central-1` using the AWS-owned encryption key.
- [x] Created the `joshua` workforce identity, the `Administrators` group, and the one-hour `AdministratorAccess` permission set.
- [x] Verified that the root identity has MFA and no access keys, then stopped using root for routine administration.
- [x] Created the `Odd Solutions Production` Organizations member account.
- [x] Assigned the `Administrators` group to the production account through Identity Center.
- [x] Configured local temporary-session profiles `odd-solutions-admin` for the management account and `odd-solutions-production-admin` for production. No local long-lived AWS credentials file was created.
- [x] Created the `odd-solutions-production-monthly` USD 10 cost budget with actual-spend alerts at 50, 80, and 100 percent.
- [x] Created the single-region AWS KMS key `alias/smalldocs-cloud-production` in `eu-central-1`. Keep its concrete identifier in the private operator notes.
- [x] Ran the built-in AWS adapter and CloudStore against the production key. A temporary encrypted document remained decryptable after closing and reopening the database, key provider, and AWS client. The temporary database was then removed.
- [x] Created a context-restricted application identity with Encrypt and Decrypt access only to the production document key. The real readiness flow passed from the production VM's systemd sandbox.
- [x] Created a separate KMS-encrypted, versioned S3 backup bucket with 30-day Object Lock retention and public access blocked. Its put-only uploader cannot list, read, delete, or decrypt backups.

The management account contains unrelated legacy IAM and S3 resources. Do not reuse or change them until their dependency has been identified. Exact identifiers belong in the private operator notes, not this public implementation checklist.

Create all new SmallDocs and SmallCRM KMS keys, backup buckets, workload roles, audit trails, and budgets in the production member account. Keep separate resources and permissions for each product even though they share the account during the beta.

## Launch blockers at a glance

- [x] Complete real AWS KMS smoke tests through both an administrator session and the restricted production workload identity.
- [x] Add production configuration validation. Production startup refuses partial Cloud configurations, local `CLOUD_MASTER_KEY`, an HTTP public origin, missing durable jobs, and missing billing or mail settings.
- [x] Make Stripe tax behavior match the Cloud page. Checkout enables automatic tax, requires a billing address, and accepts business tax IDs. Add tax registrations only after the business is registered in that jurisdiction.
- [ ] Decide and configure plan allowances, retention, failed-payment grace, and deletion windows.
- [ ] Set up production authentication, email, and Stripe resources.
- [x] Create coordinated nightly backups and complete a real restore drill. The downloaded archive hash matched and every retained SQLite database passed integrity checking.
- [ ] Add monitoring for the process, disk, databases, KMS, mail, Stripe webhooks, and dead jobs.
- [ ] Publish the customer-facing legal and operational documents.
- [ ] Pass the staging test matrix and a limited private beta.

The remaining external setup starts with transactional email, followed by OAuth and Stripe test-mode resources. Keep Cloud disabled until the complete production environment validates.

## Expected costs and provider comparisons

Prices checked on 14 August 2026. They are planning estimates, not quotes. Most infrastructure prices exclude VAT. Approximate sterling conversions below use £1 = $1.35 and €1 = £0.855. Keep the provider's native currency in the budget because exchange rates move.

### Current beta infrastructure

SmallDocs has its own CX23 in Nuremberg: 2 shared vCPUs, 4 GB RAM, 40 GB local disk, and a 2 GB low-swappiness swap file. The measured idle application RSS is about 55 MB. PostgreSQL, Nginx, Fail2ban, unattended security updates, and Node 24 LTS are installed. The application runs as a non-login service user and binds only to loopback.

Expected fixed incremental cost:

| Item | Initial monthly cost | Notes |
| --- | ---: | --- |
| CX23 | €6.59 before VAT | Current selected server price |
| Primary IPv4 | About €0.70 before VAT | Billed hourly |
| Hetzner native backups | About €1.32 before VAT | 20 percent of server price when enabled |
| Document and backup KMS keys | $2 | Two customer-managed keys at $1 each |
| S3 backup storage and requests | Cents initially | The current locked archive is about 3.1 MB |
| Transactional email | £0 initially | Subject to the provider's free-tier limits |
| Monitoring | £0 initially | Add paid retention only after measuring volume |

The expected fixed total is about €8.60 before VAT plus $2 and small S3 usage. This excludes the existing server bill, Stripe fees, tax, domain registration, and engineering or professional costs.

### Dedicated SmallDocs service boundary

```text
Nginx
  -> smalldocs.service as smalldocs
       -> local SQLite databases under /var/lib/smalldocs
       -> context-restricted SmallDocs KMS identity
       -> nightly coordinated backups to locked S3 storage
```

- [x] Give the service a non-login Linux user and restrictive umask.
- [x] Keep root-owned immutable releases separate from the runtime identity.
- [x] Use a hardened systemd unit with an explicit writable state path and no core dumps.
- [x] Bind Node to loopback and expose only SSH, HTTP, and HTTPS through the host and cloud firewalls.
- [x] Keep document KMS and backup KMS permissions in separate workload identities.
- [ ] Monitor CPU, RSS, event-loop delay, disk, backup duration, and request latency by service.

### KMS comparison

KMS request cost is unlikely to affect the decision. Engineering fit, workload authentication, audit logs, and key-recovery procedures matter more.

| Choice | Published price | Expected SmallDocs cost | Notes |
| --- | ---: | ---: | --- |
| AWS KMS customer-managed key | $1 per key-month; first 20,000 eligible requests free, then $0.03 per 10,000 | About £0.74 for one production key, or £1.48 with staging | Mature IAM and CloudTrail. A Hetzner workload needs a secure AWS workload credential strategy |
| Google Cloud KMS software key | $0.06 per active version-month plus $0.03 per 10,000 operations | Usually under £0.10 for production and staging | Cheapest managed option. Software protection level differs from an HSM-backed key |
| Google Cloud HSM key | Starting at $1 per active version-month plus operations | Similar to AWS KMS | Hardware protection with Google IAM and audit logs |
| Self-hosted Vault Transit | Software can be free | Server, backups, monitoring, upgrades, and on-call time | Adds a security-critical service that SmallDocs must operate. Not recommended for the first launch |

- [AWS KMS pricing](https://aws.amazon.com/kms/pricing/)
- [Google Cloud KMS pricing](https://cloud.google.com/kms/pricing)

Decision: use AWS KMS in the production member account. The asynchronous SDK integration, bounded key cache, readiness check, context-restricted application identity, separate backup key, and production-host smoke test are complete.

Do not select a provider based on the difference between $0.06 and $1 per month. Select the one whose account recovery, workload identity, audit access, and operator permissions you are prepared to maintain.

### Transactional email comparison

| Provider | Entry cost | At modest volume | Operational difference |
| --- | ---: | ---: | --- |
| Resend | $0 for 3,000 emails/month, capped at 100/day | $20/month for 50,000, then $0.90 per extra 1,000 | Easiest low-volume beta fit and works with the current SMTP client |
| Postmark | $0 for 100 test emails/month | $15/month for 10,000, then $1.80 per extra 1,000 | Paid earlier, but a focused transactional-mail product with no daily cap on paid plans |
| AWS SES | $0.10 per 1,000 outgoing emails plus data | Roughly $1 for 10,000 text emails | Cheapest unit cost, but requires AWS production-access approval, DNS setup, bounce and complaint processing, and more delivery operations |

- [Resend pricing](https://resend.com/pricing)
- [Postmark pricing](https://postmarkapp.com/pricing/)
- [AWS SES pricing](https://aws.amazon.com/ses/pricing/)

Recommendation: start the private beta on Resend's free plan and set an alert below the 100-email daily cap. A sign-in attempt, resend, and invitation can create several messages per user, so the cap may become the first limit reached. Move to Resend Pro or Postmark before a public launch if the daily cap could interrupt sign-in. SES becomes financially meaningful only at volumes far above the first launch, where delivery operations are already a dedicated concern.

### Backups and monitoring

For small compressed SQLite archives, AWS S3 is likely to remain below £1/month. S3 Standard is around $0.023 per GB-month in common regions, so 20 GB of retained backups is roughly $0.46/month before request charges. A $1/month Lightsail object-storage bucket includes 5 GB if the production stack is already in AWS. Hetzner Object Storage begins at €4.99/month but includes 1 TB.

- [Amazon S3 pricing](https://aws.amazon.com/s3/pricing/)
- [Lightsail object storage pricing](https://aws.amazon.com/lightsail/faq/#Object_storage)
- [Hetzner Object Storage](https://www.hetzner.com/storage/object-storage/)

Keep native server snapshots for fast recovery, but also keep application-consistent encrypted database archives in another failure domain. Native snapshots alone do not solve cross-database consistency or loss of the hosting account.

For early monitoring:

- Better Stack's free tier includes 10 monitors or heartbeats, one status page, 3 GB logs with three-day retention, metrics, and exception tracking. Paid telemetry bundles begin around $30/month on monthly billing.
- UptimeRobot's free tier includes 50 monitors at five-minute intervals. Its Solo plan is $9/month for one-minute checks.

- [Better Stack pricing](https://betterstack.com/pricing)
- [UptimeRobot pricing](https://uptimerobot.com/pricing/)

Recommendation: begin with Better Stack's free uptime checks and backup/job heartbeats. Keep customer content and search queries out of anything shipped to it. Add paid log retention only after measuring actual diagnostic volume and redaction.

### Stripe cost at the current prices

Stripe has no fixed monthly platform fee on the pay-as-you-go plans used here, but three variable charges can apply:

- UK standard card processing: 1.5 percent plus 20p per successful charge.
- Stripe Billing: 0.7 percent of subscription Billing volume.
- Stripe Tax Basic, if enabled: 0.5 percent per Checkout or Billing transaction where registered to collect tax.

- [Stripe UK payments pricing](https://stripe.com/gb/pricing)
- [Stripe Billing pricing](https://stripe.com/gb/billing/pricing)
- [Stripe Tax pricing](https://stripe.com/tax/pricing)

Approximate fee examples for a UK standard card, before VAT treatment and excluding disputes, refunds, international-card uplifts, and currency conversion:

| Charge | Payments | Billing | Tax Basic | Total Stripe fee | Amount left before tax liability |
| --- | ---: | ---: | ---: | ---: | ---: |
| £4 Personal subscription | 26p | 2.8p | 2p | 30.8p | £3.692 |
| £7 one-person Team charge | 30.5p | 4.9p | 3.5p | 38.9p | £6.611 |
| £35 Team charge for five seats | 72.5p | 24.5p | 17.5p | £1.145 | £33.855 |

One combined Team subscription is cheaper than five separate £7 charges because the 20p card fee is charged once.

At 100 Personal customers and ten five-seat Teams:

```text
Monthly recurring revenue:                         £750.00
Estimated UK-card Payments fees:                   £33.25
Estimated Stripe Billing fees:                      £5.25
Estimated Stripe Tax Basic fees:                    £3.75
Estimated Stripe total:                            £42.25
Revenue after those Stripe fees:                  £707.75
Expected early fixed Cloud infrastructure:     about £20 to £45
```

This is not a margin calculation. It excludes VAT or other tax owed, refunds, support time, accounting, legal costs, salaries, and the existing host bill.

## 1. Choose the production data topology

### Fastest credible first launch: one server and SQLite

- [ ] Keep Cloud on the existing server or provision a separate server with an encrypted persistent disk.
- [ ] Run exactly one `smalldocs` application process.
- [ ] Give each database an explicit absolute path outside the Git checkout, for example `/var/lib/smalldocs/cloud/`.
- [ ] Ensure the service user can read and write that directory and no general user can.
- [ ] Monitor free disk space, database size, WAL growth, and filesystem errors.
- [ ] Back up all Cloud databases together while writes are stopped.

The databases that must move together are:

```text
cloud_auth.db
cloud_oauth.db
cloud.db
cloud_billing.db
cloud_jobs.db
```

SQLite may create `-wal` and `-shm` sidecars. Copying only the main file from a running service is not a valid backup.

### Before running multiple application servers

- [ ] Migrate Cloud state to PostgreSQL or another shared transactional database.
- [ ] Move the worker out of the web process.
- [ ] Add coordinated migrations and provider webhook routing.
- [ ] Re-run tenant isolation, concurrency, idempotency, and restore tests against that database.

This is a scale milestone, not a prerequisite for a controlled single-server beta.

## 2. Finish managed encryption

### Choose a provider

AWS KMS and Google Cloud KMS are both credible choices. The cost comparison above shows that neither is material to the early monthly budget. A production deployment should use a customer-managed symmetric encryption key with encrypt and decrypt usage. The key wraps SmallDocs project and workspace data keys. It does not encrypt Markdown bodies directly.

- [AWS KMS console](https://console.aws.amazon.com/kms/home#/kms/keys)
- [Create a symmetric KMS key](https://docs.aws.amazon.com/kms/latest/developerguide/create-symmetric-cmk.html)
- [AWS KMS encryption context](https://docs.aws.amazon.com/kms/latest/developerguide/encrypt_context.html)
- [Google Cloud KMS console](https://console.cloud.google.com/security/kms)
- [Google Cloud KMS documentation](https://cloud.google.com/kms/docs)

### Account setup

- [x] Create the production document key and a separate production backup key. Create a staging document key only when persistent KMS-backed staging is provisioned.
- [x] Give the production document key the alias `alias/smalldocs-cloud-production`.
- [x] Create a runtime identity with only the required `kms:Encrypt` and `kms:Decrypt` access to the production key and production encryption context.
- [x] Keep key administration in Identity Center operator sessions, separate from the runtime identity.
- [ ] Enable CloudTrail visibility and alerts for denied or unusual decrypt operations.
- [x] Keep email addresses, filenames, document titles, and other customer data out of the encryption context. AWS records the context in CloudTrail.
- [x] Record the KMS region, key identifier, policy, and recovery owner in the private operator notes.

### Required engineering work

- [x] Refactor the current synchronous KMS boundary so the official network client can be awaited without blocking the Node event loop.
- [x] Integrate the official KMS SDK and set request timeouts.
- [x] Preserve the current authenticated encryption context: application, environment, purpose, resource ID, and key version.
- [x] Cache unwrapped data keys for a short, bounded period and clear them on eviction, normal server close, SIGTERM, and SIGINT.
- [x] Fail closed when KMS is unavailable. Reads, search, and writes return a temporary service failure without falling back to a local key.
- [ ] Add integration tests against a real staging key for encrypt, decrypt, wrong context, disabled key, timeout, and rotated key reference.
- [ ] Leave `CLOUD_MASTER_KEY` unset in production.

Do not schedule deletion of an old KMS key. The current implementation does not rewrap old envelopes, so every key reference used by live data or retained backups must remain decryptable.

## 3. Create staging before production

- [x] Create `cloud-staging.smalldocs.org`.
- [x] Point DNS to the dedicated VM for an isolated staging process and persistent data directory.
- [x] Issue an HTTPS certificate.
- [ ] Use separate OAuth clients, Stripe test-mode resources, SMTP credentials, KMS key, secrets, and databases.
- [ ] Put the staging site behind authentication or otherwise prevent accidental public use.
- [ ] Never copy real customer data into staging.

Use this exact staging public origin consistently:

```text
https://cloud-staging.smalldocs.org
```

The origin determines secure cookies, same-origin mutation checks, OAuth callbacks, invitation links, and Stripe return URLs.

Initial staging configuration:

```text
NODE_ENV=production
CLOUD_MODE=staging
CLOUD_PUBLIC_MODE=enabled
CLOUD_AUTH_PUBLIC_ORIGIN=https://cloud-staging.smalldocs.org
CLOUD_ENVIRONMENT=staging

CLOUD_AUTH_DB=/var/lib/smalldocs/staging/cloud_auth.db
CLOUD_OAUTH_DB=/var/lib/smalldocs/staging/cloud_oauth.db
CLOUD_DB=/var/lib/smalldocs/staging/cloud.db
CLOUD_BILLING_DB=/var/lib/smalldocs/staging/cloud_billing.db
CLOUD_JOBS_DB=/var/lib/smalldocs/staging/cloud_jobs.db

CLOUD_MASTER_KEY=... # disposable staging data only
STRIPE_SECRET_KEY=... # Stripe test mode
STRIPE_WEBHOOK_SECRET=... # staging endpoint
STRIPE_PERSONAL_PRICE_ID=... # test price
STRIPE_TEAM_PRICE_ID=... # test price
```

The remaining auth, mail, and secret variables are required in staging as they are in production, but their values must be staging-specific. Replace `CLOUD_MASTER_KEY` with a separate staging KMS key if staging begins to retain realistic or long-lived data.

## 4. Set up sign-in

### Google

- [Google Cloud OAuth clients](https://console.cloud.google.com/apis/credentials)
- [Google OAuth consent and branding](https://console.cloud.google.com/auth/branding)
- [Google web-server OAuth guidance](https://developers.google.com/identity/protocols/oauth2/web-server)

- [ ] Create a Google Cloud project owned by the business, not only a personal account.
- [ ] Configure the app name, support email, homepage, privacy-policy URL, terms URL, and verified domain.
- [ ] Create a Web application OAuth client.
- [ ] Register the production redirect URI exactly, including scheme and path:

```text
https://smalldocs.org/api/cloud/auth/oauth/google/callback
```

- [ ] Add the staging callback to the separate staging client.
- [ ] Store the client ID and client secret in the production secret store.
- [ ] Test an ordinary account, a cancelled consent screen, a replayed callback, and an account without a usable verified email.

SmallDocs requests only `openid email`. Google may still require the consent-screen configuration to be published before arbitrary users can sign in.

### GitHub

- [GitHub developer settings](https://github.com/settings/developers)
- [Create a GitHub OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)

- [ ] Register a production OAuth App under a business-controlled GitHub organization if possible.
- [ ] Set the homepage to `https://smalldocs.org`.
- [ ] Set the authorization callback URL to:

```text
https://smalldocs.org/api/cloud/auth/oauth/github/callback
```

- [ ] Create a separate OAuth App for staging because a GitHub OAuth App accepts one callback URL.
- [ ] Store each client ID and secret in the matching environment.
- [ ] Test private-email accounts and confirm GitHub returns a verified primary email through the requested `user:email` scope.

### Email codes and invitations

Use a transactional email provider rather than a personal Gmail mailbox. The current SMTP client can use Resend, Postmark, SES, or another standards-compliant provider without a new runtime dependency. Resend is the recommended beta choice because its free allowance is sufficient for controlled testing.

- [Resend domains](https://resend.com/domains)
- [Resend API keys](https://resend.com/api-keys)
- [Resend SMTP configuration](https://resend.com/docs/send-with-smtp)
- [Resend domain authentication](https://resend.com/docs/dashboard/domains/introduction)

- [x] Verify `smalldocs.org` for sending. Resend uses `send.smalldocs.org` as its return path without changing website routing.
- [x] Publish and verify the provider's SPF and DKIM records.
- [ ] Start DMARC with reporting, verify every legitimate sender, then move to a stricter policy.
- [x] Create a sending-only production credential and deliver it through a root-owned systemd credential.
- [ ] Create a separate staging credential before persistent email testing in staging.
- [x] Configure SMTP host `smtp.resend.com`, port `587`, username `resend`, and `login@smalldocs.org` as the sender.
- [ ] Use a monitored From address on the verified domain.
- [x] Send a production-path message from the restricted service sandbox and confirm delivery to Gmail.
- [ ] Send test codes and invitations to Gmail, Outlook, iCloud, and a custom-domain mailbox.
- [ ] Check delivery latency, spam placement, expiry, resend invalidation, bounce behavior, and provider outage behavior.
- [ ] Confirm neither login codes nor invitation tokens appear in application or proxy logs.

## 5. Configure Stripe and decide the commercial rules

### Products and prices

- [Stripe products](https://dashboard.stripe.com/products)
- [Stripe API keys](https://dashboard.stripe.com/apikeys)
- [Stripe webhooks](https://dashboard.stripe.com/webhooks)
- [Stripe customer portal](https://dashboard.stripe.com/settings/billing/portal)
- [Stripe Tax](https://dashboard.stripe.com/tax)
- [Stripe subscription integration guide](https://docs.stripe.com/billing/subscriptions/build-subscriptions)

- [ ] Activate and verify the Stripe business account.
- [x] Create sandbox Personal Cloud and Team Cloud products with the intended multi-currency prices and SaaS tax codes.
- [x] Activate the isolated SmallDocs Stripe account and recreate and verify the products and prices in live mode.
- [ ] Decide whether displayed prices include or exclude VAT. Make the Cloud page, Checkout, invoices, and accounting treatment agree.
- [ ] Decide whether to use Stripe Tax. If yes, register the correct head-office address and tax registrations, set a SaaS product tax code, collect a valid billing address, and enable `automatic_tax` in every Checkout Session.
- [ ] Configure the customer portal for payment-method updates and cancellation.
- [ ] Copy the live secret key and both live price IDs to the production secret store.
- [ ] Pin `STRIPE_API_VERSION` to the version tested in staging.

The current Cloud page says taxes are calculated at checkout, but the code does not send `automatic_tax[enabled]=true`. Either implement it and collect the required customer location, or change the copy and use a different approved tax process before launch.

### Webhook

Register this endpoint:

```text
https://smalldocs.org/api/cloud/billing/stripe/webhook
```

- [ ] Subscribe to the customer-subscription lifecycle events used by the integration.
- [ ] Store the signing secret as `STRIPE_WEBHOOK_SECRET`.
- [ ] Ensure Nginx passes the raw request body unchanged.
- [ ] Test with Stripe test clocks or test-mode events: subscribe, renew, upgrade seats, failed payment, grace, recovery, cancel, delayed event, duplicate event, and event replay.
- [ ] Confirm an older webhook cannot overwrite newer subscription state.
- [ ] Confirm active-member count and billed-seat quantity reconcile after invitations and removals.

### Product allowances to decide

There is deliberately no document-count limit. Decide these values and put them in `CLOUD_PLAN_LIMITS_JSON`:

| Decision | Personal | Team |
| --- | --- | --- |
| Total stored bytes | Decide | Decide |
| Maximum file bytes | 10 MB | 10 MB |
| Revision retention days | 90 | 90 |
| Maximum projects | Decide | Decide |
| Maximum human members | `1` | Decide |
| Search requests and window | Decide | Decide |

Also decide:

- [ ] Failed-payment grace period, then read-only behavior.
- [x] Keep no more than three previous revisions per document and expire them after 90 days.
- [x] Keep deleted documents and Team workspaces recoverable for 30 days.
- [ ] Backup expiry after logical deletion.
- [ ] Whether Team storage is a fixed workspace allowance or grows with paid seats. The current billing model supports a fixed workspace allowance.

Publish the chosen limits on `/cloud` before taking payment. The current page lists prices but not storage, file-size, project, or retention allowances.

## 6. Generate and store production configuration

Generate independent random secrets. Do not reuse the OAuth, Stripe, SMTP, or KMS credentials as application secrets.

```bash
openssl rand -base64 48  # CLOUD_AUTH_PEPPER
openssl rand -base64 48  # CLOUD_IDEMPOTENCY_SECRET
openssl rand -base64 48  # CLOUD_CURSOR_SECRET
```

Store the results in the server's secret manager or a root-owned systemd environment file outside the repository. Back up the values through a separate protected recovery mechanism.

Minimum production configuration:

```text
NODE_ENV=production
CLOUD_MODE=production
CLOUD_PUBLIC_MODE=hidden
PORT=3003
TRUST_PROXY=1
CLOUD_AUTH_PUBLIC_ORIGIN=https://smalldocs.org

CLOUD_AUTH_PEPPER=...
CLOUD_IDEMPOTENCY_SECRET=...
CLOUD_CURSOR_SECRET=...
CLOUD_ENVIRONMENT=production

CLOUD_AUTH_DB=/var/lib/smalldocs/cloud/cloud_auth.db
CLOUD_OAUTH_DB=/var/lib/smalldocs/cloud/cloud_oauth.db
CLOUD_DB=/var/lib/smalldocs/cloud/cloud.db
CLOUD_BILLING_DB=/var/lib/smalldocs/cloud/cloud_billing.db
CLOUD_JOBS_DB=/var/lib/smalldocs/cloud/cloud_jobs.db
SHORT_LINKS_DB=/var/lib/smalldocs/short-links/short_links.db

CLOUD_KMS_KEY_ID=alias/smalldocs-cloud-production
CLOUD_KMS_REGION=eu-central-1
CLOUD_KMS_MAX_ATTEMPTS=3
CLOUD_KMS_CONNECTION_TIMEOUT_MS=3000
CLOUD_KMS_REQUEST_TIMEOUT_MS=10000
CLOUD_KMS_OPERATION_TIMEOUT_MS=15000

GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GITHUB_OAUTH_CLIENT_ID=...
GITHUB_OAUTH_CLIENT_SECRET=...

NOTIFY_SMTP_HOST=smtp.resend.com
NOTIFY_SMTP_PORT=587
NOTIFY_SMTP_USER=resend
NOTIFY_SMTP_PASS_FILE=/run/credentials/smalldocs.service/resend-api-key
NOTIFY_EMAIL_FROM=login@smalldocs.org

STRIPE_SECRET_KEY_FILE=/run/credentials/smalldocs.service/stripe-api-key
STRIPE_WEBHOOK_SECRET_FILE=/run/credentials/smalldocs.service/stripe-webhook-secret
STRIPE_API_VERSION=...
STRIPE_PORTAL_CONFIGURATION_ID=bpc_...
STRIPE_PERSONAL_PRICE_ID=price_...
STRIPE_TEAM_PRICE_ID=price_...

CLOUD_PLAN_LIMITS_JSON='{"personal":{"maxStoredBytes":null,"maxFileBytes":10485760,"revisionRetentionDays":90,"maxProjects":null,"maxMembers":null,"search":{"maxRequests":null,"windowMs":null}},"team":{"maxStoredBytes":null,"maxFileBytes":10485760,"revisionRetentionDays":90,"maxProjects":null,"maxMembers":null,"search":{"maxRequests":null,"windowMs":null}}}'
CLOUD_PAYMENT_GRACE_MS=...
CLOUD_REVISION_KEEP_PREVIOUS=3
CLOUD_REVISION_RETENTION_DAYS=90
CLOUD_DOCUMENT_RESTORE_WINDOW_MS=2592000000
CLOUD_WORKSPACE_RESTORE_WINDOW_MS=...
```

Add explicit search, workspace-creation, and invitation limits after load testing. Their complete names and behavior are in [the Cloud operations reference](./cloud-operations.md).

- [ ] Confirm `CLOUD_AUTH_DEV_LOG_CODES` is absent.
- [ ] Confirm `CLOUD_MASTER_KEY` is absent.
- [ ] Set `TRUST_PROXY=1` only if Nginx overwrites, rather than appends untrusted values to, the client-address header.
- [ ] Check the systemd unit uses the intended environment file and service account.
- [ ] Restart the service and inspect startup logs without printing the environment.

## 7. Configure Nginx and the host

- [ ] Keep TLS certificate renewal working and redirect HTTP to HTTPS.
- [ ] Add HSTS after confirming every production route works over HTTPS.
- [ ] Preserve the original Host and scheme headers.
- [ ] Overwrite the forwarded client-address header at the trusted proxy boundary.
- [ ] Do not log query strings for OAuth callbacks, invitation acceptance, or CLI authorization routes.
- [ ] Do not log Cloud request or response bodies.
- [ ] Set a request-body limit that is at least the published maximum file size plus envelope overhead.
- [ ] Confirm Stripe's webhook raw body reaches Node unchanged.
- [ ] Disable core dumps and unrestricted production heap snapshots.
- [ ] Enable encrypted disk and decide how swap is encrypted or disabled.
- [ ] Patch Node, the operating system, Nginx, and runtime dependencies on a defined cadence.

The existing production deployment is `smalldocs.service` on port `3003` behind Nginx. Inspect the live systemd and Nginx configuration before editing it. Do not replace the current local SmallDocs deployment until staging has passed.

## 8. Backups and recovery

- [x] Treat the existing short-link SQLite database as live production data and resolve its default path on the old host.
- [x] Rehearse migration with SQLite's online backup mechanism. Repeat the snapshot during cutover to capture links created after the rehearsal.
- [x] Compare the 447-row rehearsal count and verify a representative stored ciphertext through the new host's HTTP API without printing its identifier or value.
- [x] Include `SHORT_LINKS_DB` in encrypted off-site backups. The rehearsal snapshot is present in the locked archive.
- [x] Run the coordinated backup nightly with 30-day governance retention in versioned storage.
- [x] Stop the new application briefly so all local databases and sidecars are archived together, then restart it before upload.
- [x] Encrypt the archive with a separate AWS KMS key and store it outside Hetzner.
- [x] Record a portable SHA-256 checksum, deployed commit, state paths, configuration, KMS encryption metadata, and object version.
- [x] Include the root-managed application environment in the KMS-encrypted archive. The put-only backup identity cannot read or decrypt the archive.
- [ ] Alert when the latest successful backup is too old.

Complete this drill before launch:

1. Restore all databases from the same snapshot into an isolated host.
2. Keep outbound email, Stripe writes, and the job worker disabled.
3. Run `PRAGMA integrity_check` on every database.
4. Restore the exact application secrets and KMS permissions.
5. Sign in with a recovery account.
6. Decrypt a workspace name, project name, current document, and historical revision.
7. Export the recovery workspace and compare counts with the backup manifest.
8. Inspect queued jobs before allowing the worker to run.
9. Document recovery time, data-loss window, and every manual step.

A backup that has not passed the KMS decryption drill is not a known-good Cloud backup.

## 9. Monitoring and operator access

### Monitor

- [ ] Process availability and HTTPS response time.
- [ ] CPU, memory, open files, disk use, and disk latency.
- [ ] Each database size, WAL size, corruption errors, locks, and disk-full errors.
- [ ] KMS latency, denials, timeouts, and decrypt failures.
- [ ] OAuth callback failures and email delivery failures without logging tokens or codes.
- [ ] Stripe signature failures, old events, webhook retries, subscription drift, and seat drift.
- [ ] Job queue age, retries, expired leases, and dead jobs by type.
- [ ] Search timeouts, corpus-limit failures, and rate-limit volume without logging search text.
- [ ] Backup age and restore-drill date.

### Decide how incidents work

- [ ] Name the person who can access the host, KMS administration, Stripe, DNS, email, and backups.
- [ ] Require MFA for every provider account and keep recovery codes offline.
- [ ] Use individual operator accounts instead of shared logins.
- [ ] Document how to revoke an operator and rotate their credentials.
- [ ] Write procedures for KMS outage, database corruption, disk full, lost Stripe webhook, email outage, compromised session, and suspected customer-data access.
- [ ] Keep customer document content, titles, tags, queries, snippets, tokens, cookies, and raw webhooks out of logs, traces, metrics labels, and crash reports.

## 10. Legal, privacy, and customer expectations

This section needs review for the business and jurisdictions involved. It is not a substitute for legal or tax advice.

- [ICO data protection fee and self-assessment](https://ico.org.uk/for-organisations/data-protection-fee/)
- [ICO guidance on privacy information](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/the-right-to-be-informed/)
- [ICO personal-data breach guidance](https://ico.org.uk/for-organisations/report-a-breach/personal-data-breach/)

- [ ] Confirm the legal entity selling the subscription and the business contact address.
- [ ] Complete the ICO fee self-assessment and register if required.
- [ ] Publish Terms, Privacy, acceptable-use, cancellation/refund, and subprocessors pages.
- [ ] Explain the actual Cloud trust boundary: SmallDocs can decrypt an authorized document to provide browser access and search. Cloud is encrypted at rest, not end-to-end encrypted or zero knowledge.
- [ ] List the personal data stored in plaintext, including verified email addresses and provider/customer identifiers.
- [ ] State purposes, lawful bases, retention, deletion, backups, international transfers, and how a person exercises data rights.
- [ ] Obtain and retain processor terms or DPAs from hosting, KMS, email, monitoring, backup, and payment providers as appropriate.
- [ ] Define how customers request an export, account deletion, or support.
- [ ] Define breach assessment, internal recording, customer notification, and regulatory reporting.
- [ ] Make the public security copy agree with the implemented KMS, retention, search, and operator-access behavior.

## 11. Staging acceptance test

Run this with two human accounts, two browsers, one phone-sized browser, and two CLI credentials:

- [ ] Subscribe to Personal and create, tag, search, edit, restore, delete, and recover a document.
- [ ] Create a Team, invite a member with project-specific access, and accept on a second device.
- [ ] Confirm a viewer cannot edit and a removed member immediately loses access.
- [ ] Confirm the final owner cannot be removed.
- [ ] Sign a CLI in once, restart the shell, and confirm it remains signed in.
- [ ] Use `sdoc cloud ls`, `tags`, `search`, `create`, `pull`, `push`, `history`, `restore`, `delete`, `deleted`, and `undelete` in human and `--json` modes.
- [ ] Produce a revision conflict from two clients and recover without losing either edit.
- [ ] Revoke a CLI credential and confirm its next request fails.
- [ ] Test an invitation expiry and resend.
- [ ] Test payment failure, grace, read-only mode, payment recovery, cancellation, export, and workspace deletion.
- [ ] Confirm adding and removing Team members updates Stripe seats.
- [ ] Restore the deleted Team during its window and permanently purge it after the window in an accelerated staging configuration.
- [ ] Search from a new browser and phone without downloading the workspace first.
- [ ] Review proxy, app, provider, and error logs for leaked content, queries, codes, tokens, or customer email.
- [ ] Stop KMS, SMTP, Stripe access, and disk writes in turn and confirm each failure is bounded and understandable.
- [ ] Run `node test/run.js` against the release commit.

## 12. Private beta and public launch

### Private beta

- [ ] Invite 5 to 10 known users who understand the beta scope.
- [ ] Cap the beta duration and review support issues, search cost, file sizes, revision growth, mail delivery, and recovery behavior weekly.
- [ ] Do not promise horizontal availability while the service is single-host.
- [ ] Keep a direct way to export a workspace if billing or Cloud is unavailable.
- [ ] Perform at least one backup restore during the beta.

### Public paid launch

- [ ] Merge the reviewed release branch into `main` and tag the release.
- [ ] Back up the current production service before deployment.
- [ ] Deploy the exact tested commit.
- [ ] Run a sign-in, checkout, document create/read/search/update, CLI, invitation, billing portal, and webhook smoke test.
- [ ] Confirm local SmallDocs and encrypted short links still work without an account or subscription.
- [ ] Watch application, Stripe, email, KMS, jobs, and disk telemetry during the first payments.
- [ ] Keep a rollback procedure that preserves any Cloud writes created after launch.

## Suggested order of work

1. Choose AWS KMS or another provider and let engineering finish the real adapter.
2. Decide tax handling and let engineering make Checkout match it.
3. Decide plan limits and retention.
4. Create staging and provider test credentials.
5. Add production configuration validation and operational health checks.
6. Configure and test sign-in, mail, billing, jobs, and data storage in staging.
7. Build backups and complete the restore drill.
8. Publish privacy, terms, security, limits, and support information.
9. Run the acceptance test and private beta.
10. Create production provider resources, deploy, smoke test, and monitor.

## Related implementation reference

The full environment-variable inventory, database behavior, backup mechanics, logging exclusions, and Stripe reconciliation notes live in [SmallDocs Cloud operations](./cloud-operations.md).
