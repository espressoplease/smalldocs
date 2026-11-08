# Cloud-first production release

Migration and billing checked 3 November 2026. Evidence: [release receipt](qa/release/2026-11-03.json).
Release readiness, npm access and live configuration checked 8 November 2026.
Production application code, environment and service configuration remain unchanged.
Live Stripe catalogue and webhook preparation was authorized and completed separately.
The checks below authorize no production deployment or npm publication.

## Completed

- Downloaded the latest coordinated production archive from S3. Its SHA-256
  matched the existing local archive and checksum receipt.
- Restored all 11 SQLite databases into a root-private rehearsal directory.
  Integrity and foreign-key checks passed.
- Opened the Cloud data with the deployed release, then ran the candidate's
  auth, OAuth, billing, content, jobs, single-plan, referral and publication
  migrations on copies. No server or background delivery worker was started.
- Compared existing users, identities, sessions, subscriptions, library
  memberships, document records and original trial deadlines. Existing records
  and decrypted document digests were preserved. The archive contains 188
  documents and 298 revisions. All 940 user/document access decisions matched.
- Resolved the existing owner's two libraries into one billing account without
  subscription conflicts. There are no active Stripe subscriptions. The app
  database contains one active manual subscription and one canceled Stripe row.
- Opened the migrated content using the previous release. Restored fresh backup
  copies and repeated the previous-release read. Both passed with cold key caches.
- Verified the staging restricted Stripe key can read prices and invoices,
  create coupons and update draft invoices. Checked the registered staging
  webhook includes subscription events, invoice.created, invoice.paid,
  invoice.voided, invoice.deleted and checkout.session.expired.
- Repeated actual sandbox invoice checks: ten USD seats with one credit cost
  $45, five seats with five credits cost $0, one GBP seat with one credit costs
  GBP 0, and adding a credit to a draft ten-seat renewal reduces it to $45.
- Used that application credential through an isolated running application to
  attribute a verified signup, connect a CLI, save a tagged document, award an
  activation credit and attach it to real sandbox Checkout. Retried Checkout
  reused its session. Signed expiry-webhook replay, duplicate delivery and
  re-creation of an expired Checkout preserved the unspent credit. Webhook replay
  used a fixture signing secret; it was not a completed hosted-card Checkout.
  All Stripe fixtures were cleaned up. No real customer was charged.
- Built the dependency-free 1.20.0 npm tarball and unpacked it into a fresh home.
  Cloud setup installed a production-origin skill with tagging guidance. Edit,
  comment and Account settings commands loaded from the package.
- Added the production compiler unit and deployment wiring. It uses a separate
  user, socket and cache from staging, without application secrets or databases.
  Systemd validation passed on the VM. Sandbox deployment tests cover promoting
  an existing staged release, compiler startup failure and application health
  failure. Failed promotions restore the previous release and unit files.
- Prepared the live SmallDocs standard monthly price: GBP 4 and EUR 5 inclusive
  of tax, USD 5 exclusive. The live product uses tax_code=txcd_10103000.
  Product: prod_VYtNvG0I1bCWMs. Price: price_1UXlb30bIITqEUvtb3MW00ii.
  The existing Personal and Team catalogue entries remain available until cutover.
- Extended the existing live webhook with invoice.created, invoice.paid,
  invoice.voided, invoice.deleted and checkout.session.expired. Preserved the
  subscription events, signing secret and API version. The currently deployed
  application acknowledges the added events without applying referral changes.
- Verified the actual restricted live application key can read the price,
  create multi-currency referral coupons, create and expire Checkout, and
  read and update draft invoices. Deleted the empty draft invoice, fixture
  customer and unused coupons. No Checkout payment or invoice finalization
  occurred. Portal cancellation, payment-method changes and invoice history
  remain enabled. Evidence: [live Stripe receipt](qa/release/2026-11-03-live-stripe.json).
