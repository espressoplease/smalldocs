# Signup totals and private product overview

## Pages and access

- `/analytics` includes public signup totals and the existing visit analytics.
- `/analytics/signups` returns the same public counts as JSON when `ANALYTICS_ENABLED=1`.
- `/cloud/overview` is the private product overview. Account settings show a link under Account > Administration for permitted readers.
- `GET /api/cloud/v1/admin/status` reports whether the signed-in account can view the overview and feedback inbox.
- `GET /api/cloud/v1/admin/overview` returns aggregate setup and subscription figures for permitted administrators. Browser sessions and existing Cloud CLI bearer credentials use the same authorization checks.
- `GET /api/cloud/v1/admin/users` lists up to 50 retained accounts with their verified email addresses, signup dates, account status and profile completion. `?after=CURSOR` continues the list. Linked addresses are deduplicated within an account. Accounts whose identities were removed show no retained email address. This endpoint uses the same administrator permission as the overview, without a shared or per-user response cache.

Account rows also expose `agent_connected` and `document_created` using the same historical progress queries as the aggregate reports. Subscription fields distinguish `subscribed` (the person's own active, confirmed Stripe subscription), `paid_coverage` (including sponsored seats) and `manual_access` (active operator-provisioned free coverage). Disabled accounts have no current paid or manual coverage. The interface labels these as Subscribed, Sponsored, Free access or Not paid. Billing fields are null and display Not available when billing is not configured. These observations do not grant or modify access.

Configure `CLOUD_ANALYTICS_ADMIN_USER_IDS` with a comma-separated list of stable Cloud user IDs in the server environment, not email addresses or source-code defaults. Resolve each intended administrator through their verified identity before configuring the ID. When this variable is unset, the overview uses `CLOUD_FEEDBACK_ADMIN_USER_IDS`, so existing feedback administrators can use it. An explicitly empty value grants nobody overview access. Overview access does not grant feedback inbox access. Library ownership and library administration do not grant either permission.

The server authorizes both the page and every private API request, and rechecks the authenticated identity after producing private aggregates. An unauthenticated page request redirects to sign-in with a return path. An unauthenticated API request returns 401. Signed-in accounts outside the allowlist receive 404. Current Terms acceptance is required, as for the existing feedback inbox. Private responses use `Cache-Control: no-store`. The page clears displayed figures on history navigation and rechecks access on focus and history restoration. A restricted HTML template lives in `templates/`, outside public assets and the public trust manifest.

## Public figures

The public response contains only `available`, `generated_at`, `timezone`, `summary` and `daily`. `summary` contains the total retained accounts, accounts created today, and accounts created within the last 7 and 30 calendar days. The daily series covers 90 dates, including dates with zero signups. Days use UTC, matching existing analytics. The current day is partial. The last 7 days include today and the preceding 6 days; the last 30 days include today and the preceding 29 days.

Each account is counted from `cloud_auth_users.created_at_ms`. A verified Google or email sign-in creates the account. Profile completion, Terms acceptance, library provisioning and CLI authorization are separate stages. Repeated sign-ins, linked identities and additional libraries do not add to the signup count. Disabled accounts remain in these totals; permanently removed account rows do not. These are retained account counts, not a permanent event ledger or an estimate of unique humans.

The public endpoint never returns an email address, name, user ID, IP address, authentication provider breakdown, document metadata or billing figures. It does not support per-account filters or arbitrary grouping. These are aggregate statistics, not anonymized account exports. Daily counts on a small service can still be correlated with information someone already knows about a signup. Publication of these totals is intentional; identifying details remain private.

The existing visit database stays separate. Signup counting does not add an identifier to visit tracking or connect a browser's visit history to an account. If Cloud authentication is unavailable, signup figures report `available: false` rather than zero accounts.

## Private figures

The overview summary endpoint returns counts. The private page loads its account list separately, with Previous and Next navigation. Emails render as plain text, without HTML interpretation, and are cleared together with the aggregate figures when access is lost or the page enters browser history. Nothing is stored in browser local storage. Public analytics and the aggregate caches do not receive these account rows.

The summary measures are:

- Account created: retained account records, including disabled accounts.
- Profile completed: first and last names are supplied.
- Ready to use: enabled account, completed profile, current Terms accepted, and active membership in a non-deleted library with a non-deleted project. This measures setup completion, not current billing entitlement or access to every document.
- Agent authorized at least once: an issued CLI credential, including a connection later revoked. Multiple machines count once. This does not claim the agent has created a document or installed a particular skill version.
- Document created: a document activation record or retained authored document metadata. Multiple documents count once. Activation records preserve the stage after document deletion where retained.
- On paid subscription: enabled accounts covered by an active Stripe subscription whose access has been activated and whose initial payment is not pending. Owners and sponsored members count once across libraries. Removed or disabled memberships do not confer sponsored coverage. Manual access, trials and past-due subscriptions do not count as active paid coverage.

The signup-date table groups accounts by their original creation date and shows their progress now. An agent authorization or payment next week appears against that account's signup date, not the date of the action. Stages can overlap and are not a strictly ordered conversion funnel.

Billing measures include all recorded personal trial starts, active Stripe subscriptions, billed seats, initial payment confirmation pending, past-due subscriptions and canceled subscriptions. Trial starts are historical counts, not a count of currently unpaid people. Seat quantities come from the latest stored billing state; they are not summed as unique people or converted into estimated revenue. A pending initial payment can also be past due. Local figures depend on processing Stripe events and do not query Stripe during page loading. Billing measures are unavailable when the single-plan model is not configured.

Personal and team library counts exclude deleted libraries. Content titles, tags, source paths, document bodies, revisions and encryption keys are never read or decrypted for these reports.

## Storage and load

The feature adds no analytics events, identifying hashes, database schema or migrations. It reads metadata from the configured authentication, content and billing SQLite databases on the same deployment. It does not read the legacy visit database for signup counts or combine staging accounts with production accounts.

A dedicated read-only connection uses `PRAGMA query_only=ON`, including its attached content and billing databases. Fixed SQL aggregates and deduplicates in SQLite. The response is bounded to summary counts and 90 daily rows. Public and private aggregates are cached independently in process for up to 60 seconds, invalidated at UTC midnight and on clock rollback. There is no per-account result cache. Private authorization is checked before every cache lookup. Public HTTP caching also lasts up to 60 seconds, so an intermediary can extend visible staleness to approximately two minutes. Refresh does not force an expensive recount. Failures do not return fabricated zero counts.

## Validation

`test/test-cloud-product-analytics.js` verifies counting boundaries, zero-filled dates, linked identities, disabled and future-dated accounts, cache expiry, midnight rollover, private cache authorization, setup progress, sponsored coverage deduplication, pending payments, manual access, and enforced read-only database connections.

`test/cloud-product-analytics.spec.js` exercises the real server with isolated databases: anonymous access, other-account and other-company denial, ordinary library owners, explicit and inherited admin configuration, revoked sessions and CLI credentials, deployment isolation, public response field projection, hidden templates, account settings navigation, loading and error states, browser history restoration, and desktop/mobile light and dark views. Existing feedback tests cover the unchanged feedback access boundary.

Local validation on 10 November 2026 passed 2,342 Node tests and 34 Chromium browser tests across the product analytics, feedback and existing analytics source views. The metadata-scale case used 5,000 accounts and 100,000 document rows and returned less than 20 KB of aggregate JSON. Narrow-screen coverage uses Chromium at 390 pixels, rather than a physical iOS device. Copy review checked metric definitions and the public privacy explanation.

Account-list checks also cover linked addresses, removed identities, disabled accounts, stable pagination, immediate email updates without caching, HTML-shaped input rendered as text, and removal of visible emails after access loss.

`test/cloud-trial-integrity.spec.js` checks new and historical setup, preservation of manual access, unchanged deadlines after repeat sign-ins and new libraries, browser/API and CLI paywall enforcement, and the current policy for distinct verified email aliases. It also reproduces an alias qualifying for the pre-payment referral activation reward in isolated data. Trial eligibility and referral reward rules are unchanged by the admin table.

Account progress validation on 11 November 2026 passed 2,343 Node tests and 30 Chromium tests across the product overview, single-plan flows and trial integrity. The browser run allowed 45 seconds per test to accommodate fixture server shutdown; no application timeout was changed.
