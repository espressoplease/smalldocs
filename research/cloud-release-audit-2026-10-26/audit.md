---
title: "SmallDocs Cloud - flow audit and production priorities"
---
# SmallDocs Cloud: flow audit and production priorities

26 October 2026. Audited branch: `codex/homepage-next-review`, commit `19da48521599730292f2cde9aca389a540b633e0`.

The audit found five runtime defects that deserve attention before production: login refresh can revoke an installation during ordinary concurrent use or network recovery; parallel saves can lose local document bindings; an unpaid subscription can reopen reads after the trial paywall; membership changes during Checkout can leave the billed quantity wrong; and failed-payment warnings are missing from the agent receipt and SmallDocs notification path. There is also a test-runner registration defect.

These findings have different consequences. Losing a binding does not delete the Cloud document, but it can make a later save create a second document. The payment-wall defect does not grant permission to another person's documents. No new cross-company disclosure or irrecoverable server-side document loss was reproduced in this audit.

**Recommended order:** correct the test entry point, fix shared CLI state and refresh, repair unpaid and changing-seat billing transitions, align payment communication and public copy, then complete the real-provider and production-data rehearsals. Staging and production application deployments were not changed by this audit.

## Repair status, 26 October 2026

Eleven findings are fixed and tested locally on this branch. The root homepage
cutover is prepared under the existing single-plan flag. No application was
deployed to staging or production, and no npm package was published.

| Finding | Current status | Local evidence |
| --- | --- | --- |
| F01 | Fixed locally | Six independent CLI processes share one refresh. Exact response-loss retries recover the same tokens; unrelated replay still revokes the installation. |
| F02 | Fixed locally | Eight processes retain all 120 bindings and 240 pending records. A stopped writer's lock is recovered; unreadable binding state is preserved. |
| F03 | Fixed locally | Incomplete and expired initial payments preserve the trial wall. A live trial still works, successful activation unlocks content, and subsequent paid cancellation retains reads. |
| F04 | Fixed locally | A member joining an already-open Checkout produces provider and local quantity 2 at activation. Durable retries and per-account coordination reconcile the current count. |
| F05 | Fixed locally | The canonical test command now runs the 84 checks in the five skipped suites. |
| F06 | Fixed locally | Receipts carry failed-payment notices and a grace deadline. A real local SMTP exchange captures the current billing email, without deletion language. |
| F07 | Fixed locally | Pricing, revision history, retention, cancellation and referral copy aligned. Terms version advanced to 26 October 2026. |
| F08 | Partly prepared | The new homepage is canonical when single-plan mode is enabled, and the CLI tarball includes the repair. Stable npm publication and fresh-install acceptance remain. |
| F09 | Still open | Retiring a linked sign-in method or primary contact address needs a complete account-management flow. |
| F10 | Fixed locally | Subscription reauthentication has a direct return link. Settings preserve drafts and offer sign-in in a second tab. |
| F11 | Fixed locally | Gmail plus a verified work address can request membership. Multiple work emails are selectable; unverified addresses and other-domain reviewers are rejected. |
| F12 | Fixed locally | Invitation receipts distinguish queued email from a shareable link and show the actual invitation URL. |
| F13 | Fixed locally | Payment confirmation checks status automatically, stops after ten polls, and offers manual recovery without creating another Checkout. |
| F14 | Still open | Deployment-VM latency and capacity measurements remain. Existing isolation tests continue to pass. |

**Validation:** 1,956 checks pass in the canonical Node suite. All 51 focused
headless browser checks pass, covering account linking, email signup from the
new root homepage, settings, sidebar recovery, payment confirmation and email
rendering. The packed CLI contains `lib/file-lock.js` and has no runtime
dependencies. These checks use disposable data and local provider transports;
they do not replace the live provider and production-data rehearsals below.

Migration adds hashed refresh-retry state, initial-payment/activation fields,
and a selected work email on join requests. Existing ambiguous subscription rows
still require provider reconciliation during the production-data rehearsal. The
local seat queue serializes one application process, matching today's deployment;
it is not a distributed lock for future multiple-instance deployments.

Detailed mechanisms and rollout notes are in
`maintainers/cloud-release-fixes-2026-10-26.md`. R01 through R04 below remain
release verification work. The original findings and evidence below describe
the audited baseline, before these repairs.

## Original audit scope and evidence

The map covers 91 normal paths, transitions and edge-case groups across authentication, installation, libraries, documents, search, team access, billing, recovery, navigation and feedback. It is a flow inventory, not a claim that every possible event ordering has been tested.

Evidence labels used below:

