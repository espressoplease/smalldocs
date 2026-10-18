# Cloud staging release candidate

Target: cloud-staging.smalldocs.org. Production code, settings, subscriptions and prices must remain unchanged for this release.

## What is implemented

The application has automatic initial libraries, profile capture from Google or email signup, an Install tab, one paid seat per person across libraries, library management, private join requests, document moves, computer defaults and matching CLI commands. Cloud URLs remain stable across saves and moves. The existing right panel and mobile sheet patterns are reused.

The normal application does not inject scenario controls, preview banners or development disclaimers. The optional test launcher is separate from application pages. Local and staging install instructions set the correct Cloud origin.

## Verification

- Full Node suite: 1,601 passing tests.
- Onboarding and homepage headless suite: 73 passing tests, including email delivery capture, verification, Terms, profile, CLI authorization, upload, revision and browser rendering.
- HTTPS access matrix and real CLI integration: two passing tests in legacy mode and two passing tests with the single-plan flag. The separate opt-in live billing portal test is skipped locally.
- Stripe sandbox: localised price, idempotent checkout, paid subscription, seat increase/decrease, cancellation scheduling/reversal, failed payment and payment recovery.
- CLI tarball: contains runtime modules, Cloud help and version 31 of the agent skill. The package is a release candidate, not published to npm.

Commands:

```sh
npm test
npm run test:onboarding
npm run test:cloud-e2e
CLOUD_SINGLE_PLAN_ENABLED=1 npm run test:cloud-e2e
```

The Stripe rehearsal is opt-in and accepts a sandbox key file only:

```sh
STRIPE_SECRET_KEY_FILE=/secure/path/to/sandbox-key \
STRIPE_STANDARD_PRICE_ID=price_1URS120RfTbC6JQX8x0aHm8S \
node scripts/verify-single-plan-stripe.js
```

## Staging configuration and release

1. Review and push the intended candidate. For an isolated staging release, run `./ops/deploy-staging.sh smalldocs-prod codex/homepage-next-review`. Main and production promotion remain separate.
2. Back up the staging databases. With their paths in the environment, run `node scripts/single-plan-migration-review.js`. It opens them read-only and reports payer candidates and multiple existing Stripe subscriptions. Resolve any reported paid subscription conflicts before activation.
3. Add `CLOUD_SINGLE_PLAN_ENABLED=1` and `STRIPE_STANDARD_PRICE_ID=price_1URS120RfTbC6JQX8x0aHm8S` to staging configuration. Retain legacy price IDs for existing subscriptions. Keep staging credentials and data separate from production.
4. Configure Google OAuth for staging. The deployed staging service currently has no Google client credentials. Register `https://cloud-staging.smalldocs.org/api/cloud/auth/oauth/google/callback` on the intended client, configure its credentials through the existing secure configuration mechanism and verify an actual Google sign-in. Local Google start, state, nonce, PKCE, signed claims and profile handling have been tested; a human Google account has not completed the staging flow in this build.
5. Deploy with the existing staging script from a clean published main checkout. Verify the release commit, email delivery, actual Google sign-in, CLI device approval and a Cloud save. Run the HTTPS access matrix against staging using its exact-identity test secret.
6. Distribute the CLI candidate for staging testing. Do not assume the current npm latest contains the new library commands. Publish the reviewed candidate under a prerelease tag if remote installation is needed. Keep the default npm release and global production installs unchanged until the release is approved.

## Deployment on 18 October 2026

- Deployed commit: `38ea07bd1417e7f4be10e96831ec01e90e228e81`, from `codex/homepage-next-review`.
- Homepage: https://cloud-staging.smalldocs.org/home-next.
- Backup: `/var/backups/smalldocs-staging/20261018T100044Z-before-single-plan`.
- Read-only migration review: four owners, zero paid subscription conflicts.
- Enabled the single-plan model and standard sandbox price on staging only.
- Configured staging Google credentials and added its exact callback to the existing SmallDocs web client. Existing callbacks remain and no secret was rotated.
- Google remains in Testing mode, with `eichler.summers@gmail.com` allowed. Other testers need adding to Google's test-user list.
- A real Google sign-in succeeded and reached the SmallDocs Terms page, left for the human to accept. That user's subsequent onboarding has not been clicked through.
- Repeated Node suite: 1,601 passing tests. Local headless onboarding and homepage suite: 73 passing tests.
- Deployed HTTPS access matrix: two passing tests covering account isolation, edit merging, CLI authorization, Cloud upload/revisions and credential revocation. The optional existing-subscription Stripe portal test was skipped.
- An already subscribed staging fixture correctly received `409 subscription_exists` on another subscription request.
- Both services are healthy. Production remains on `e5c705b24e8537dd5b2041fc3eb11801928af375` with an unchanged environment checksum.
- No main merge, production deployment or npm publication was performed. The CLI candidate remains separate from npm latest; the standard public installer does not yet distribute all candidate CLI changes.

The numbered steps above remain the release checklist. Step 4 is now configured and its real Google callback verified; step 6 remains pending npm distribution.

## Explicit follow-up

The bulk document-access command remains a follow-up, with existing single-document CLI access available. Adding a member does not share historical documents automatically.

The homepage's requested referral sentence remains unchanged, but the referral earning condition and extension amount are not specified by this build. Resolve the referral feature and terms before promoting that claim to the main public homepage.

Billing-account retention differs from physical library deletion. The new payer accounts are excluded from the old workspace purge scheduler. Review retention and recovery policy before activating automated billing-account deletion in production.
