# Cloud launch operations and pricing decisions

Last reviewed: 24 August 2026

This records the launch decisions for monitoring, backups, and pricing. It is an operator document. Customer-facing retention and price copy must agree with it.

## Monitoring at launch

SmallDocs will not use Healthchecks.io or another paid monitoring service for the first private beta.

The production host runs `smalldocs-monitor.timer` every five minutes. The monitor checks:

- The Node service answers on its loopback HTTP origin.
- The newest coordinated local backup is no more than 26 hours old.
- The filesystem holding service state and local backups is below 80 percent used.
- The Cloud job queue has no dead jobs, expired leases, or pending work older than 15 minutes.

A new incident sends one email through the existing Resend SMTP account. An unchanged incident sends a reminder every six hours. Recovery sends a second email. Alert output contains status, age, latency, percentages, and counts. It does not contain document content, titles, filenames, tags, search text, customer email addresses, authentication codes, tokens, cookies, request bodies, raw Stripe events, or KMS ciphertext.

The monitor itself runs on the production host. It cannot send an alert when the entire host, its network, DNS, or Resend is unavailable. This is an accepted private-beta limitation, not external availability monitoring. Review it after the first beta month or before making a public availability commitment, whichever comes first.

The system journal is persistent, compressed, and limited to 90 days by `60-smalldocs-journal-retention.conf`. A seven-day production sample was checked on 24 August 2026. Its 212 service lines contained no matched customer email address, authentication code, bearer or cookie value, provider key, document or search payload field, or payload-bearing URL. Repeat this content-free pattern check after enabling public Cloud and after changing request or error logging.

Provider consoles remain separate evidence sources:

- Stripe: webhook delivery failures, retries, subscription state, and seat quantity.
- Resend: delivery, bounce, complaint, and suppression state.
- AWS: KMS access errors and the S3 backup bucket.
- Hetzner: host state, firewall, and rescue access.
- systemd journal: application, monitor, backup, and timer failures.

The first operator is the company director. The alert recipient is stored outside the repository in root-owned `/etc/smalldocs/monitor.env`. Production deployments run `ops/install-production-monitor.sh`; it installs the journal policy and enables the timer only when that private configuration is present. On 24 August 2026, a controlled stale-backup drill sent an alert, restoring the 26-hour threshold sent a recovery message, and the timer returned to its normal five-minute schedule.

## Backup locations and retention

The production backup is a coordinated archive, not a live filesystem copy. The nightly timer starts at 03:17 UTC with up to 20 minutes of random delay. The backup process briefly stops SmallDocs, archives the complete `/var/lib/smalldocs` state tree and `/etc/smalldocs/smalldocs.env`, writes a SHA-256 checksum and release metadata, restarts SmallDocs, then uploads the archive and checksum.

### Local copy

- Location: `/var/backups/smalldocs/` on the Hetzner production VM.
- Purpose: fast operator recovery and a source for restore drills.
- Retention: 7 days.
- Deletion: after both S3 uploads succeed, the backup job removes matching local archives and checksum files older than 7 days.
- Limitation: this copy shares a host and disk with the service. It is not the disaster-recovery copy.

### Off-site copy

- Provider: Amazon S3 in `eu-central-1`.
- Bucket: `odd-solutions-smalldocs-prod-backups-732006412787`.
- Object path: `daily/YYYY/MM/DD/smalldocs-TIMESTAMP-COMMIT.tar.gz`, plus a checksum object.
- Encryption: S3 server-side encryption with the customer-managed KMS key `alias/smalldocs-backups-production`.
- Access: the production uploader can write and generate an encryption data key. It cannot list, retrieve, delete, or decrypt backups.
- Immutability: S3 Object Lock governance retention prevents object deletion for 30 days. Bucket versioning and public-access blocking are enabled.
- Retention: current versions expire after 30 days. S3 then removes the unlocked noncurrent version after at least 1 further day and removes the expired delete marker. Lifecycle execution is asynchronous, so an archive can remain for slightly longer than 31 days.

The AWS configuration was inspected on 24 August 2026. The bucket has versioning, KMS encryption, public-access blocking, 30-day governance retention, current-version expiry after 30 days, noncurrent-version expiry after 1 day, expired-delete-marker cleanup, and 7-day incomplete multipart cleanup. The latest object and its checksum were present, KMS-encrypted, and individually locked. Nightly server logs showed successful uploads on 22, 23, and 24 August.

### What a backup contains

The archive includes the encrypted Cloud databases, short-link ciphertext, service configuration required for recovery, billing and authentication state, jobs, audit events, feedback, analytics, and business-interest records. Cloud document values remain encrypted with their workspace and project data keys. The document KMS key is not exported into the archive. Recovery therefore requires the backup archive, its checksum, the application secrets, and continuing access to the production document KMS key.

The restore drill on 14 August 2026 verified the archive checksum and SQLite integrity. A separate production-key drill decrypted a current and historical Cloud revision with a fresh KMS client. There are no production Cloud customers yet, so the next restore drill must use launch-shaped test data rather than claim historical customer recovery.

## Pricing decision for launch

Keep the current launch model:

- Personal: one flat monthly subscription with 1 GB included.
- Team: charge per active human member, with 5 GB pooled storage.
- Connected machines and agents acting under a human identity do not create paid seats.
- Do not meter document count, agent count, searches, revisions, or tokens at launch.
- Keep the 10 MB maximum file size and current revision policy as safety limits.

This model charges for the durable access relationship the customer is buying: one person or a team of people who can read, edit, administer, and share documents. Agent processes can be numerous, short-lived, or moved between machines, so an agent is a poor billing unit. Markdown storage is small and cheap enough that usage-only billing would create unpredictable bills without closely following present service cost.

The included storage is substantial for text documents. Ignoring revision and database overhead, 1 GB holds about 50,000 documents averaging 20 KB, 10,000 averaging 100 KB, 1,000 averaging 1 MB, or 100 documents at the 10 MB maximum. The 5 GB Team pool holds about five times those counts. Actual capacity is lower because retained revisions, encryption envelopes, indexes, audit records, and database pages also use storage. Show storage used in Cloud settings before enforcing or selling an add-on.

Per-human pricing is also familiar in the current document-workspace market. [Notion Plus](https://www.notion.com/pricing) and [Slite Basic](https://slite.com/pricing) charge per member, and [GitBook](https://www.gitbook.com/pricing) combines a site fee with a per-user fee. SmallDocs does not need to copy their prices, but this supports keeping the billing unit understandable while the private beta measures what agent activity actually costs.

The operational data should still measure stored bytes, revision growth, search volume, KMS calls, notification volume, and unusually automated workloads without recording customer content. Review the model after the private beta.

If agent workloads become the main cost driver, add a mixed model instead of charging per agent:

1. Retain the human access subscription.
2. Include a pooled storage and automation allowance in each account.
3. Offer a clear storage or automation add-on only when measured usage shows a real cost boundary.
4. Give notice before imposing a paid usage tier. Do not create retrospective charges from an undefined fair-use rule.

The launch page can say that unusually high automated usage may be reviewed and that the customer will be contacted before limits or extra charges apply. It should not call an undisclosed threshold a fair-use policy.

## Review points

Review monitoring and pricing after the first month and then monthly during private beta. Record:

- backup duration, archive size, and restore time;
- disk, CPU, memory, HTTP latency, and job age;
- Stripe and Resend failures;
- stored bytes and revision growth by plan, using account identifiers rather than content;
- search and KMS operation counts;
- number of active human seats and connected machines;
- support load and any customer surprise about bills or limits.
