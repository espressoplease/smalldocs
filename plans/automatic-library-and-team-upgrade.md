---
title: Automatic libraries and team upgrades
---

# Automatic libraries and team upgrades

A proposed implementation plan for SmallDocs Cloud. This updates the earlier onboarding plan: normal signup should not ask someone to start a personal library. Signing in prepares their library; they can later turn it into a team library or join an existing team.

**Status:** implemented locally on `codex/homepage-next-review`. Automatic signup, in-place conversion and paid subscription replacement are implemented locally. Production behaviour is unchanged. Bulk sharing is a recorded follow-up, not part of this conversion change.

## 1. The experience we want

One login identifies a person. A library holds documents and has its own billing. Someone can belong to several libraries, but signup should not force them to understand that model.

After authentication and any required Terms or profile steps, a new user lands on **Install**, inside the existing Cloud settings interface. Their library is ready. The account box shows their name, and their email is visible. They can connect an agent and open the library.

There is no “Start my library” button and no mandatory personal-versus-team choice.

Two secondary actions remain available:

- **Create a team:** turn this initial library into a team library, with team pricing replacing personal pricing.
- **Join a team:** accept an invitation or create a private request link. Joining another library does not move personal documents into it.

A Gmail address and a work address both get a usable starting experience. An email domain does not establish company ownership or team membership.

## 2. What is agreed, and what still needs a decision

| Topic | Direction |
| --- | --- |
| Normal signup | Automatically provision a personal library after required onboarding steps. |
| First-time founder creates a team | Upgrade the same library, rather than create a second billed library. |
| Existing paid personal account upgrades | Replace its subscription plan, rather than start a second subscription. |
| Joining an existing team | Keep the personal library separate. No automatic personal subscription. |
| Personal trial expires | Documents remain readable; continued personal saving requires payment. |
| Agent access | Browser and CLI use the same account permissions and underlying operations. |
| Remaining trial on team upgrade | Confirmed: retain the original trial end date. Team member/resource allowances remain to be decided. |
| Paid upgrade timing | Recommended: immediate upgrade with a displayed billing adjustment. Needs confirmation. |
| New personal library after conversion | Recommended: create only on explicit request, with no renewed free month. Needs confirmation. |

Prices discussed are £4/month for personal and £7/month per team member, including the owner. UI should use the existing localised price source, not hardcoded GBP. These are product assumptions for this plan, not a check of the live Stripe catalogue.

## 3. Signup and destination scenarios

| Scenario | Destination and result |
| --- | --- |
| New Google user with a complete name | After required Terms acceptance, provision the library and open Install. |
| Google supplies a partial or missing name | Capture missing details, provision once, open Install. |
| New email user | Verify email, accept required Terms, capture details, provision once, open Install. |
| New user follows a valid team invitation | Preserve invitation through sign-in and profile capture; accept it and open that team's Install tab. Do not provision an unused personal library on this path. |
| User declines an invitation | Offer their own library as the next step; provision it if they continue normally. |
| Invitation expires during signup | Explain the invitation expired. Offer normal signup or a replacement invitation; do not silently put them in another team. |
| Existing personal user signs in | Open their existing library or selected destination. Preserve current billing and trial dates. |
| Existing team-only member signs in | Open an accessible team or library selector. Do not create a personal library merely because it is absent. |
| Existing user follows another team's invitation | Accept into that team and select it. Keep other libraries and subscriptions unchanged. |
| Work-email user has no invitation | Open their new library. Offer Join a team as a secondary action. Reveal no colleague names or team directory. |
| Returning user belongs to several libraries | Respect an explicit accessible workspace in the URL, otherwise last selected accessible library, otherwise show their own accessible choices. |
| Another sign-in method uses an email with an existing identity | Follow existing identity linking and trial eligibility rules. Do not silently merge accounts or issue a new trial. |

