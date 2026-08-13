---
title: SmallDocs Cloud production checklist
tags:
  - cloud
---

# SmallDocs Cloud production checklist

This is the work required before SmallDocs Cloud accepts paying customers and customer documents. It is written for the current `feature/cloud-foundation` implementation and the existing `smalldocs.org` server.

## Recommended launch path

Launch a small private beta before a public paid launch:

1. Run the initial SmallDocs Cloud and SmallCRM production betas on one clean Hetzner CX33. Keep the existing shared host for staging with test data only.
2. Use PostgreSQL on the production VM for Cloud state. The current SQLite stores require a persistence migration before launch.
3. Run one Node process per product initially. Use separate Linux service users, data directories, database identities, secrets, KMS keys, systemd services, backups, and staging and production credentials.
4. Invite a small number of known users and exercise recovery, billing, offboarding, conflicts, and search.
5. Move to a shared transactional database before horizontal scaling, not merely because the product has its first customers.

Do not add a second application replica until PostgreSQL-backed concurrency, jobs, migrations, and webhook behavior have passed the launch test matrix.

## Provisioned AWS foundation

Completed on 14 August 2026:

- [x] Enabled a single-Region IAM Identity Center organization instance in `eu-central-1` using the AWS-owned encryption key.
- [x] Created the `joshua` workforce identity, the `Administrators` group, and the one-hour `AdministratorAccess` permission set.
- [x] Verified that the root identity has MFA and no access keys, then stopped using root for routine administration.
- [x] Created the `Odd Solutions Production` Organizations member account, account ID `732006412787`.
- [x] Assigned the `Administrators` group to the production account through Identity Center.
- [x] Configured local temporary-session profiles `odd-solutions-admin` for the management account and `odd-solutions-production-admin` for production. No local long-lived AWS credentials file was created.
- [x] Created the `odd-solutions-production-monthly` USD 10 cost budget with actual-spend alerts at 50, 80, and 100 percent.
- [x] Created the single-region AWS KMS key `alias/smalldocs-cloud-production` in `eu-central-1`. The concrete key ARN is `arn:aws:kms:eu-central-1:732006412787:key/fc5537bd-4a58-4ade-853c-77a09439dd65`.
- [x] Ran the built-in AWS adapter and CloudStore against the production key. A temporary encrypted document remained decryptable after closing and reopening the database, key provider, and AWS client. The temporary database was then removed.

The management account, account ID `703318158341`, contains a legacy `taaalkuser` IAM identity and `taaalk` S3 bucket. The legacy user still has an active access key and the AWS-managed `AmazonS3FullAccess` policy. Do not reuse it for either product or deactivate it until its dependency has been identified. The existing bucket is private, versioned, encrypted with S3-managed AES-256, and treated as unrelated live data.

Create all new SmallDocs and SmallCRM KMS keys, backup buckets, workload roles, audit trails, and budgets in the production member account. Keep separate resources and permissions for each product even though they share the account during the beta.

## Launch blockers at a glance

- [x] Complete a real AWS KMS smoke test. The application and CloudStore use the built-in asynchronous AWS KMS client with bounded retries, timeouts, caching, and generic client-facing failures. The create, read, restart, and decrypt cycle passed on 14 August 2026 using an Identity Center session. A restricted production workload identity is still required before deployment.
- [ ] Add production configuration validation. Production startup should refuse partial Cloud configurations, local `CLOUD_MASTER_KEY`, an HTTP public origin, missing durable jobs, and missing billing or mail settings.
- [ ] Make Stripe tax behavior match the Cloud page. The page says tax is calculated at checkout, but checkout does not currently enable Stripe automatic tax or collect the billing location it needs.
- [ ] Decide and configure plan allowances, retention, failed-payment grace, and deletion windows.
- [ ] Set up production authentication, email, Stripe, and KMS accounts.
- [ ] Create coordinated backups and complete a real restore drill that decrypts retained revisions.
- [ ] Add monitoring for the process, disk, databases, KMS, mail, Stripe webhooks, and dead jobs.
- [ ] Publish the customer-facing legal and operational documents.
- [ ] Pass the staging test matrix and a limited private beta.

The first three items require code changes. I can implement those after you choose the KMS provider and tax approach.

## Expected costs and provider comparisons

Prices checked on 14 August 2026. They are planning estimates, not quotes. Most infrastructure prices exclude VAT. Approximate sterling conversions below use £1 = $1.35 and €1 = £0.855. Keep the provider's native currency in the budget because exchange rates move.

