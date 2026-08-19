# Cloud account simplification audit

## Decision

Build SmallDocs Cloud around the normal case: one person signs in and has one paid Cloud account.

The internal workspace boundary remains because it holds billing, membership, encryption and access. The product calls it an account. A user sees an account selector only when that login genuinely belongs to more than one account.

There are no production Cloud users, so this work removes accidental behavior instead of preserving it behind compatibility code.

## What is wrong now

### Sign-in creates an account

Email and OAuth sign-in both create a Personal workspace. Reading the workspace or account APIs can create it too. A person who accepts a team invitation therefore receives:

- the team account they intended to join
- an unused Personal account
- a selector that makes the unused account look important

This is the root of most Personal versus Team language in the UI.

### Account selection is inconsistent

Settings, Library and Add to Cloud choose an account independently.

- Settings has a header select.
- Library has its own workspace menu.
- Add to Cloud can silently choose the first writable account.
- CLI callers can pass an account explicitly, but browser choice is not shared.

With two paid accounts, an upload can therefore land somewhere the person did not choose.

### Internal concepts leak into the product

Workspace type and project names appear in headings, menus, empty states and helper copy. The customer model already agreed for the first release is smaller:

- one Cloud account
- one Library
- tags for organisation
- permission groups for access

Projects may remain as an internal storage and encryption boundary for now, but they must not be part of ordinary navigation or document placement.

### Staging data exaggerates the edge case

Both current staging identities belong to a Personal account and a team account. That makes every review start in the uncommon multi-account state and encourages UI built around it.

## Target model

### Identity and account lifecycle

1. Signing in creates or retrieves a user identity only.
2. Choosing **Just me** and starting checkout creates one individual account.
3. Choosing **My team** and starting checkout creates one team account.
4. Accepting an invitation adds the identity to that team account. It does not create an individual account.
5. Cancelling billing changes the existing account entitlement. It does not create or switch accounts.
6. Deleted test accounts are removed rather than supported through a compatibility layer before production launch.

### One-account experience

When the login has one account:

- no account selector is rendered
- Settings uses the headings Overview, People, Connected machines and Billing
- Library opens that account directly
- Add to Cloud uses that account directly
- plan type appears only where it affects checkout or billing
- individual and team names do not appear as competing Cloud worlds

Team-only controls are capability based. People and invitation controls appear when the account supports membership. An individual account does not show an invitation UI.

### Multi-account experience

When the login has more than one account:

- one compact account switcher appears above the Settings navigation
- Library uses the same selected account and the same option labels
- switching persists the account ID in browser storage
- Add to Cloud uses the persisted account
- if no valid selection exists, Add to Cloud asks before uploading
- options use account names, such as `Josh Summers` and `SmallDocs`, not type labels such as `Personal Cloud` and `Team workspace`

The switcher follows the SmallCRM pattern: a compact left-aligned trigger with an initials mark, current account name, chevron, a short menu of accounts and a check on the active account. It is not rendered for one account.

### Projects

Projects stay internal during this release because document encryption and existing authorization use them. Each account receives one internal default project. Browser and CLI flows resolve that project automatically.

The following are removed from ordinary UI:

- project selectors
- project counts
- project membership language
- project names in Add to Cloud
- project navigation in Settings

Removing the project tables and encryption references is a separate storage migration and is not required to make the product model consistent.

## Implementation sequence

### 1. Stop creating accounts during authentication

- Remove Personal workspace creation from email verification.
- Remove Personal workspace creation from OAuth completion.
- Make workspace listing read only.
- Make account context fail clearly when the identity has no account.
- Add tests proving sign-in and list operations do not create an account.

### 2. Create the chosen account at checkout

- Extend account creation to accept `personal` or `team` explicitly.
- For Just me, create the individual account immediately before creating the Stripe Checkout Session.
- For My team, create the named team account immediately before creating the Stripe Checkout Session.
- Reuse an existing unpaid account on a checkout retry so Back and retry do not create duplicates.
- Keep the return path tied to the account that started checkout.
- Add tests for checkout cancellation, retry and successful return.