Automatic provisioning belongs in one shared server operation. Google callbacks, email verification continuations, profile completion and retries should converge on it, rather than each creating workspaces independently. Missing profile details need not prevent identity creation; provision after the required details are complete.

## 4. Creating a team from the initial library

Example: Josh signs up on October 15 and starts writing documents. On October 20 he decides to invite colleagues.

1. Josh chooses **Create a team** from his library settings.
2. He enters the team name.
3. SmallDocs shows the library being converted, its document count, current billing and proposed team billing.
4. It explicitly explains: **“This library will become a team library. Review document access before inviting colleagues.”**
5. Josh confirms the conversion and any payment or trial choice.
6. The same workspace becomes a team workspace. Josh remains its owner.
7. The existing team settings and invitation controls become available.

Keep the workspace ID, project IDs, document IDs, revision histories, comments, tags and existing document URLs. Existing CLI bindings must continue to refer to the same documents. Conversion must not copy documents into a second workspace.

### Document access is part of the transition

Code audit: new documents receive a custom permission group containing their creator only. Document access requires active workspace membership plus either creator ownership, an explicit document grant, or the document's everyone setting. Workspace owner/admin status and project edit access do not by themselves bypass document permissions. Legacy document migrations can preserve additional historic grants, so conversion review must inspect actual document groups rather than assume every existing document is creator-only. Consequently, converting the workspace kind alone need not share existing private documents. Documents already set to everyone are different: future active team members would gain edit access if that setting remains unchanged. Recommended conversion behaviour is to preserve each document's existing setting and show the count already set to everyone before confirmation. This recommendation awaits the user's decision.

Personal documents may include material Josh does not want colleagues to see. “Same library” must not mean silently exposing everything to future members.

Audit the current project and document permission defaults before implementation. The confirmation must explain the resulting visibility. Preserve explicit private access wherever the permission model supports it; do not broaden access as an incidental database change. If converting a default project would expose its contents, show that fact and provide a meaningful access review before inviting anyone.

For someone who wants to keep personal material separate, offer a secondary **Create a separate team library** path. Show that it is a separate library with separate team billing, and leave any personal paid plan unchanged unless the user explicitly cancels it. This is an intentional exception to the default upgrade flow, not the path for a first-time team founder.

## 5. Trial and subscription scenarios

| Starting state | Proposed result when creating a team |
| --- | --- |
| Personal trial, no card | Convert the library and preserve its original trial deadline. Team trial member and storage limits require a product decision. Collect payment details when subscribing. |
| Trial expired, no subscription | Show team pricing and payment flow. Do not reset the free month. Team writes and invitations become available when the required entitlement is confirmed. |
| Active paid personal subscription | Modify the existing provider subscription to team pricing. Show effective date, seat count, currency, tax treatment and any immediate adjustment before confirmation. |
| Personal cancellation scheduled | Explicitly show whether upgrading resumes billing and removes scheduled cancellation. Do not silently reactivate a cancelled plan. |
| Past-due or otherwise restricted subscription | Explain the current billing state and resolve payment or present the supported upgrade path. Do not bypass the existing restriction by creating another subscription. |
| Already upgraded | Return the existing team state. A retry must not charge again or create another team. |
| Upgrade payment cancelled or fails | Keep the current library and entitlement usable according to its previous state. Do not leave the user paying for personal while accidentally receiving a second team subscription. |
| Downgrade requested later | Treat as a separate designed flow involving members, permissions and limits. Do not implement an automatic reverse conversion in this build. |

### Recommended trial policy

Preserve the original free-month deadline on conversion. Converting on October 20 does not move the October 15 signup's deadline into a new month. The trial record survives conversion, so neither another login nor another personal library resets eligibility.

This requires extending the current personal-only trial entitlement to support a team trial. It is not existing behaviour. Decide team trial seat and resource allowances before enabling invitations under that trial. The implementation must state whether accepting a member creates a charge now or only affects the amount due after trial.

