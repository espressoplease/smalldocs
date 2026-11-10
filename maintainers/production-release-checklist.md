# Cloud-first production release

Released to production on 9 November 2026 with Joshua's approval. Production
and staging serve d55bb439c82c0879bf189b20b9167d221e34c42e. CLI 1.20.0 is
published on npm with its matching v1.20.0 source tag and provenance.
Evidence: [production cutover receipt](qa/release/2026-11-09-production.json).

The dated preparation sections below are historical records. Migration and
billing were rehearsed on 3 November; release readiness and inactive live
configuration were checked on 8 November. The following launch section records
the completed cutover and the limits of its verification.

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
  copy or retained examples. Staging now serves retirement commit
  c81f0f2836128a74a74548012a22c98e47ea1357. Production remains unchanged.
  SDK consistency is no longer a launch task.
- External staging checks confirm the SDK and developer portal return 404,
  authoring references return 200, and Google sign-in still redirects to Google.
  Headless browser checks confirm the authoring reader and an existing public
  page render with working document actions, four slides, no page errors and no
  SDK requests. Application and staging compiler services are active.

## Production Google OAuth preparation, 8 November 2026

Evidence: [staging and OAuth receipt](qa/release/2026-11-08-staging-oauth.json).

- Created the separate Google project smalldocs-production-2026. The existing
  smalldocs-auth-2026 project and staging client are unchanged. Google recommends
  separate projects for testing and production; the existing staging client also
  contains localhost and production callbacks and is not used for this cutover.
- Created Web application client "SmallDocs production web":
  578646928115-p0b7sevfohv2u2ogemrs7qe5r3emrad6.apps.googleusercontent.com.
  Its only redirect URI is
  https://smalldocs.org/api/cloud/auth/oauth/google/callback.
  No JavaScript origins are configured because the application uses server-side
  authorization-code exchange with PKCE.
- Joshua approved accepting the Google API Services User Data Policy and
  creating the production client. The OAuth audience is External and its
  publishing status is In production. This publishes the Google configuration,
  not the SmallDocs application release.
- Configured only openid, userinfo.email and userinfo.profile. Google states
  that data-access verification is not required for these non-sensitive scopes.
  No Gmail, Drive or Calendar access is requested.
- Saved the SmallDocs app name, support/developer contact, smalldocs.org domain,
  https://smalldocs.org/home, /privacy and /legal links. All three public pages
  return 200. Google currently displays smalldocs.org in its account chooser;
  custom branding is not verified or shown. No logo was uploaded.
- A browser request with the production client, exact callback and actual
  application scope set reached Google's normal account chooser, with the
  correct privacy and terms links. It did not complete account consent or
  exchange a code, create a SmallDocs session or modify a production identity.
- Downloaded the new credential, validated its project/client/callback and
  stored its two environment values at
  /etc/smalldocs/google-oauth.prepared.env on the VM, owned by root with mode
  0600. Removed the downloaded local JSON. No secret is in source control or
  this receipt. The running production service does not load the prepared file.
- At the approved cutover, merge the prepared values into the root-only live
  /etc/smalldocs/smalldocs.env without replacing other settings. Then deploy and
  restart the approved release. The coordinated backup includes the live env;
  the separate prepared file is not included until its values are activated.
  Verify the real Google callback and existing-email account-linking journey,
  then remove the redundant prepared file. The production OAuth start endpoint
  intentionally still returns provider_not_configured before activation.

References: [Google production OAuth policies](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)
and [Web-server OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server).

## Hosted Stripe checkout and npm access, 8 November 2026

Evidence: [hosted Checkout receipt](qa/release/2026-11-08-hosted-checkout.json).

- Created two disposable staging identities, with a referral attributed through
  the application's referral model. Onboarding, CLI authorization and tagged
  document creation used the running staging application's normal API routes.
  This provider check does not claim to test email or Google identity proof.
- The referred account had trial access and received its extra referral month.
  Connecting the CLI and saving a tagged document awarded the referrer one
  person-month before payment.
- Completed the hosted Stripe sandbox Checkout in Chrome using Stripe's
  published UK Visa test card and disposable billing details. The existing
  standard price charged GBP 4.00 in test mode. No real funds moved.
- The registered Stripe webhook activated the referred account's paid access,
  cleared its pending-payment state and awarded two additional referral months,
  for three total. The referral ledger's paid invoice matched the actual paid
  invoice. Authenticated document reads and a new tagged save then succeeded.
- The browser's return page used a different existing staging login. This check
  verifies the fixture's paid account through its API, not the signed-in return
  page. Include the same-account browser return in the production smoke check.
- Created the billing portal link, canceled the disposable subscription and
  verified that the real cancellation webhook updated the application. Removed
  the test Stripe customer, soft-deleted its documents, revoked fixture sessions
  and CLI access, and disabled both fixture identities. Customer deletion used
  an isolated sandbox administration CLI context; the application's restricted
  credential was not broadened. The user's Stripe CLI context is unchanged.
- Joshua completed npm web authentication. `npm whoami` now returns sdocs-dev,
  the existing package maintainer. The registry still serves 1.19.2; nothing has
  been published. Actual releases use .github/workflows/publish-npm.yml with
  GitHub trusted-publisher OIDC and provenance, not a local npm token. The login
  verifies administration access but is not required for that OIDC publishing
  path. The workflow dry run below has now passed.

## Package workflow and inactive cutover configuration, 8 November 2026

Evidence: [package and configuration receipt](qa/release/2026-11-08-package-readiness.json).

