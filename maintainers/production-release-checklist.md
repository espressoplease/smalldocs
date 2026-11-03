# Cloud-first production release

Checked 3 November 2026. Evidence: [release receipt](qa/release/2026-11-03.json).
Production application code, environment and service configuration remain unchanged.
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

## Launch actions still pending

1. Obtain release approval. Current production remains on e5c705b24e8537dd5b2041fc3eb11801928af375.
2. Prepare the live SmallDocs monthly per-person product and price, matching the
   staged GBP 4, USD 5 and EUR 5 amounts and their tax behaviour. Confirm the
   intended live Stripe Payments or Managed Payments setup. The sandbox's
   product has tax_code=txcd_10103000; a fixture without a tax code was rejected
   because Managed Payments is enabled by default in that sandbox. This was
   corrected in the fixture without changing the application's payment model.
3. Set CLOUD_SINGLE_PLAN_ENABLED=1 and STRIPE_STANDARD_PRICE_ID for production.
   Preserve auth, cursor and idempotency secrets, database paths and KMS context.
   Verify the live app credential has the same required billing permissions as
   the tested restricted staging key. Administrative CLI access is not proof
   of the application's credential permissions.
4. Extend the live webhook's selected events to match the staged list above.
   Preserve its existing signing secret and subscription events. Confirm portal
   cancellation and payment-method management remain enabled.
5. Deploy the approved server release with ops/deploy-production.sh. This now
   provisions the production compiler, reuses an already-built immutable staged
   release and rolls back an unsuccessful application or compiler start.
6. Authenticate npm and publish the reviewed CLI package, then tag its matching
   source version. Deploy the matching backend before distributing the CLI.
   Production /install currently resolves npm latest, which remains 1.19.2.
7. Run a short check on the production origin: Google and email sign-in, return
   to the last library, CLI authorization, tagged save/read/edit, member access,
   Checkout and billing portal links, public publish/update/withdraw, and logout.
   Verify production public pages are indexable and staging remains noindex.
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