### 3. Add one selected-account utility

Create a small browser module that:

- validates an explicit account ID
- reads and writes one local storage key
- automatically resolves the sole account
- returns no selection when several accounts exist and no choice has been made
- clears a stored ID that is no longer accessible

Settings, Library and the document Cloud control use this module. Query parameters may override the stored choice for a direct link, then update it.

### 4. Simplify Settings

- Move the multi-account switcher to the top of the left sidebar.
- Remove the header select.
- Hide the switcher for one account.
- Use account names only in the menu.
- Remove Personal Cloud and Team Cloud helper copy.
- Hide People on individual accounts.
- Remove Projects and Agent access navigation. Connected machines remains a dedicated item.
- Keep text left aligned.
- Keep Billing plan details inside Billing.

### 5. Simplify Library and Add to Cloud

- Hide the Library account switcher for one account.
- For multiple accounts, use the shared selection and the same account names.
- Remove Personal and Team subtitles from Library options.
- Do not expose the internal default project.
- Upload directly when one writable account exists.
- Ask for an account when several exist and no choice is stored.
- Never silently select the first writable account.

### 6. Keep the CLI explicit

- With one account, CLI commands work without `--account`.
- With several accounts, commands require `--account` unless a later CLI preference is added.
- Error output lists the available account names and stable IDs.
- Project IDs remain an internal API detail and are not required from the user.

### 7. Replace staging fixtures

Before resetting staging:

- stop the staging service briefly
- archive the Cloud, auth and billing databases together
- record active Stripe test subscription IDs
- keep the archive under the existing staging backup boundary

Then create two separate demo identities:

- one identity with one paid individual account
- one identity with one paid team account

Create a third identity only when testing a team invitation. Do not give it an individual account.

Add a staging-only test sign-in endpoint guarded by all of:

- an explicit staging environment flag
- an exact email allowlist
- a high-entropy secret submitted in the request body
- normal rate limiting and no secret in URLs or logs

The route must not exist when the staging flag is absent. Production remains unable to enable it accidentally through an email value alone.

## Automated test matrix

### Server and store

- sign-in creates an identity and zero accounts
- workspace listing is read only
- Just me checkout creates one individual account
- team checkout creates one team account
- retry reuses the unpaid account
- invited team member receives no individual account
- account context resolves one account
- account context requires a choice for multiple accounts
- deleted or inaccessible stored account IDs are rejected

### Browser unit and Playwright

- individual-only Settings has no switcher and no People invitation UI
- team-only Settings has no switcher and does show People
- genuine multi-account Settings has the sidebar switcher
- Library hides its switcher for one account
- Settings and Library share a changed account choice
- Add to Cloud uploads directly for one account
- Add to Cloud asks for a destination for unresolved multiple accounts
- checkout Back, cancellation, retry and return preserve the document return path
- desktop and mobile layouts keep the switcher usable and text left aligned

### CLI

- one-account status and add need no account flag
- multi-account status and add return `account_selection_required`
- the error includes available account names and IDs

## Deployment and review gates

1. Run the Node suite and focused Cloud Playwright tests locally.
2. Deploy only to `cloud-staging.smalldocs.org`.
3. Verify the individual-only identity first. No account switcher should exist anywhere.
4. Verify the team-only owner and an invited member. Neither should receive an unused individual account.
5. Create one deliberate multi-account identity and verify the shared switcher.
6. Verify Add to Cloud cannot upload to an unchosen account.
7. Keep production Cloud hidden until the wider launch checklist is complete.

## Completion criteria

This simplification is complete when a normal paid user can sign in, open Settings, use Library and add a document without seeing the words workspace, project, Personal Cloud or Team Cloud, and without making an account choice they do not have.

The multi-account switcher is accepted when it appears only for a deliberate multi-account login and the selected account follows that person across Settings, Library and Add to Cloud.
