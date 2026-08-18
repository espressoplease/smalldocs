# SmallDocs Cloud simplification plan

## Objective

Replace the current workspace and project experience with one account, one Library, document-level access, and tags.

Build and review an interactive staging prototype before changing the Cloud database, API, billing flow, or CLI. The prototype is the decision surface. It should use the real SmallDocs layout and controls but fake all people, permissions, invitations, tags, and billing state.

## Working direction

These are the ideas currently carrying forward:

- A Cloud account is either **Just me** or **My team**.
- An account has one Library. Users do not see workspaces or projects.
- A document has one permission group and zero or more tags.
- New documents default to **Only you**.
- Permission groups can contain existing account members.
- Tags describe the document. Permissions control who can open it.
- Local Markdown tags keep the same names when the document is added to Cloud.
- The browser UI and CLI use the same tags and permission-group resources.
- Agent credential scopes are deferred. The first CLI uses the permissions of the signed-in user.

## Stage 1: interactive UI prototype

### Delivery

Add an unlinked staging-only prototype route using the existing Cloud feature flag. It should not call the real Cloud APIs or change Stripe, invitations, documents, or account data.

The prototype should render inside the actual SmallDocs document page, using the current typography, spacing, buttons, right-hand panel, responsive behavior, and theme handling. Fixture controls may sit in a small prototype toolbar so we can switch state without creating accounts.

### States to simulate

| State | What it should demonstrate |
| --- | --- |
| Personal, local document | Add to Cloud with `Only you` and existing local tags |
| Personal, Cloud document | Saved state, Cloud tags, revision action and access pill |
| Team, owner only | `Only you`, team members available in the panel |
| Team, several people | `You, TS, LT, DS` with the multiple-user icon |
| Team, everyone | An explicit `Everyone` preset |
| Pending invitation | Invited email, pending state and billing explanation |
| Desktop | Right-hand panel and hover or focus details |
| Mobile | Tap behavior and responsive panel or sheet |

### Document controls

Prototype a compact Cloud area containing:

- Add to Cloud or Save to Cloud
- One permission pill
- Current tag pills
- A plus control that opens the relevant panel
- A clear saved, saving, error and conflict state

Permission examples:

- Single-user icon plus `Only you`
- Multiple-users icon plus `You, TS, LT, DS`
- Hover, keyboard focus, or tap detail listing full names

The main surface should show one permission pill representing the complete current access set. Member selection and presets live in the right-hand panel so the document toolbar does not become a second settings page.

### Access panel

The access panel should prototype:

- Current permission group
- Only you and Everyone presets
- Account members with selected and unselected states
- Create a permission group by selecting members
- Invite someone by email
- Pending invitation state
- Expected seat-price change before sending an invitation
- A warning when editing a reusable group would affect other documents

No real invitation is sent in this stage.

### Tag panel

The tag panel should prototype:

- Current document tags
- Add, remove and search
- Frequently used personal tags
- Frequently used accessible team tags
- A Cloud indicator that does not change the underlying tag name
- A local or Cloud freshness state when the two document versions differ

Tag suggestions must never imply that inaccessible document tags would be visible.

### Prototype review gate

Do not begin the schema rewrite until the prototype has been reviewed on desktop and mobile and the confirmation list below has explicit answers.

## UI confirmation list

### Account and checkout

- Confirm the labels **Just me** and **My team**.
- Confirm whether a login may belong to more than one account at launch.
- Confirm whether team billing starts with the owner as seat one.
- Confirm the display-name field and where it appears.
- Confirm the exact return experience after checkout.

### Document permissions

- Confirm whether every document has exactly one permission group.
- Confirm whether custom permission groups are reusable across documents or copied as a one-off member set.
- Confirm whether editing a reusable group changes every attached document.
- Confirm whether team documents default to Only you or Everyone.
- Confirm whether selected members can both read and edit in the first version.
- Confirm the initials format, tooltip content and overflow treatment for larger groups.

### Invitations and billing

- Confirm whether an invitation is billed when sent or when accepted.
- Confirm whether a pending invite can immediately be attached to a document.
- Confirm the billing disclosure shown before inviting.
- Confirm what happens to document access when an account member is removed.

### Tags and Library

- Confirm whether the Cloud icon appears on every tag pill or once for the tag section.
- Confirm that a local tag and Cloud tag with the same text are one logical tag.
- Confirm whether the Library is one combined view or retains an explicit Local and Cloud switch.
- Confirm how a linked local and Cloud document appears in Library results.
- Confirm how tag changes are reconciled when local and Cloud versions diverge.

### Responsive behavior and copy