| Label | Meaning |
| --- | --- |
| Reproduced | A new disposable probe exercised the production module or HTTP handler and observed the problem. |
| Regression | A relevant automated suite was explicitly run during this audit. |
| Inspected | Code and existing test coverage were inspected; this exact path was not individually rerun. |
| Verification gap | A live provider, deployment or production-data check is still needed. |
| Boundary | A supported limitation or product decision, rather than an unexpected failure. |

During this audit, **189 focused regression checks passed**, covering account linking, trial boundaries, single-plan billing, search API and isolation, older read helpers, revision retention, update previews and agent management. Another **84 tests passed when explicitly invoked** after the test-registration problem was found. These are 273 focused checks, not a replacement count for the whole repository suite.

The earlier reported full Node run passed 1,864 tests, but it did not execute five returned test-suite functions. That result should not be described as covering those five suites. The new adversarial probes remain separate from the main runner and deliberately assert the current faulty outcomes, so a zero exit from a reproduction means the defect was confirmed, not that it was fixed.

All new probes used disposable local databases. Browser checks were headless. Stripe responses and signed webhook events were generated locally. No real payment, real invitation, production database write or application deployment was performed.

## Ranked findings

P1 means recommended to resolve before opening production Cloud. P2 means a focused UX, account-lifecycle or capacity follow-up. These are priorities for review, not new product restrictions.

| Rank | ID | Priority | Finding | Evidence | User consequence |
| --- | --- | --- | --- | --- | --- |
| 1 | F01 | P1 | Concurrent refresh or a lost refresh reply can revoke the CLI login | Reproduced twice | Ordinary agent activity requires a fresh human login |
| 2 | F02 | P1 | Concurrent local state writes can lose document bindings | Reproduced in two processes | Later saves can split a document into duplicates or lose retry tracking |
| 3 | F03 | P1 | An unpaid incomplete subscription reopens reads after the trial paywall | Reproduced through a signed webhook and real read API | The agreed hard payment wall is bypassed for reads |
| 4 | F04 | P1 | Membership changing during open Checkout leaves Stripe quantity stale | Reproduced with the job worker enabled | Two people are covered while the provider still bills one |
| 5 | F05 | P1 | Main test command skips five suites containing 84 tests | Inspected and all 84 run explicitly | Future auth, billing and job regressions can pass the normal command |
| 6 | F06 | P1 | Failed-payment receipts omit a warning and grace deadline; SmallDocs billing emails are skipped | Reproduced and inspected | Agents see active access without the approaching write cutoff |
| 7 | F07 | P1 | Public policies and product copy conflict with the single-plan implementation | Inspected | Users receive contradictory retention, history and product promises |
| 8 | F08 | P1 release work | The default homepage and published installer still expose the older product | Inspected; registry checked | New users can start with outdated positioning and CLI behavior |
| 9 | F09 | P2, security-sensitive | Sign-in methods can be added but cannot be removed through the product | Inspected | A former work address cannot be retired as a login by the user |
| 10 | F10 | P2 | Checkout reauthentication has a message but no direct recovery link | Reproduced in headless Chromium | A valid signed-in user can be stuck after 30 minutes |
| 11 | F11 | P2 | A linked work email is ignored by company join discovery when Gmail came first | Reproduced | A verified company address does not enable the expected join-request path |
| 12 | F12 | P2 | Invitation UI reports sent even when no delivery job was scheduled | Inspected | A user can believe a teammate was contacted when only a link was created |
| 13 | F13 | P2 | Delayed payment confirmation requires manual checking and retrying | Inspected | Returning from Checkout can look unsuccessful while its webhook is pending |
| 14 | F14 | P2 capacity | Large-library latency has not been established on the deployment VM | Existing resource evidence | Bounded memory is not yet proof of acceptable concurrent response time |

### F01. Refresh treats ordinary concurrency as credential theft

Two clients loaded the same expired credential and reached the real refresh endpoint together. The server rotated the first refresh token. The second use matched the previous token and revoked the installation. In the observed run both clients ended with `login_required`, and the shared saved credential was removed.

A second probe let the server complete rotation, then dropped the response before the client received it. The first attempt returned `temporary_service_failure`, preserving the old local token. A normal retry then hit token-reuse detection and revoked the installation.

