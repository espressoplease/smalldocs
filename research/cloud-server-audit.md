---
title: SmallDocs production server audit
tags:
  - cloud
  - operations
  - security
---

# SmallDocs production server audit

Audit date: 14 August 2026

This is a read-only assessment of the existing server before deploying SmallDocs Cloud. No packages, services, firewall rules, application files, databases, or credentials were changed during the audit.

## Recommendation

Use a clean Hetzner CX33 for the initial SmallDocs Cloud and SmallCRM production betas. Use the existing server for staging with test data only. The existing host has enough capacity, but its shared deployment identity is not an adequate boundary for customer documents, CRM records, or payment-related credentials.

Use:

- PostgreSQL 16 on the clean production VM for SmallDocs Cloud state.
- A managed KMS for wrapping project encryption keys.
- Encrypted, application-consistent PostgreSQL backups in a second provider.
- One application process per product until their persistence and concurrency behavior justify scaling them independently.
- The existing host as staging, with separate credentials and no customer data.

The two products initially share one VM failure boundary. They run under separate non-login users with separate data, secrets, credentials, service units, databases, and backups. Off-site backups protect recovery, but do not make either service highly available.

## Confirmed host state

| Area | Observed state | Assessment |
| --- | --- | --- |
| Operating system | Ubuntu 24.04.4 LTS | Supported |
| Capacity | 2 vCPUs, about 8 GB RAM | Enough for a limited beta |
| Root disk | About 75 GB usable, 53 GB free | Enough initially; add alerts |
| Uptime | 121 days | Reboot is overdue |
| Updates | Unattended upgrades enabled; reboot required for kernel and libc updates | Schedule a controlled reboot |
| Public services | SSH, HTTP, and HTTPS reachable externally | Expected |
| Application ports | Several Node ports bind on all interfaces, but external probes were blocked | Provider firewall helps; bind SmallDocs to loopback as defense in depth |
| PostgreSQL | PostgreSQL 16.14, bound to loopback only, SSL on, SCRAM password encryption | Suitable for the beta |
| PostgreSQL capacity | About 174 MB across existing databases, 6 active connections when checked | Lightly used |
| TLS | Let's Encrypt certificate valid; TLS 1.2 and 1.3 accepted | Good |
| Backups | No SmallDocs or general PostgreSQL off-site backup was found | Launch blocker |
| Disk encryption | No guest-visible full-disk encryption was found | Protect customer content in the app and encrypt backup archives |
| Service isolation | SmallDocs runs as `deploy` with almost no systemd sandboxing | Harden before customer data |

## Why production should not share this host

The `deploy` account runs SmallDocs and several neighboring applications. It owns application source, mutable databases, SSH private keys, and runtime secrets. Its allowed administrative commands provide broad routes to root and PostgreSQL superuser access.

An application compromise on this account is therefore not confined to one service. It could expose other applications, change deployed source, obtain runtime credentials, and reach every local database. Creating a separate `smalldocs` user would improve file permissions, but the existing shared `deploy` account and its applications would still retain a route around that boundary.

It is possible to redesign deployment and privilege separation across the whole existing host. That is more work and carries more regression risk than creating a clean production VM for the two intentionally isolated product services. The existing host is still useful for staging because staging must not contain customer data or production credentials.

## Required before a paid beta

### 1. Patch and reboot the server

The running kernel is older than the installed security update and the server reports that a reboot is required. Take a provider snapshot or verified database backup first, confirm the current service health, apply the remaining updates, reboot, then verify every hosted application.

This is a controlled maintenance event. It should have a rollback and a short maintenance window because the host runs several services.

### 2. Fix the SmallDocs reverse proxy boundary

The SmallDocs Nginx site currently appends the incoming `X-Forwarded-For` value:

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Cloud source-address rate limiting trusts a configured proxy. With the current rule, a client can supply the leftmost address and influence the value the application sees. For this single trusted proxy, overwrite it instead:

```nginx
proxy_set_header X-Forwarded-For $remote_addr;
```

Set `TRUST_PROXY=1` only after this change. Test the effective client address through Nginx and confirm that direct access to the Node port is unavailable.

The current Nginx access log also records the full request URI. Use a Cloud-safe log format or targeted logging rules before OAuth callbacks, invitation links, or CLI authorization endpoints go live. Query parameters and sensitive path values must not persist in access logs.

### 3. Set the request size deliberately

Nginx has no SmallDocs-specific `client_max_body_size`, so its normal 1 MB default is smaller than the Cloud API's current document request allowance. Set an explicit value with enough room for the published maximum document plus JSON and encoding overhead. Keep the application limit as the authoritative check.

### 4. Move runtime data outside the Git checkout

The deployed checkout currently contains live SQLite databases and WAL files. This makes deploys and backups fragile. Before Cloud deployment, move all runtime databases and mutable state into owned directories such as:

```text
/var/lib/smalldocs/
/var/log/smalldocs/        if file logs are later required
```

Use restrictive ownership and permissions. The application checkout should contain deployable code, not customer state.

### 5. Add systemd isolation