- Confirm whether the right-hand panel becomes a bottom sheet or full-screen panel on mobile.
- Confirm all empty, loading, invitation, payment, save, conflict and permission copy.
- Confirm that hover information is also available by keyboard and touch.

## Stage 2: product contract and data model

After prototype approval, write the API contract and tests before replacing storage.

Target resources:

- accounts
- account members
- invitations
- permission groups
- permission-group members
- documents and revisions
- document tags
- subscriptions and seats
- audit events

Documents attach directly to an account and permission group. Remove project IDs from document creation, listing, search, encryption context, audit records and billing limits.

Decide whether document encryption uses an account data key or an independently wrapped document key. Record the privacy, migration and operational consequences before implementation.

## Stage 3: signup, identity and billing

- Add Just me and My team to the Cloud signup flow.
- Collect an editable display name.
- Create the account and initial Only you permission group.
- Create the Everyone group for team accounts.
- Attach the Stripe subscription directly to the account.
- Count accepted active team members as seats.
- Return to the original document after successful checkout.
- Preserve the document locally during the Stripe round trip.

Acceptance requires successful checkout, cancellation, retry and return testing without losing the open document.

## Stage 4: permissions and invitations

- Add APIs to list, create and inspect permission groups.
- Add document permission-group assignment.
- Add member listing and invitations.
- Add pending, accepted, revoked and removed states.
- Synchronize accepted team seats with Stripe.
- Record permission and membership changes in the audit log.
- Enforce access consistently for document reads, search, revisions, history, restore and deletion.

The browser controls from the approved prototype then connect to these APIs without redesigning the UI.

## Stage 5: tags and local-to-Cloud identity

- Preserve existing YAML tags during first upload.
- Keep one tag string and meaning across local and Cloud documents.
- Add accessible-account tag counts and suggestions.
- Persist a durable link between a local file and its Cloud document ID.
- Ensure reopening or renaming the local file updates the same Cloud document.
- Define and display local, Cloud, and local-plus-Cloud states.
- Prevent an accidental second Cloud document when a linked file is added again.

## Stage 6: Library

- Remove workspace and project controls.
- Render document permission state where useful without making it a primary navigation system.
- Use tags for filtering and discovery.
- De-duplicate linked local and Cloud entries if the combined Library is approved.
- Retain clear location and freshness indicators.
- Keep search authorization scoped to documents the user can access.

## Stage 7: CLI and agent workflow

Update the zero-dependency CLI and its machine-readable output.

Initial commands:

```text
sdoc cloud status [--json]
sdoc cloud members [--json]
sdoc cloud tags [--json]
sdoc cloud permission-groups [--json]
sdoc cloud add FILE --permission-group ID --tag TAG
sdoc cloud push FILE
sdoc cloud access DOCUMENT_ID --permission-group ID
sdoc cloud tag DOCUMENT_ID --add TAG --remove TAG
```

Rules:

- New documents default to Only you when no audience is supplied.
- An explicit requested audience may be resolved and assigned from listed account members.
- Existing documents preserve their permission group unless the command explicitly changes it.
- Existing tags are preserved unless explicitly changed.
- Human output explains the result. JSON output uses stable IDs and fields.
- Agent credential scopes, independent service identities and automatic paid invitations remain deferred.

## Stage 8: migration and test matrix

Cloud is not enabled in production, so prefer removing the old model rather than maintaining a permanent compatibility layer.

Before resetting staging Cloud data, confirm the exact files, accounts, subscriptions and invitations that will be removed. Stripe test subscriptions and the Cloud staging database need coordinated cleanup.

Required automated coverage:

- Personal and team signup
- Checkout success, cancellation and return
- Only you, custom group and Everyone access
- Owner, selected member, unselected member and removed member authorization
- Invitation acceptance and seat synchronization
- Permission changes across read, search, revision, restore and delete
- Local tag upload and Cloud tag changes
- Durable local-to-Cloud document identity
- CLI human and JSON output
- Desktop and mobile permission and tag panels
- Sign-in, sign-out and service-worker cache isolation

Required staging flows:

1. New personal user pays, returns and adds the open document.
2. Team owner pays, invites members and shares a document.
3. Invited member signs in on desktop and mobile and opens the document.
4. An unselected account member cannot discover or open it.
5. The CLI lists tags and permission groups, then creates and updates a document.
6. A member is removed and loses access while billing updates correctly.
7. The subscription is cancelled and account behavior matches the agreed policy.

## Release boundary

Keep all new Cloud UI behind the existing production feature flag. Deploy each accepted stage to Cloud staging. Production remains unchanged until the UI confirmation list, automated matrix, staging flows, monitoring, legal pages, tax decisions and paid-launch checklist are complete.