### Recommended paid upgrade policy

Upgrade the existing Stripe subscription item, rather than running new-subscription checkout. Obtain a provider billing preview and show it before confirmation. Choose and document the exact treatment of prorations, billing anchor, pending cancellation and failed payments. Do not describe the result as a guaranteed refund or credit until provider behaviour is implemented and tested.

For example, a one-member team has one team seat. Josh does not pay a personal fee plus an owner seat fee for the same converted library. Additional members increase the team seat quantity through the existing membership billing flow.

## 6. Joining Bob's existing team

Joining a team is not conversion. Bob's team and Josh's personal library retain their identities, documents and billing.

- Bob's team pays for Josh's seat according to its plan.
- Josh does not start a personal paid subscription by accepting the invitation.
- If Josh has an unpaid personal trial, it continues to its original deadline and can become read-only.
- If Josh already pays for a personal library, joining does not silently cancel it. Show both plans clearly and offer the existing cancellation flow.
- Leaving Bob's team removes that access according to current membership rules. It does not transfer company documents to Josh or restart a personal trial.
- Choosing which library an agent saves into must be explicit when several are available. Existing document bindings continue targeting their original library.

For company request links, change the current “Request received” wording to **“Your request link”**, followed by **“Send this link to your team administrator to request an invitation.”** Nothing is automatically sent. Existing expiry, cancellation, same-domain reviewer checks and explicit invitation acceptance remain applicable.

## 7. CLI and agent parity

An authenticated agent acts as its human, with the same roles and entitlements. It receives no extra authority from being an agent.

Proposed command surface, names to finalise against existing CLI conventions:

| Action | Expected CLI result |
| --- | --- |
| Inspect onboarding | Profile completeness, accessible libraries, selected library, trial and billing status, next action. |
| Complete profile | Update the human's supplied name, then return their destination. |
| Prepare initial library | Idempotent shared provisioning operation, returning workspace ID and Install URL. |
| Request team access | Create a handoff link using the user's requested note and consent, retrieve status, or cancel. |
| Review and invite | An authorised admin can review a supplied request and prepare or issue an invitation under the same rules as the browser. |
| Accept invitation | Show the destination team and any relevant consequences, then accept with the user's authorization. |
| Upgrade library | Return a preview of the selected library, access implications, seat count and billing change; confirm or return a browser completion URL where required. |
| Configure document destination | Select account for new documents while preserving existing file bindings. |

Every command should provide structured JSON, stable errors and an actionable continuation URL when browser interaction is needed. Help and the Cloud skill must explain which actions send notifications, alter access or affect billing. Agents still need the user's instruction before sending an invitation or accepting a charge on their behalf.

Human authentication, Google consent, required Terms acceptance and payment entry retain their browser steps. Current recent-browser requirements must be reviewed action by action; merely adding CLI flags will not make these endpoints usable by agents. Reuse the existing credential model and authorization checks.

After document creation or save, an agent links to the **returned Cloud document URL**, never the local Markdown file.

## 8. What the code already does

This assessment is from the current branch, not a claim about the deployed release.

| Area | Current behaviour | Required change |
| --- | --- | --- |
| Signup | Profile flows into a library-choice screen. | Resolve destination and provision automatically on the normal new-user path. |
| Personal creation | `/api/cloud/v1/onboarding/personal` provisions idempotently after a button click. | Extract shared provisioning and preserve idempotency across all entry paths. |
| Trial | `lib/cloud-billing.js` tracks one personal calendar-month trial per user and verified-email eligibility. | Preserve eligibility across conversion; represent agreed team trial policy explicitly. |
| Workspace | `lib/cloud-store.js` records personal/team kind and encrypted names, projects and keys. | Implement owner-authorised in-place conversion and audit its permission consequences. |
| Checkout | `server.js` requires plan to match workspace kind and rejects an existing active or past-due subscription. | Add a distinct upgrade path; new-subscription checkout cannot implement this transition. |
| Stripe portal | Local maintainer notes say plan changes are disabled. | Do not assume portal upgrades already work; verify configuration in sandbox during implementation. |
| Membership | Existing invitations and seat synchronisation are reused by the branch. | Apply the same trial/paid transition semantics during invitation acceptance. |
| CLI | Document operations exist; much of onboarding is browser-only. | Add supported onboarding/team commands and test real bearer credentials. |