- Confirmed live Checkout already inherits managed_payments.enabled=true.
  Joshua confirmed on 3 November 2026 that Managed Payments should remain enabled
  for launch. With Managed Payments, Stripe is the merchant
  of record and handles indirect tax compliance, disputes and payment support.
  Preserve the existing account setting at cutover.
  [Stripe Managed Payments](https://docs.stripe.com/payments/managed-payments).
- Removed the temporary production-data rehearsal directory after retrieving
  its original verification receipt. Staging deployment of the checklist work
  succeeded. The later sidebar change passed 12 headless browser checks and a
  production-mode service-worker refresh check.

## Latest release audit, 8 November 2026

Evidence: [release audit](qa/release/2026-11-08.json).

- Production remains on e5c705b24e8537dd5b2041fc3eb11801928af375;
  staging serves de7bf67de7654662d480725bfa6c975b0e8de607.
- The initial Node test run passed 2,320 checks and failed one: the SDK reader
  snapshot source-hash mismatch. That SDK product has since been retired at
  Joshua's request; the follow-up checks below pass.
- The selected browser journeys passed all 27 checks after updating two stale
  test expectations: the Feedback sidebar entry and a reason on the second
  Cloud save. These cover email signup and CLI authorization, referral signup
  through Google and email, trial/subscription pages, and recovery paths. The
  OAuth provider and email delivery are isolated fixtures in these tests.
- Production Google sign-in is not configured. Its OAuth start endpoint returns
  503 provider_not_configured, and the running process has neither Google
  credential. Staging redirects successfully to accounts.google.com.
- npm authentication returns 401. The public latest CLI remains 1.19.2;
  the candidate package is 1.20.0. No package was published.
- A read with the actual production Stripe application credential confirmed
  the standard monthly price is live and active, with the expected currencies.
  Separate read-only live CLI checks confirmed the webhook is enabled with the
  required events, the billing portal permits end-of-period cancellation,
  payment-method changes and invoice history, and there are zero active Stripe
  subscriptions. The user's Stripe CLI context was not changed.
- Today's production backup and the latest monitor run both succeeded. There
  are no failed systemd units, overdue jobs or dead jobs. The 128 queued jobs
  are scheduled for future dates. Production's single-plan flag, standard price
  and feedback administrator allowlist are not configured yet.
- No production application/configuration changes, charges or customer emails
  were made by this audit. A completed hosted-card Checkout followed by real
  webhook delivery and paid access remains a final provider-flow check; the
  earlier API and fixture checks are not a substitute for that browser journey.

## SDK retirement, 8 November 2026

Joshua chose to retire the unused external Renderer SDK. Its versioned assets,
integration demos, iframe embed endpoint, dedicated integration skills, snapshot
builders and SDK comparison tests are removed. The application's renderer,
Cloud-first CLI skill and rich document features remain. The 12 authoring
references now live in public/authoring and use the normal document reader at
their existing /developers/authoring URLs.

- The complete Node suite passes all 2,290 checks.
- All 35 selected browser checks pass, covering authoring pages, rich public
  rendering, public link lifecycle, compiler isolation and theme behaviour.
- A production-mode service-worker upgrade from the previous commit preserves
  an existing document and working copy controls. Retired SDK routes return
  404; the canonical Cloud skill and authoring references remain available.
- Copy review found no remaining SDK integration promises in the edited public
  copy or retained examples. Production and staging have not been deployed
  with the retirement yet. SDK consistency is no longer a launch task.

## Homepage preparation

- [ ] Joshua: record a new homepage video for the Cloud-first experience.
- [ ] Replace the temporary 30-second clip, poster, preview and captions with the
  new recording. Add chapter times if the recording has multiple sections.
- The old and new homepages now share their player controls, captions and
  fullscreen code. The new homepage keeps a compact muted preview and expands
  in place to the text column width, keeping its top-left corner fixed. It
  returns to the compact preview when collapsed. Playback controls sit in a
  right-aligned row below the video frame, including in fullscreen playback.
  `test/homepage-video.spec.js` passed 36 Chromium, Firefox and WebKit checks,
  including geometry throughout the animation, blocked autoplay, captions,
  retrying a failed load, keyboard navigation and replay.
  Another 43 Chromium checks cover the homepage, signup and routing.

## Launch actions still pending

1. Obtain release approval. Current production remains on e5c705b24e8537dd5b2041fc3eb11801928af375.
2. Configure production Google OAuth credentials and the production callback
   https://smalldocs.org/api/cloud/auth/oauth/google/callback. Verify an actual
   sign-in on the production origin, including the existing account-linking flow.
   Staging OAuth configuration alone does not enable production sign-in.
3. At the approved cutover, set CLOUD_SINGLE_PLAN_ENABLED=1 and
   STRIPE_STANDARD_PRICE_ID=price_1UXlb30bIITqEUvtb3MW00ii for production.
   Preserve auth, cursor and idempotency secrets, database paths and KMS context.
   The live application key's required billing operations have been verified.
   Repeat that check if its credential or permissions change before launch.
   Configure CLOUD_FEEDBACK_ADMIN_USER_IDS using the intended verified
   production account ID. Resolve it in the production authentication database;
   do not copy a staging ID. An unset value leaves the private inbox inaccessible.
4. Recheck live webhook delivery after cutover. The required event selection is
   already installed; preserve the signing secret and working portal configuration.
5. Deploy the approved server release with ops/deploy-production.sh. This now
   provisions the production compiler, reuses an already-built immutable staged
   release and rolls back an unsuccessful application or compiler start.
6. Authenticate npm and publish the reviewed CLI package, then tag its matching
   source version. Deploy the matching backend before distributing the CLI.
   Production /install currently resolves npm latest, which remains 1.19.2.
   On 8 November, `npm whoami` returned 401. An npm login or authorized publish
   credential is still needed. No package has been published by this check.
7. Complete one hosted sandbox Checkout through its browser UI and verify the
   resulting webhook grants paid access. Then run a short check on the
   production origin: Google and email sign-in, return
   to the last library, CLI authorization, tagged save/read/edit, member access,
   Checkout and billing portal links, public publish/update/withdraw, and logout.
   Verify production public pages are indexable and staging remains noindex.
   Include the new feedback form and administrator inbox in the access checks.
8. Check the production monitor, backup and compiler services, Stripe delivery
   failures, and any queued/dead jobs. A successful root-page request alone does
   not prove publishing or billing works.

Refunds and disputes currently need manual referral-credit reconciliation.
Review the referral ledger and applied discount before making an adjustment.
The application does not automatically reclaim a reward or charge another user.

## Repeat the recovery rehearsal

Use a coordinated archive that includes var/lib/smalldocs, the matching
etc/smalldocs/smalldocs.env and metadata.txt. Extract it into a private directory.
Use the AWS recovery identity or the matching deployment's KMS decrypt identity.
Keep AWS credentials out of reports and outside the extracted archive.

```sh
node ops/rehearse-cloud-migration.js \
  --snapshot-root /private/rehearsal/restored \
  --previous-release /opt/smalldocs/releases/RELEASE_FROM_BACKUP \
  --work-dir /private/rehearsal/work \
  --report /private/rehearsal/report.json
```

The script creates working copies, runs constructors and resolves library
billing mappings without HTTP servers, Stripe clients, email clients or job
workers. It checks access decisions and decrypts revisions in memory, returning
counts and hashes. It removes its working copies after success or failure.
The original archive and extracted snapshot are not migrated.

The rollback check applies to the current key versions. After a project-key
rotation, an older reader that assumes version 1 is not a valid code-only
rollback. See [key rotation and recovery](cloud-key-rotation-and-recovery.md).
Restoring an older archive also loses writes made after that archive; take a
coordinated launch backup before the approved cutover.

Repeat the real provider contract checks with a sandbox-authorized Stripe CLI:

```sh
SDOCS_STRIPE_APPLICATION_KEY_FILE=/private/staging-restricted-key \
  node scripts/check-referral-stripe-sandbox.js
```

Fixture creation and cleanup use the sandbox CLI. Application operations use
the supplied restricted key. The receipt distinguishes that from a CLI-only run.