- GitHub Actions run [42531293225](https://github.com/espressoplease/smalldocs/actions/runs/42531293225)
  completed successfully at commit 14a5043fd1316917adebd16e0a431f155b7f2507.
  Node 24, npm 11 and all 2,280 reported Linux Node checks passed. The earlier
  macOS SDK-retirement run reported 2,290 checks. These are separate run totals.
- The workflow ran npm publish with --provenance --access public --dry-run.
  Its 1.20.0 tarball contains 60 files, 284.0 kB packed and 948.1 kB unpacked,
  with SHA-1 454ff0ee57c077094d55ad2437825a1a9e65ce99. A dry run verifies
  tests and packaging, but does not prove the registry will accept a real OIDC
  publication or issue its provenance attestation. Verify both after release.
  npm latest remains 1.19.2; no package or release tag has been published.
- Prepared /etc/smalldocs/cloud-first.prepared.env on the VM, owned by root
  with mode 0600. It enables the single plan, selects the verified live standard
  price and allowlists the verified production owner for the feedback inbox.
  The production user ID was resolved from the production authentication
  database, not copied from staging. This file is not loaded by the running
  service. The active environment and production release remain unchanged.
- Both prepared files have been checked for ownership, permissions, required
  fields and non-empty values without printing their secrets. At cutover,
  merge their values into the existing live environment, preserving every other
  setting. A rollback must restore the coordinated environment as well as code;
  ops/deploy-production.sh only rolls back code and service-unit changes.
- The exact production Cloud skill v54 is available for the explicit copy
  approval required by AGENTS.md. The review document is
  https://cloud-staging.smalldocs.org/docs?cloud-document=e216454f-0d2e-4dc0-88ab-1ac20c89558a.
  Its source SHA-256 is
  046f9323b45663f425960bd304dc38543f5b99163a77e18398560e504e3a9d80.
  The v54 wording supersedes the earlier v53 review. All 96 targeted skill and
  installation checks pass. Joshua approved the final skill wording and
  production launch on 9 November 2026. No new notification copy is included.

## Homepage preparation

- Joshua approved launching with the current production recording on 9 November
  2026. The new homepage retains its CDN video, muted teaser and poster, and
  uses its existing transcript and chapters. Native captions are generated from
  that same transcript. The expanded player and controls below the frame remain.
- [ ] Joshua: record a replacement homepage video for the Cloud-first experience
  after launch.
- [ ] Replace the retained production recording, poster, preview and captions
  when the new recording is ready. Update its chapter times as needed.
- The old and new homepages now share their player controls, captions and
  fullscreen code. The new homepage keeps a compact muted preview and expands
  in place to the text column width, keeping its top-left corner fixed. It
  returns to the compact preview when collapsed. Playback controls sit in a
  right-aligned row below the video frame, including in fullscreen playback.
  `test/homepage-video.spec.js` passed 36 Chromium, Firefox and WebKit checks,
  including geometry throughout the animation, blocked autoplay, captions,
  retrying a failed load, keyboard navigation and replay.
  Another 43 Chromium checks cover the homepage, signup and routing.

## Production launch, 9 November 2026

- Joshua approved the final skill copy, production deployment and retaining the
  current production video. All 2,290 local Node checks and 38 homepage browser
  checks passed. The matching GitHub publish workflow also passed its tests.
- Deployed the immutable candidate to staging, then ran a fresh coordinated
  production backup. Merged the prepared Google, single-plan, standard-price and
  feedback-owner values into the live environment, preserving unrelated values.
  Retained a root-only copy of the previous environment for rollback.
- Deployed production with ops/deploy-production.sh. The application and isolated
  compiler are active. The previous code release remains available through
  /opt/smalldocs/previous. Rollback also needs the saved environment; the script
  does not restore environment values itself.
- Completed real Google sign-in in Chrome. It linked Google to the existing
  owner's email identity. Joshua separately approved accepting the current
  SmallDocs Terms. The signed-in library loaded the existing 188 documents.
  The initial library load was slow; subsequent reload completed. This check
  did not measure that delay or establish its cause, so retain cold library
  latency as a follow-up rather than claiming a performance fix.
- Used disposable identities through production onboarding, CLI device
  authorization, tagged save, read, search, labelled edit and history. Checked
  cross-library document/search/tag isolation and private team access before,
  during and after a grant. Published a rendered document anonymously, verified
  text in its HTML and no local path or private tags, then withdrew it. Checked
  non-admin feedback-inbox denial. Production publication was indexable; staging
  publications retained noindex headers.
- Published CLI 1.20.0 through the GitHub trusted publisher, with v1.20.0 and
  provenance identifying the deployed commit. Installed through the production
  /install endpoint in an isolated home, then verified skill v54, production
  origin, Cloud status, tagged save, read, edit reasons and history. The user's
  existing local staging install was preserved.
- Soft-deleted all three release-fixture documents, revoked fixture CLI
  credentials and sessions, disabled both synthetic identities and removed their
  temporary homes. The fixture identity proof was seeded by the operator; it
  does not count as a real email-code delivery test.
- Completed a second coordinated offsite backup containing the deployed code
  metadata and active environment. Removed the redundant prepared environment
  files after verifying their values match the active file. The monitor passes,
  there are no failed services or dead jobs, and no expired job leases.
- Rechecked the live Stripe endpoint and required event selection. The latest
  20 live events have zero pending webhook deliveries. Restored the user's
  original sandbox CLI context after this read-only check.

Verification limits: the hosted sandbox payment, referral reward and cancellation
checks above remain the payment evidence. This cutover did not charge a live
customer, repeat live email-code delivery, or complete a new live paid Checkout.
Check the first real payment and its webhook outcome when a customer subscribes.
Google's production sign-in works; its custom branding remains unverified.

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