Relevant code: [CloudClient.refresh and authenticated](https://github.com/espressoplease/smalldocs/blob/19da48521599730292f2cde9aca389a540b633e0/cli/lib/cloud-commands.js#L528), [refreshCliCredential](https://github.com/espressoplease/smalldocs/blob/19da48521599730292f2cde9aca389a540b633e0/lib/cloud-auth.js#L538).

**Proposed work:** serialize refresh per installation and origin across processes, reload the saved credential after obtaining that coordination, and provide a recoverable retry mechanism for a refresh whose response was lost. Client serialization alone does not solve the lost-response case. Preserve meaningful detection of genuinely stolen-token replay.

**Acceptance:** overlapping commands, a slow Keychain write, a process exiting during refresh, and a lost successful response must recover without human login. Explicit machine revocation must still deny all subsequent access.

### F02. Atomic rename does not protect a read-modify-write transaction

The bindings and pending-operation files are shared JSON objects. Each process reads the whole object, changes one entry and atomically replaces the file. Two independent processes can both read the old object, then each replace it. The second write loses the first process's unrelated entry.

The probe synchronized two real processes at the normal bindings-file read. Both wrote different documents successfully. The final file contained one binding instead of two. The same read-modify-write shape exists for pending operations; that second consequence is a code-based inference, not a separate reproduced case.

Relevant code: [binding and pending writes](https://github.com/espressoplease/smalldocs/blob/19da48521599730292f2cde9aca389a540b633e0/cli/lib/cloud-bindings.js#L25), [atomic file replacement](https://github.com/espressoplease/smalldocs/blob/19da48521599730292f2cde9aca389a540b633e0/cli/lib/cloud-credentials.js#L55).

**Proposed work:** coordinate the complete local read-modify-write, or use independent per-document and per-operation records with equivalent durability. Keep the CLI's zero-dependency distribution requirement in mind.

**Acceptance:** concurrent saves of different files retain every binding; same-file updates have a defined result; pending keys survive unrelated cleanup; killing a writer does not leave corrupt state or a permanently blocked installation. Verify that the next normal save updates the original Cloud URL.

### F03. A never-paid subscription bypasses the trial read wall

The probe created a document, expired the free trial and warning week, and confirmed that its read endpoint returned HTTP 402. It then delivered a correctly signed `customer.subscription.created` webhook with Stripe status `incomplete`, representing a subscription whose initial payment has not completed. The same read returned HTTP 200 with the Markdown.

The stored subscription becomes `read_only`. Its presence suppresses the trial row in `computeEntitlements`; the trial policy therefore has no trial deadline to apply. Single-plan read access is then allowed because the effective state is not `payment_required`.

Relevant code: [computeEntitlements](https://github.com/espressoplease/smalldocs/blob/19da48521599730292f2cde9aca389a540b633e0/lib/cloud-billing.js#L344), [single-plan entitlements](https://github.com/espressoplease/smalldocs/blob/19da48521599730292f2cde9aca389a540b633e0/lib/cloud-single-plan.js#L136), `lib/cloud-trial-policy.js`.

**Proposed work:** distinguish never-paid or incomplete initial subscriptions from subscriptions that previously earned paid access. An incomplete row must not erase an expired trial's hard payment wall. Preserve the separately intended read-only access after a previously paid subscription ends.

**Acceptance:** test initial payment failure, incomplete expiry, a delayed success webhook, cancellation before first successful payment, and successful payment recovery. Reads, search, history, tags, exports and browser navigation should agree with the selected policy.

### F04. Checkout can finish with an obsolete seat count

The probe opened Checkout for one person, then accepted a second member's invitation while that Checkout remained open. The membership seat-sync job ran before a Stripe subscription existed and completed without changing Stripe. Payment was then confirmed using the original Checkout quantity.

Observed state: expected sponsored seats 2, Stripe quantity 1, local subscription quantity 1, second person covered, zero provider seat updates and no pending seat-sync job.

The existing test for changed seats only covers calling Subscribe again to replace an open Checkout. It does not cover completing the already-open Checkout.

Relevant code: [Checkout quantity snapshot](https://github.com/espressoplease/smalldocs/blob/19da48521599730292f2cde9aca389a540b633e0/lib/cloud-single-plan.js#L64), [subscription webhook](https://github.com/espressoplease/smalldocs/blob/19da48521599730292f2cde9aca389a540b633e0/server.js#L3100), `lib/cloud-seat-sync.js`.

**Proposed work:** reconcile the newly activated billing account against current sponsored membership and retain durable retry work when Stripe is unavailable. Define how any quantity or charge change after the human reviewed Checkout is communicated. An opposite-direction overcharge when a member leaves is a risk to test, not a separately reproduced result here.

**Acceptance:** join, removal, independently paid coverage and sponsorship changes during Checkout converge to the agreed seat count. Duplicate or reordered webhooks must not duplicate charges or overwrite newer state.

### F05. The normal test entry point does not run five registered suites

`test/run.js` calls the module factories for auth, billing, billing lifecycle, Stripe and jobs, but discards the runner functions they return. The corresponding test bodies never execute in that command.

There are 29 auth tests, 23 billing tests, 12 lifecycle tests, 9 Stripe tests and 11 job tests. Running all five returned functions explicitly passed all 84.

Relevant code: [test registration](https://github.com/espressoplease/smalldocs/blob/19da48521599730292f2cde9aca389a540b633e0/test/run.js#L61).

**Proposed work:** execute those runners in the orchestrator. Add a small registration assertion or deliberate-failure check proving that every declared group participates in the canonical command. Report executed coverage rather than relying on a green aggregate count.

### F06. Failed renewal is not communicated through the new path

A signed webhook changed a subscription to `past_due`. The billing endpoint reported that subscription status but returned phase `active`, an empty notices array and no grace deadline in the summary. With the job worker configured, SmallDocs queued no billing-state email.

The single-plan guard in `scheduleBillingLifecycleJobs` disables all old lifecycle scheduling, not only deletion warnings. The email worker also skips old billing emails in this model. That avoids obsolete deletion messages, but the replacement payment-failure communication is missing.

Relevant code: `server.js:cloudSubscriptionState`, `server.js:scheduleBillingLifecycleJobs`, `server.js:processCloudJob`, `lib/cloud-trial-policy.js:trialStatus`.

**Proposed work:** add current single-plan notices for payment failure, the write cutoff and recovery, and make the agent and browser consume the same state. Verify what Stripe itself sends before promising a particular email. Do not restore the old deletion warnings.

### F07. Public copy describes policies that are not implemented

Concrete mismatches:

- `/privacy` still says Cloud keeps the current revision and up to three previous revisions. The implemented policy keeps all revisions for at least 90 days, with the current revision retained.
- `/legal`, `/privacy`, `/cancellation` and `/cloud` still describe automatic deletion after cancellation or failed payment. Single-plan billing-retention deletion and its notices are disabled.
- `/home-next` promises referral-based free-use extensions. No referral-extension implementation was found in the inspected application and CLI source.
- Older public pages and CLI overview text still frame Cloud as optional and describe Personal versus Team distinctions that no longer match the primary experience.

This is an implementation-and-copy consistency finding, not an assessment of legal compliance. The already-correct trial paragraph in Terms should be preserved. Previously paid cancellation still intentionally gives read-only access; it should not be confused with the hard wall after an unpaid trial.

**Acceptance:** one policy table drives the final copy review for trial, paid cancellation, failed payment, retained data, history, consumer refunds, sponsorship and optional local behavior.

### F08. Production entry points still need their coordinated release

The source still serves `homepage.html` at `/`; `homepage-next.html` is only selected by `/home-next`. The older page includes free-personal-use positioning. The npm registry currently serves CLI 1.19.2, while this branch is 1.20.0-rc.11. Production `/install` resolves npm latest; staging uses a release-specific hosted tarball.

**Proposed work:** prepare the stable CLI package and skill, select the new homepage as the canonical entry, align install instructions and help, then test a fresh home directory through authentication, library creation, tags, save, returned URL and update. Keep staging-channel credentials and metadata out of the production package.

### F09. Connected sign-in methods have no removal path

Preferences lists methods and offers Connect Google and Add an email address. No corresponding user-facing removal or primary-contact selection path was found. Updating a Google identity's email also leaves the older email-code identity attached.

This is especially relevant when a person links a work mailbox to an account containing personal libraries, then leaves that employer. Control of a still-linked mailbox remains sufficient for email-code login if it is later reassigned. This follows from the chosen mailbox-login model; it is not proof of an unauthenticated attack or a reason to claim every linked work address is already compromised.

**Proposed work for review:** let a recently authenticated user retire a sign-in method while keeping a working login, choose the contact address and define the effect on existing sessions and connected machines. Account recovery and corporate mailbox reassignment need an explicit policy. Do not silently change the approved automatic-linking policy as part of a cosmetic fix.

### F10. Recent-authentication failures do not finish the recovery journey

In a headless browser with a valid session older than 30 minutes, Subscribe returned: "Sign in again before continuing to payment." There were zero sign-in links on that page. Account-linking pages already include a recovery link; payment and some settings mutations do not use the same complete pattern.

**Proposed work:** return a reauthentication URL that preserves the exact destination and render an actionable sign-in control. Keep the user's pending input where relevant. Test expiry while the page is already open, not only arriving with no session.

### F11. A verified work alias is not used for company discovery

The probe attached a verified `@joes.com` email identity to a Gmail-first user. The onboarding API still returned `company_domain: null`; requesting to join returned HTTP 400. Company discovery reads the first verified email rather than allowing the person to choose an eligible verified address.

Invitation acceptance already considers all verified addresses, so a direct invitation is a usable alternative. No new company membership was granted by linking the alias.

**Proposed work:** select an eligible verified work address for the request and contact flow, while continuing to hide other members' names and require the administrator's invitation.

### F12. Invitation creation is reported as email delivery

`public/cloud-admin.js:submitInvite` discards the returned invitation receipt and displays "Invitation sent". The account invitation endpoint can return `notification_scheduled: false` while successfully creating the invitation. Even `true` means queued, not delivered. The CLI already distinguishes these cases more accurately.

**Proposed work:** reuse the receipt semantics in the browser, display the shareable invitation link, and offer recovery if delivery fails. Do not invent a delivered status that the mail provider has not confirmed.

### F13. Delayed confirmation is accurate but not self-resolving

The backend refuses a second Checkout when an existing session is complete but its webhook has not yet confirmed access. This is correct protection against duplicate subscriptions. The UI asks the user to check Billing in a moment, with no automatic state refresh on Subscribe.

**Proposed work:** provide a bounded confirmation/check-again state and an explicit retry or Billing action. Continue to require an authenticated provider confirmation before granting paid writes. Provider outage and permanently failed confirmation need a visible support path.

### F14. Memory measurements do not establish production search latency

The existing 100,000-document measurements show bounded observed process memory, but eight overlapping browse-plus-tag loads took about 49.8 seconds in one local configuration. The search resource evaluation reported roughly 34 seconds for its busiest eight-request burst. Those observations excluded deployment HTTP and managed KMS overhead and did not cover 100,000 distinct tags.

The decision to load all accessible tags when the library loads is preserved. The follow-up is to measure and reduce unnecessary work, not silently defer or omit the tag inventory.

**Acceptance:** report deployment-shaped median and tail latency, concurrent throughput, peak memory, database/index size, KMS behavior, cold start and a varied tag vocabulary. Continue checking permission-filtered counts, tags, authors and cursors during revocation.

## Flow map

### Authentication and identity

| ID | Flow and edge cases | Current behavior and assessment |
| --- | --- | --- |
| A01 | New Google Gmail signup, complete name | Terms then automatic library setup and Install or preserved destination. Existing browser coverage inspected. |
| A02 | New Google Workspace signup | Verified hosted-domain identity can match email login; no domain-based library membership. Regression. |
| A03 | Google omits part of the name | Profile captures missing details before usable setup. Existing browser coverage inspected. |
| A04 | Email signup, valid delivered code | Verify code, Terms, name, automatic library, return destination. Existing browser coverage inspected. |
| A05 | Wrong, expired, replayed or resent code | Invalid challenge denied; newest challenge replaces the older one. Auth regression run explicitly. |
| A06 | Google declined, wrong state/nonce, wrong browser | OAuth adapter and binding reject the callback; email remains an alternative. Adapter/browser coverage inspected. |
| A07 | Email first then matching authoritative Google | Same permanent user, documents, trial and billing. Regression and existing browser coverage. |
| A08 | Google first then email code | Same permanent user through installed email alias. Regression and existing browser coverage. |
| A09 | Google with third-party email | Fresh mailbox proof before creating or linking the user. Regression. |
| A10 | Deliberately connect a different address | Recent original session and explicit confirmation; existing other account is not merged. Regression. Removal gap F09. |
| A11 | Name, contact email or company address changes | Existing identity survives; primary-address selection and retiring old aliases are incomplete. F09 and F11. |
| A12 | Terms change, disabled account or expired browser | Terms and authentication recovery apply without intentionally duplicating a library. Auth and agent regressions; stale recent-auth UX F10. |

### Installation and agent connection

| ID | Flow and edge cases | Current behavior and assessment |
| --- | --- | --- |
| I01 | Fresh macOS/Linux URL install | Staging tarball follows the deployed release; production follows npm latest. F08 and live-install verification gap. |
| I02 | Windows/npm installation | Staging tarball command exists; production npm package must be released. Inspected; real OS installation remains a release check. |
| I03 | Device authorization before signup | Preserve user code through email, Terms and profile. Existing browser/CLI coverage inspected. |
| I04 | Authorization expired, reused, denied or wrong user | Device code has bounded lifetime and one-use approval; revoked credentials denied. Auth regression. |
| I05 | Normal access-token expiry | Automatic refresh ordinarily works. Concurrent and lost-response cases are broken, F01. |
| I06 | Terms update, rate limit, outage during refresh | Credential is retained for recoverable responses. Existing agent tests; successful response loss is a distinct F01 case. |
| I07 | Logout, machine revocation, staging/production separation | Credentials and origins are separated; revoked machines denied. Regression/installed-channel source inspected. |

### Libraries, membership and destinations

| ID | Flow and edge cases | Current behavior and assessment |
| --- | --- | --- |
| L01 | First signup with no library | Automatic initial library, one trial, retries reuse setup. Regression. |
| L02 | Direct invitation before own-library setup | Deliberate acceptance supplies first library without forcing a separate personal one. Existing onboarding coverage inspected. |
| L03 | One available library | Automatic destination. Regression. |
| L04 | Several libraries without a default | Return choices; the agent asks for the destination. Observed in the installed CLI during this audit. |
| L05 | Computer default, explicit account and bound file | Explicit destination controls new files; a binding keeps its document; defaults are machine/user scoped. Regression. |
| L06 | Browser library selection | Selection is separate from a computer's save default; pill opens the right panel. Existing UI coverage inspected. |
| L07 | Create another library | Reuse billing account and original trial; no second automatic subscription. Regression. |
| L08 | Move a document between libraries | Creator-only, history re-encrypted, URL retained, access reset to Only you, source access removed. Regression. |
| L09 | Destination disappears, key fails or a competing save occurs during move | Failure should preserve source state; encryption/access rollback tests pass. More combined event-order testing remains useful. |
| L10 | Ownership transfer, deleted library and restore | Payer and trial stay stable; recent authentication and restore windows apply. Regression for transfer; delete/restore source inspected. |

### Document creation, editing and history

| ID | Flow and edge cases | Current behavior and assessment |
| --- | --- | --- |
| D01 | Save a new tagged Markdown document | Upload first, return confirmed Cloud URL and saved tags, then open. Agent regression. |
| D02 | Update a bound file | Same document ID and URL; new revision for content changes. Existing CLI coverage inspected. |
| D03 | Save unchanged content | No unnecessary content revision; metadata changes remain explicit. Update/agent coverage. |
| D04 | Local file changes during upload or pull | Do not overwrite newer local work; receipt reports changed state. Existing update coverage inspected. |
| D05 | Lost create/save response and retry | Durable idempotency is intended. Parallel pending-state durability needs F02. |
| D06 | Two people edit independent passages | Target-based merge preserves both changes; revision history remains available. Update regression. |
| D07 | Two people change the same passage | Both alternatives retained, with combined metadata and history. Chosen velocity-first policy; update regression. |
| D08 | Strict reviewed save or head changes after preview | Reviewed-head comparison rejects a stale strict operation. Regression. |
| D09 | Old base beyond retention | Recover from a verified cached base when supported; otherwise report target too old. Existing CLI/update coverage inspected. |
| D10 | Inspect history, diffs and restore | Permission-scoped history; restoring makes a new revision. Regression; policy copy gap F07. |
| D11 | Delete, retry delete, restore, then purge | Soft deletion with a restore window; stale purge jobs must not remove restored content. Store/revision coverage inspected. |
| D12 | Two agents save different files on the same computer | Cloud operations can succeed while one local binding is lost. Reproduced F02. |

### Search, tags and library browsing

| ID | Flow and edge cases | Current behavior and assessment |
| --- | --- | --- |
| S01 | Browse more than 60 documents | Next/Previous with stable query and filter state. Existing pagination/browser coverage inspected. |
| S02 | Tags across the complete accessible library | Inventory loads eagerly, separately from document rows; permission filtered. Regression and existing UI coverage. |
| S03 | Keyword, phrases, Boolean, literal, prefix and fields | Browser and CLI share the indexed query path and access checks. Search API regression. |
| S04 | Creator, updater, tag, dates, library and subset filters | Filters intersect authorized documents; facets and counts follow the scope. Regression. |
| S05 | Star/unstar, reload and another user | Stars persist per user and do not grant access. Existing browser coverage inspected. |
| S06 | Revoke access while decryption, counting or facets await | Final rechecks remove inaccessible rows and metadata. Search and older-read isolation regressions. |
| S07 | Reuse or tamper with a cursor | Scope, caller, filters and signature checked; membership changes respected. Regression. |
| S08 | Existing documents have missing/stale index state | Request rebuilds a batch and may return search_index_building. Prebuild the complete production index during rehearsal. |
| S09 | Large corpus, many distinct tags, concurrent users | Local resource observations exist; deployment capacity remains unverified. F14. |

### Team joining, sharing and notification

| ID | Flow and edge cases | Current behavior and assessment |
| --- | --- | --- |
| T01 | Gmail-first user wants company discovery | Work alias is not selected for discovery. Reproduced F11. Direct invitation remains usable. |
| T02 | Verified company user requests to join | Opaque handoff link; does not reveal whether a team exists or list members. Join source/tests inspected. |
| T03 | Admin reviews request, multiple eligible libraries | Domain and admin-role checks before invitation; no automatic membership. Existing join tests inspected. |
| T04 | Request expired, canceled, reused or already joined | Invalid handoffs denied; existing invitation lifecycle remains separate. Existing join tests inspected. |
| T05 | Invite, accept, decline, wrong email, expiry or revocation | Verified addresses and active invitation checked; accepting does not share private documents. Regression/previous browser coverage. |
| T06 | Ordinary member invites under allowed-domain policy | Existing role and configured invitation rules apply. Existing agent/store coverage inspected. |
| T07 | Only you, Everyone or selected people | Everyone is library-scoped; paid coverage or matching domain never grants file access. Regression. |
| T08 | Remove member, leave library, remove final owner | Access revoked; final owner protected; sponsored seats reconciled. Regression. |
| T09 | Notify or invite, provider unavailable, delayed worker or recipient removed | Document notification checks delivery-time access; invitation UI overstates delivery, F12. Existing worker/source coverage. |

### Trial, subscription and sponsorship

| ID | Flow and edge cases | Current behavior and assessment |
| --- | --- | --- |
| B01 | One calendar month free | No card required; original deadline retained across extra libraries. Regression. |
| B02 | Exact trial end and following seven days | Content continues with agent notices and payment/feedback links. Boundary regression. |
| B03 | Exact warning-week end | Unpaid trial content routes and document page blocked. Regression, except incomplete-subscription transition F03. |
| B04 | Subscribe during trial | Human pays through Stripe; paid period starts immediately. Source/local-provider coverage; real-provider check outstanding. |
| B05 | Double click, repeated request or concurrent Checkout start | One operation and provider idempotency protect the ordinary retry path. Single-billing regression. |
| B06 | Member count changes while Checkout is open | Retry can replace Checkout, but completing the original session misses reconciliation. Reproduced F04. |
| B07 | Initial payment fails or remains incomplete | Writes remain blocked, but expired-trial reads reopen. Reproduced F03. |
| B08 | Successful payment with delayed webhook | Do not start another subscription or trust the browser return as proof. Correct backend; confirmation UX F13. |
| B09 | Duplicate, invalid or reordered webhook | Signatures, event deduplication and provider event ordering are covered. Explicit Stripe/lifecycle tests passed. |
| B10 | Paid elsewhere, several libraries, sponsor removed or personal payment | Unique-person paid coverage should avoid a second charge; removal and self-payment regressions pass. |
| B11 | Renewal failure, seven-day grace and recovery | Access policy exists; agent warnings and SmallDocs email scheduling are incomplete. Reproduced F06. |
| B12 | Cancel a formerly paid subscription | Editing through paid period, then read-only; retained data. Source/regression; old deletion copy conflicts, F07. |
| B13 | Trial feedback, invoices and billing portal | Authenticated feedback available behind wall; financial actions stay in browser. Agent regression; stale-session recovery F10. |

### Navigation and return journeys

| ID | Flow and edge cases | Current behavior and assessment |
| --- | --- | --- |
| U01 | Fresh visit to canonical homepage | Still selects old template; new page remains /home-next. F08. |
| U02 | Google/email CTA or Log in on the new homepage | Shared sign-in styling, onboarding, correct return destination. Previous 22-scenario browser evidence inspected. |
| U03 | Direct document, invite, authorization or settings link | Preserve the destination through Terms and profile. Existing onboarding/recovery tests inspected. |
| U04 | Cloud-first sidebar, one or multiple documents | Cloud-first markup and contextual Library expansion implemented. Existing reader/sidebar coverage inspected. |
| U05 | Existing user's local-library preference | Preference persists; old mode remains available deliberately. Agent regression. |
| U06 | Service worker upgrade, stale tab and mobile layout | Cache-version and staged-refresh tests exist; exact final production release needs its own smoke check. |
| U07 | Signed in but recent-authentication window expires | Operations can fail while the user still appears logged in. Reproduced Checkout case F10. |

### Feedback and sharing boundaries

| ID | Flow and edge cases | Current behavior and assessment |
| --- | --- | --- |
| FBA01 | Open a managed Cloud URL in chat | Stable returned URL; recipient still needs document permission. Implemented, regression/source evidence. |
| FBA02 | Explicit encrypted snapshot link | Separate snapshot trust and revocation model; does not follow later Cloud edits or permissions. Boundary. |
| FBA03 | sdoc feedback or bridge live session | Still local process/session functionality. A Cloud save does not make submissions Cloud-backed. Boundary documented in the skill. |
| FBA04 | Agent reads history to repair a combined edit | Retained revisions and diffs support repair; cannot recover a legitimately pruned base without a verified local cache. Regression/boundary. |

### Deployment and operational recovery

| ID | Flow and edge cases | Current behavior and assessment |
| --- | --- | --- |
| O01 | Publish stable CLI and production skill | Registry package, installer, setup, refresh and generated skill need one coordinated release. F08. |
| O02 | Enable single-plan production settings | Verify flags, live price, portal, origin, email and webhook credentials without copying staging secrets. Verification gap. |
| O03 | Real Google and mailbox login | Token/provider fixture coverage is strong; live Google consent and email delivery still require acceptance. Verification gap. |
| O04 | Real Stripe Checkout, failure, portal and cancellation | Local provider and signature coverage exist; real sandbox lifecycle remains an acceptance task. Verification gap. |
| O05 | Production data migration and search backfill | Rehearse on a snapshot, preserve IDs, keys, permissions, subscription mappings and trials; finish index rebuild. Verification gap. |
| O06 | Backup restore and code rollback after new writes | Prove restored databases and KMS access; code rollback must preserve post-launch writes. Verification gap for this release. |
| O07 | SMTP, KMS, disk, job or network failure | Retry/error paths exist; verify alerts, dead jobs, restore readiness and provider failure behavior on deployment configuration. |
| O08 | Operator-assisted account deletion and provider recovery | No new self-service identity-removal UI was found. Confirm the support route and separate cancellation from deletion. F09 and operational check. |

## Production verification tasks, separate from defects

| ID | Priority | Task | Completion evidence |
| --- | --- | --- | --- |
| R01 | P1 release check | Real Google, delivered email code, both login orders, linked address and fresh CLI install | Recorded identities/library IDs agree; no extra trial; saved tagged document URL opens correctly |
| R02 | P1 release check | Actual Stripe sandbox Checkout, initial failure, delayed webhook, renewal failure, recovery, cancellation and seat changes | Provider and local quantities agree; one subscription per payer; correct access and notices at each boundary |
| R03 | P1 release check | Production snapshot migration, full index backfill, backup restore and code rollback | Document/revision counts, identifiers, permissions, original trial dates and billing mappings preserved; representative searches and reads succeed |
| R04 | P2 before promising large-library capacity | Deployment-shaped search/browse/tag load test | Measured latency, throughput, memory and KMS behavior, with company isolation assertions |

The earlier discussion that production has almost no paying users reduces migration complexity. It does not replace the snapshot check or justify silently dropping existing documents or key material. This audit did not access the production database again.

## Proposed work batches

1. **Make the evidence reliable.** Correct the five suite registrations, add the eight new probe scenarios as regression expectations, and keep their old faulty observations as historical evidence.
2. **Stabilize agent concurrency and recovery.** Fix F01 and F02 together, then test multiple processes creating, tagging, updating and searching while tokens expire or replies are lost.
3. **Complete billing transitions.** Fix F03, F04 and F06, then run the real sandbox lifecycle in R02. Include both human and agent views of the same state.
4. **Finish release and public consistency.** Resolve F07 and F08, then finish stale-session recovery, invitation receipts and delayed-payment confirmation. Review sign-in method retirement and work-address selection explicitly.
5. **Rehearse and release the exact accepted version.** Run R01 and R03 on the final artifact. Keep R04 as a separately measured capacity commitment.

No new production gate, account restriction or automatic permission change was implemented as part of this audit. The next work should repair the confirmed behavior and preserve the agreed product model.

## Reproducing the original findings and the repairs

The original baseline observations are preserved in `evidence.json`. The five historical probes below intentionally expect the old behavior and must be run against the audited `19da4852` source, rather than the repaired branch. In particular, the refresh and binding probes synchronize at boundaries that are now serialized, so they can wait indefinitely against repaired code.

The repository working copy contains the audit, machine-readable observations and five disposable probe scripts in `research/cloud-release-audit-2026-10-26/`:

```sh
node research/cloud-release-audit-2026-10-26/probe-refresh.js
node research/cloud-release-audit-2026-10-26/probe-bindings.js
node research/cloud-release-audit-2026-10-26/probe-billing.js
node research/cloud-release-audit-2026-10-26/probe-unpaid-read.js
node research/cloud-release-audit-2026-10-26/probe-recovery.js
```

The scripts use the repository Node dependencies. `probe-recovery.js` additionally needs the installed Playwright Chromium runtime. Each script removes its disposable data when it finishes. The probe for bindings coordinates separate processes at their read boundary to reproduce the race deterministically. The refresh probe coordinates two production CloudClient instances against the real disposable server. They do not alter the user's installed login, real libraries or Stripe account.

The repaired branch is checked with:

```sh
node test/run.js
npx playwright test test/cloud-release-recovery.spec.js test/cloud-account-linking.spec.js test/cloud-admin.spec.js test/email-render.spec.js test/sidebar-subscription.spec.js test/cloud-email-onboarding.spec.js --workers=2
```