The current service can see the deploy user's home and has no meaningful filesystem, privilege, temporary-directory, or resource isolation. Add restrictions in stages, testing after each stage. The final policy should provide only the directories, network access, and capabilities the application needs.

Likely settings include `NoNewPrivileges`, a private temporary directory, a read-only application tree, an explicit writable state directory, a restrictive umask, and memory limits. The exact unit must be tested against email, KMS, PostgreSQL, and static asset behavior before production.

Run SmallDocs and SmallCRM under different dedicated service users with no shell login, SSH keys, GitHub deploy token, broad `sudo`, or access to each other. Separate code deployment from both runtime identities.

### 6. Create PostgreSQL roles and database

Create a dedicated database and non-superuser role for SmallDocs Cloud. Do not reuse `deploy`, `postgres`, or another application's role. The runtime role should connect only to its database and should not create roles or databases.

Use a separate migration role if schema ownership and runtime permissions are split. Store the runtime connection secret in a root-owned systemd environment file, not in Git or a shell profile.

### 7. Build and test off-site backups

Create a scheduled `pg_dump` of the SmallDocs database, encrypt the archive before upload, and send it to an object store outside Hetzner. Retain daily and weekly generations and alert when a backup or upload fails.

A backup is not accepted until a restore drill has:

1. Created a clean temporary PostgreSQL database.
2. Restored the archive.
3. Started the matching application version against it.
4. Used the retained KMS key to decrypt representative documents and revisions.
5. Recorded the recovery time and any manual steps.

Do not log database passwords, customer content, query text, document titles, or encryption material from the backup job.

### 8. Use managed key wrapping

Do not operate a new Vault cluster for the first beta. A self-hosted Vault service adds another security-critical database, unseal process, backup process, upgrade path, and outage mode.

Use AWS KMS or Google Cloud KMS to wrap project data-encryption keys. The application can cache unwrapped data keys briefly in bounded process memory. It must fail closed when KMS is unavailable and must never fall back to a local production master key.

The existing Cloud KMS adapter is synchronous while official provider clients are asynchronous. Refactor and test that boundary before real customer documents are accepted.

### 9. Reduce credential exposure

The deploy account contains more than one private SSH key. Establish which services still need each key, then remove or relocate unused credentials through a recoverable rotation process. Do not delete a key until its dependency and replacement have been verified.

Review root login policy, the effective SSH configuration, firewall rules, and intrusion controls with administrative access. The read-only deploy account could not confirm all of these settings.

The readable SSH configuration disables password and keyboard-interactive login. Root key login was not explicitly disabled, X11 forwarding was enabled, fail2ban was not installed, and the host firewall rules were not fully inspectable from the audit account. Verify and tighten these on the new production VM while retaining provider-console recovery access.

### 10. Redact operational telemetry

The current version check writes browser user agent, full referrer, language, and version metadata to the journal when analytics is enabled. Before Cloud launch, verify that no Cloud endpoint, authentication callback, search query, document title, document body, token, or email code enters access logs, journals, traces, analytics, or error reports.

## PostgreSQL decision

Moving the Cloud stores to PostgreSQL now has no additional provider cost and avoids migrating customer data later. It also creates one transactional system for authentication, workspaces, documents, billing, OAuth, and jobs.

The cost is engineering time. The current implementation uses synchronous `better-sqlite3` stores, so this is a real adapter and transaction refactor, not a connection-string change. PostgreSQL on the same host improves database concurrency and operations but does not improve availability.

Recommended decision: migrate the Cloud implementation to PostgreSQL before the first paid beta and deploy it on the clean CX33. SmallCRM can initially retain its isolated per-workspace SQLite layout. Keep the Cloud SQLite implementation available for tests until PostgreSQL behavior has equivalent tenant, concurrency, idempotency, and restore coverage.

## Proposed order of work

1. Approve one clean CX33 for both early production betas, PostgreSQL for SmallDocs, isolated SQLite for SmallCRM, managed KMS, and off-site object backup as the initial topology.
2. Back up, patch, and reboot the existing host, then use it as staging with test credentials and test data.
3. Provision the production VM with separate SmallDocs and SmallCRM runtime identities, PostgreSQL, Nginx, and restricted network access.
4. Fix the Nginx trusted-proxy, access-log, request-size, and HTTPS configuration in staging and production.
5. Create the dedicated PostgreSQL roles/database and runtime state directories.
6. Migrate the Cloud persistence and KMS boundary in the application with tests.
7. Configure encrypted off-site backups and complete a restore drill.
8. Apply and verify systemd hardening.
9. Configure staging OAuth, email, Stripe test mode, and KMS.
10. Run the launch test matrix and a small invited beta.

## Decisions needed from the owner

- Approve one Hetzner CX33 for both early production betas and the existing host as staging. At the current Germany and Finland price, the server, one IPv4 address, and Hetzner's seven-slot backup option total about €10.69 per month before VAT.
- Approve PostgreSQL for SmallDocs and isolated SQLite for SmallCRM on the clean production VM.
- Choose AWS KMS plus S3, or Google Cloud KMS plus a separate object store.
- Choose a maintenance window for the server update and reboot.