The existing personal-workspace uniqueness rule allows one active personal workspace per creator. After changing its kind to team, an automatic “ensure personal” call could create a replacement personal library. Destination resolution therefore needs to distinguish a genuinely new signup from an existing user whose original library was converted.

## 9. Reliable upgrade processing

Provider billing, auth and document storage do not share one atomic transaction. Model upgrade as a persisted operation attached to the existing workspace, with stages such as preview, awaiting confirmation, awaiting provider, completed and failed.

- Bind a billing preview to the workspace, current subscription version, proposed plan and seat quantity. If they change before confirmation, return an updated preview.
- Use one operation identifier for retries and provider idempotency.
- For paid upgrades, treat the browser return as navigation. Verify provider state through the authoritative response or webhook before finalising entitlements.
- Reconcile cases where provider billing changed but local conversion did not finish. A retried request or recovery job must complete the same operation.
- Keep invitation acceptance and seat reconciliation consistent if the member count changes during an upgrade.
- Preserve existing document identity and encryption access. Verify key-provider assumptions before deciding whether conversion requires any key changes.
- Record who initiated the conversion, the previous/new kind and billing identifiers in the existing audit pattern.

These are implementation requirements for achieving one upgrade without duplicate billing, rather than a new approval workflow for every ordinary action.

## 10. Implementation order

### Phase 1: Automatic signup

Extract the shared provisioning operation. Route new normal signups through it after required details and Terms. Preserve explicit invitation continuations and existing-user destinations. Replace the mandatory choice page with optional team actions inside settings. Test repeated callbacks, concurrent tabs and incomplete profiles.

### Phase 2: Conversion and trial semantics

Add an owner-only conversion preview and operation. Preserve IDs, audit permissions and implement the confirmed trial policy. Make team naming and invitation controls available in the existing settings shell. Verify converted users do not receive an unwanted replacement personal library on later sign-in.

### Phase 3: Paid subscription replacement

Implement the provider billing preview and subscription-item update in sandbox. Reconcile webhooks, payment failure and recovery. Verify there is one subscription for the converted library and that paid entitlement matches the effective provider plan.

### Phase 4: Agent support

Expose the supported operations through authenticated API and CLI, with structured output and browser continuations. Update help, Cloud skill version and agent changelog. Use an isolated clean-context agent test to check onboarding discovery and returned document URL usage when requested.

### Phase 5: End-to-end review and rollout

Extend the disposable backend preview with the scenarios below. Show desktop and mobile journeys, then review sandbox billing evidence before production release. Existing customers retain current libraries and subscriptions; do not mass-convert them.

## 11. Acceptance tests

1. Google and verified-email signup create one library without a “Start” click.
2. Missing-name and Terms steps preserve intended destination and invitation tokens.
3. Repeated callbacks and concurrent browser requests create one library and one trial.
4. A new invitee lands in the invited team without an unused personal library.
5. Existing team-only users and converted founders receive no new personal library on sign-in.
6. Trial conversion retains the original expiry and the confirmed team allowances.
7. Conversion preserves all document URLs, revisions, comments, tags and CLI bindings.
8. Access review accurately describes what an invited member can read; conversion alone does not silently broaden access.
9. A paid upgrade replaces the subscription item with no second subscription or overlapping personal fee.
10. Billing preview and final invoice agree on seats, currency, tax and adjustment.
11. Payment failure, abandoned checkout, scheduled cancellation and past-due states produce the documented outcome.
12. Duplicate, delayed and out-of-order webhooks plus a crash between billing and conversion converge to one consistent result.
13. Joining another team preserves personal content; unpaid personal trial expiry does not prevent writing in the paid team.
14. Existing personal subscribers see their separate plan when joining a team and can cancel deliberately.
15. Concurrent invitations, acceptance and upgrades converge on the correct seat quantity.
16. Trial eligibility cannot be renewed through conversion, another identity or replacement personal library.
17. Non-owners and agents without the required role cannot convert or change billing.
18. Browser and CLI return equivalent state, error codes and selected library.
19. Mobile settings, upgrade review, request links and billing confirmation remain readable and usable.
20. No scenario sends a request or invitation merely by displaying its page.