### What the existing server changes

The current `smalldocs.org` host has:

```text
2 vCPUs
about 8 GB RAM
about 80 GB disk, with about 56 GB currently free
current smalldocs.service memory: about 48 MB when checked
```

That is enough capacity for a low-volume Cloud beta if search limits are conservative and memory, disk, and latency are monitored. Using it avoids a second compute bill. The trade-off is a larger failure boundary: local SmallDocs, short links, Cloud, billing callbacks, jobs, and the SQLite databases all depend on one host and process.

### Estimated launch stacks

| Stack | Expected fixed cost per month | What it buys | Main trade-off |
| --- | ---: | --- | --- |
| Existing Hetzner host | About £2 to £5 incremental, plus the existing server bill | No hosting migration. Add one KMS key, small off-site backups, free email tier, and free monitoring | One host and one process remain the failure boundary |
| Existing host plus full-time Hetzner staging | About £10 to £14 incremental | The production path above plus an isolated staging server | Staging needs its own updates, secrets, backups, and monitoring |
| Hetzner CX33 production server | €10.69 before VAT with IPv4 and Hetzner backups, plus KMS and off-site database storage | 4 shared vCPUs, 8 GB RAM, 80 GB disk, and an intentionally isolated home for the two early product betas | The products still share one VM failure boundary |
| AWS Lightsail, 4 GB | About £20 to £25 | One AWS account for compute, KMS, snapshots, and object backups | Costs more, still a self-managed single server, and moving the live site adds work |
| Railway Pro, estimated 2 GB service | About £22 to £30 | Managed deploys, secrets, logs, and a persistent volume | Usage pricing varies; SQLite still forces one replica and coordinated backups |
| Existing app host plus Neon Postgres | About £11 typical, before app hosting | Managed Postgres with a 7-day restore window | Requires a real database migration; not usable by the current code as a configuration change |
| Existing app host plus Supabase Pro | From about £19, before app hosting | Managed Postgres, 8 GB disk, and 7-day daily backups | Also requires migration; bundled auth and storage duplicate features SmallDocs already has |

Sources and assumptions:

- Hetzner's June 2026 price list puts a CX33 at €8.49/month before IPv4 and VAT. Native server backups add 20 percent of the server price and keep seven slots. See [Hetzner's current price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) and [backup billing](https://docs.hetzner.com/cloud/billing/faq/).
- A separate Hetzner Object Storage account is €4.99/month and includes 1 TB. That is good value once storage grows, but more than a small compressed database backup should cost elsewhere. See [Hetzner Object Storage pricing](https://www.hetzner.com/storage/object-storage/).
- AWS Lightsail is $24/month for 4 GB RAM with public IPv4 or $44/month for 8 GB. Snapshots cost $0.05 per stored GB-month. See [Lightsail bundles](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html) and [snapshot pricing](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-faq-snapshots.html).
- Railway Pro has a $20 monthly minimum that is credited against usage. Current rates are $10 per GB-month RAM, $20 per vCPU-month, and $0.15 per GB-month volume. A continuously allocated 2 GB RAM, average 0.25 vCPU, and 10 GB volume is about $26.50/month before egress. See [Railway pricing](https://railway.com/pricing).
- Neon Launch lists a typical intermittent 1 GB database at $15/month and charges from actual compute and storage. See [Neon pricing](https://neon.com/pricing).
- Supabase Pro starts at $25/month with one Micro database, 8 GB disk, and seven days of daily backups. Point-in-time recovery is a separate $100/month add-on. See [Supabase pricing](https://supabase.com/pricing).

These totals do not include the existing server bill, VAT, paid support, engineering time, domain registration, legal or accounting advice, or Stripe's variable fees.

### My recommendation for the beta

Use a Hetzner CX33 in Germany for the initial SmallDocs Cloud and SmallCRM production betas, and use the existing shared host for staging. The server audit found that the existing `deploy` identity runs several applications and has broad administrative paths, so it remains unsuitable for customer production data. On the new VM, SmallDocs and SmallCRM run as separate restricted services that cannot read each other's state, backups, or credentials. Use a different provider for encrypted database backups so loss of the Hetzner account or region does not remove both the service and its recovery copy.

The current CX33 price is €8.49 per month before VAT. One Primary IPv4 is €0.50. Hetzner's seven-slot server backup option costs 20 percent of the server price, about €1.70. The resulting Hetzner production invoice is about €10.69 per month before VAT. The server includes 4 shared vCPUs, 8 GB RAM, 80 GB local disk, and 20 TB of traffic in EU locations.

A CX23 would reduce this to about €7.09 before VAT with IPv4 and backups, but it has 4 GB RAM and 40 GB disk. It can run one constrained beta, but the €3.60 monthly saving is not worth halving the memory available to two Node processes, PostgreSQL, SmallCRM SQLite, in-memory document search, operating-system cache, and backup operations.

Do not move both products to a CX43 merely because one CX33 becomes busy. At current prices, a SmallDocs CX33 plus a SmallCRM CX23 costs less than one CX43 and creates a better security and failure boundary. Split the products when monitoring, customer value, or operational risk warrants it.

Expected fixed incremental cost:

| Item | Beta | After early growth |
| --- | ---: | ---: |
| Existing staging compute | £0 incremental | £0 until isolation requires a move |
| Shared product-production CX33, IPv4, and native backups | €10.69 before VAT | Split into a SmallDocs CX33 and SmallCRM CX23 when warranted |
| Production and staging KMS keys | About £0.10 to £1.50 | Usually under £3 at this scale |
| Off-site object backups | Under £1 for small archives | Roughly proportional to stored backup GB |
| Transactional email | £0 | About £11 to £15 when a paid tier is needed |
| Uptime and basic telemetry | £0 | £0 to about £22 depending on retention and alerting |
| Expected total | About €12/month before VAT, plus small currency and request variation | About €20 to €45/month depending on email and monitoring choices |

The existing Hetzner invoice still exists. The clean CX33 is the main new fixed cost.

### Shared CX33 service boundary

Sharing the first production VM is acceptable because neither product has proven production load and the VM will be built around these two known services. It must not recreate the existing host's shared `deploy` identity.

```text
Nginx
  -> smalldocs.service as smalldocs
       -> SmallDocs PostgreSQL database and role
       -> SmallDocs KMS identity and keys
       -> /var/lib/smalldocs

  -> smallcrm.service as smallcrm
       -> SmallCRM catalog and workspace SQLite files
       -> SmallCRM-only secrets and future KMS identity
       -> /var/lib/smallcrm
```

- [ ] Give each service a non-login Linux user and restrictive umask.
- [ ] Keep code deployment separate from both runtime identities.
- [ ] Prevent each service from reading the other's data, environment, backups, logs, or credentials.
- [ ] Use separate systemd units with explicit writable paths, memory limits, restart policy, and no core dumps.
- [ ] Bind both Node processes to loopback and expose only Nginx, SSH, HTTP, and HTTPS through the firewall.
- [ ] Keep SmallDocs PostgreSQL and SmallCRM SQLite backups in separate archives and object-store prefixes.
- [ ] Do not share KMS keys, IAM credentials, OAuth credentials, email credentials, or application secrets between products.
- [ ] Monitor CPU, RSS, event-loop delay, disk, backup duration, and request latency by service.

SmallCRM currently loads entire collections for some filters, facets, and views before applying response pagination. A larger combined VM does not remove that scaling limit. Load-test realistic collection sizes and improve those query paths before treating vertical scaling as the answer.

When the shared CX33 is no longer appropriate, move SmallCRM to a CX23 or larger VM while preserving its hostname. At current prices, a SmallDocs CX33 plus a SmallCRM CX23 costs less than one combined CX43 and creates a better failure boundary.

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

Decision: use AWS KMS in the `Odd Solutions Production` member account. It keeps encryption keys and off-site S3 backups under the same temporary-session administration model while separating them from the legacy management-account IAM user and bucket. SmallDocs and SmallCRM receive separate customer-managed keys, workload identities, policies, aliases, backup buckets, and encryption contexts. The official AWS SDK is asynchronous, so the current synchronous KMS boundary still requires refactoring before deployment.

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
| £5 Personal subscription | 27.5p | 3.5p | 2.5p | 33.5p | £4.665 |
| £8 one-person Team charge | 32p | 5.6p | 4p | 41.6p | £7.584 |
| £40 Team charge for five seats | 80p | 28p | 20p | £1.28 | £38.72 |

One combined Team subscription is cheaper than five separate £8 charges because the 20p card fee is charged once.

At 100 Personal customers and ten five-seat Teams:

```text
Monthly recurring revenue:                         £900.00
Estimated UK-card Payments fees:                   £35.50
Estimated Stripe Billing fees:                      £6.30
Estimated Stripe Tax Basic fees:                    £4.50
Estimated Stripe total:                            £46.30
Revenue after those Stripe fees:                  £853.70
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

- [ ] Create separate KMS keys for staging and production.
- [ ] Give them unambiguous aliases such as `alias/smalldocs-cloud-staging` and `alias/smalldocs-cloud-production`.
- [ ] Create a runtime identity with only the required `kms:Encrypt` and `kms:Decrypt` access to the production key.
- [ ] Keep key administration separate from the runtime identity.
- [ ] Enable CloudTrail visibility and alerts for denied or unusual decrypt operations.
- [ ] Do not put email addresses, filenames, document titles, or other customer data in the encryption context. AWS records the context in CloudTrail.
- [ ] Record the KMS region, key ARN, policy, and recovery owner in the operator runbook.

### Required engineering work

- [x] Refactor the current synchronous KMS boundary so the official network client can be awaited without blocking the Node event loop.
- [x] Integrate the official KMS SDK and set request timeouts.
- [x] Preserve the current authenticated encryption context: application, environment, purpose, resource ID, and key version.
- [x] Cache unwrapped data keys for a short, bounded period and clear them on eviction and normal server close. Signal-driven graceful shutdown remains an operations hardening task.
- [x] Fail closed when KMS is unavailable. Reads, search, and writes return a temporary service failure without falling back to a local key.
- [ ] Add integration tests against a real staging key for encrypt, decrypt, wrong context, disabled key, timeout, and rotated key reference.
- [ ] Leave `CLOUD_MASTER_KEY` unset in production.

Do not schedule deletion of an old KMS key. The current implementation does not rewrap old envelopes, so every key reference used by live data or retained backups must remain decryptable.

## 3. Create staging before production

- [ ] Create a hostname such as `cloud-staging.smalldocs.org`.
- [ ] Point DNS to a staging instance or isolated staging process and persistent data directory.
- [ ] Issue an HTTPS certificate.
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

- [ ] Add and verify a dedicated sending subdomain such as `mail.smalldocs.org`.
- [ ] Publish the provider's SPF and DKIM records.
- [ ] Start DMARC with reporting, verify every legitimate sender, then move to a stricter policy.
- [ ] Create a restricted production credential and a separate staging credential.
- [ ] Configure SMTP host `smtp.resend.com`, port `587`, username `resend`, and the API key as the password.
- [ ] Use a monitored From address on the verified domain.
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
- [ ] Create a monthly Personal Cloud product at the published £5 price.
- [ ] Create a monthly Team Cloud per-seat product at the published £8 price.
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
| Maximum file bytes | Decide | Decide |
| Revision retention days | Decide | Decide |
| Maximum projects | Decide | Decide |
| Maximum human members | `1` | Decide |
| Search requests and window | Decide | Decide |

Also decide:

- [ ] Failed-payment grace period, then read-only behavior.
- [ ] Number of latest revisions retained by the pruning job.
- [ ] Document and Team workspace restore window.
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
NOTIFY_SMTP_PASS=...

STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
STRIPE_API_VERSION=...
STRIPE_PERSONAL_PRICE_ID=price_...
STRIPE_TEAM_PRICE_ID=price_...

CLOUD_PLAN_LIMITS_JSON=...
CLOUD_PAYMENT_GRACE_MS=...
CLOUD_REVISION_KEEP_LATEST=...
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

- [ ] Treat the existing short-link SQLite database as live production data. Resolve its configured `SHORT_LINKS_DB` path on the old host before cutover.
- [ ] Migrate short links with a coordinated SQLite snapshot. Stop short-link writes briefly or use SQLite's online backup mechanism; do not copy only the main database file while WAL writes are active.
- [ ] Compare row counts and resolve representative existing `/s/...` URLs on the new host before changing DNS.
- [ ] Include `SHORT_LINKS_DB` in encrypted off-site backups and restore drills. A restored sample must return the same ciphertext for the same short-link ID.
- [ ] Choose a daily backup schedule and a retention period.
- [ ] Stop the application briefly for the supported coordinated snapshot, or implement a proper online SQLite backup for every database.
- [ ] Encrypt the archive and copy it to a different provider or failure domain.
- [ ] Record checksums, the deployed commit, database paths, `CLOUD_ENVIRONMENT`, and KMS key references with each backup.
- [ ] Back up the application secrets through the secret manager, not inside the database archive.
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