## 12. Decisions before coding the transition

The core direction is agreed. The remaining commercial choices are small but affect implementation:

1. **Team trial:** original deadline confirmed. What member/resource allowances apply during it?
2. **Paid upgrade:** apply immediately with a displayed adjustment, or schedule for renewal? Immediate is recommended if team access begins immediately.
3. **Personal library after conversion:** offer explicit creation without a renewed trial? Recommended.
4. **Existing private content:** confirm the access model after auditing current project defaults, then make its effect visible in conversion review.

Implementation update: normal signup, trial conversion and paid subscription replacement now run locally on the current branch. Trial conversion retains the original deadline and uses the existing configured team limits. A paid upgrade applies immediately with a provider invoice preview; scheduled cancellation is preserved. A separate personal library is still explicit and cannot restart the original trial. Existing document access settings are preserved. The mandatory library-choice step has been removed from normal signup. CLI onboarding parity and bulk sharing remain follow-ups; provider transport tests do not replace a live Stripe sandbox rehearsal before release.


## 13. Bulk sharing after solo use: James's first teammate

James uses SmallDocs alone for three weeks. His documents default to Only you. When he converts his library and invites a teammate, those documents stay private. Joining a library must not implicitly change their access settings.

Recommended follow-up: an explicit **Share existing documents** action from the library. Let James select all his documents or a subset, inspect their current access, then choose **Everyone in this team** or named members. Show the number and scope before applying. Everyone includes future team members and currently grants editing, not just reading. Named access includes only the selected active members. Do not automatically publish documents, create public links or send a notification as part of changing access.

The People area can offer a secondary link to this action after an invitation is accepted: **Share documents with your team**. It should lead to the same bulk selection interface, not another sharing mechanism. An invitation being issued does not mean its recipient has joined yet. Existing documents and defaults for future documents are separate settings; this bulk action changes only the explicitly selected existing documents.

Agents already have single-document access updates:

```sh
sdoc cloud access DOCUMENT_UUID --everyone --json
sdoc cloud access DOCUMENT_UUID --member USER_UUID --json
sdoc cloud access DOCUMENT_UUID --only-you --json
```

Record bulk CLI support as a required follow-up: allow a series of explicit document IDs with a review/dry-run result showing each title, account and before/after access. Use the same underlying permissions as the UI. Only a document's creator can change its access today; being a team owner must not silently elevate an agent's document permissions. A set-members operation replaces that document's explicit member list, so an additive share action needs to read and preserve existing grants rather than remove them accidentally.

Bulk operations must report per-document results and any partial completion honestly, support retries, and refuse unauthorised documents. The user should be able to save the prior settings for restoring access; removing access cannot undo content someone already copied. James's private-by-default onboarding and deliberate bulk sharing should work identically from the browser and an authenticated CLI acting on his instruction.

This recommendation follows established product patterns: [Notion distinguishes private pages from workspace sharing](https://www.notion.com/help/share-your-work), and [Google Drive supports explicit multi-item sharing and inherited folder access](https://support.google.com/drive/answer/7166529?hl=en). SmallDocs should reuse its existing document access model rather than introduce folder inheritance in this build.
