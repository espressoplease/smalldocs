---
title: SmallDocs Cloud-first product decisions
---
# SmallDocs Cloud-first: the decisions before implementation

Prepared 14 October 2026. This is a proposed product direction, grounded in the current code. No new onboarding flow has been implemented by this review.

## My recommendation

Make Cloud the default home for new users' documents. Use an emailed one-use link to verify the person and start their browser session. The page they reach should supply an install prompt that their agent can follow. Connect the agent through the existing device-authorization flow, then save its first document to a selected workspace.

An email link can replace the first emailed verification code. It cannot, by itself, sign every browser and agent into the same account. Browser sessions, CLI credentials and team membership are distinct things. Keep those distinctions in the implementation while presenting one short journey to the user.

Start with Cloud-first onboarding, rather than deleting local Markdown support. Agents can keep writing local files; those files become working copies of Cloud documents. Cloud-only storage is a later product decision about offline work, existing users and failed saves, not a prerequisite for this onboarding improvement.

The right place to start is the activation journey: verified person, usable workspace, connected installation, first saved document. Changing the CTA or installer before settling that journey would leave the hard decisions hidden in implementation.

## What the code already supports

| Area | Evidence in the reviewed checkout | What is still needed |
| --- | --- | --- |
| Homepage install request | `public/homepage-next.js` posts an email to `/api/install-interest`; `server.js` relays it to SmallCRM and returns success. The page then reveals a generic install command. | Sending the promised onboarding email, redeeming its challenge and connecting an account. Email collection is not verification. |
| Email authentication | `lib/cloud-auth.js` issues and consumes expiring, one-use email codes, resolves verified identities and creates browser sessions. | A one-use link redemption path, careful handling of existing sessions and a coherent onboarding continuation. |
| CLI sign-in | `cli/lib/cloud-commands.js` requests a device authorization, displays a URL/code, polls for approval and saves rotating access/refresh credentials. | Folding this into the install prompt and showing which installation the person is approving. |
| Cloud-first CLI | `sdoc setup --cloud --yes` selects the Cloud skill. `cli/bin/sdocs-dev.js` invokes `autoSyncOpen`, which creates or pushes Markdown with revision bindings. | A default onboarding setting and a clear save destination. It is not a watcher for every local edit. |
| Workspace and invitations | `lib/cloud-store.js` supports personal/team workspaces, email-bound invitations, roles, project grants and approved invite domains. | A verified user-to-administrator join-request flow. An invitation is currently initiated by a permitted member or administrator. |
| Billing | `lib/cloud-billing.js` and `lib/cloud-billing-lifecycle.js` enforce subscription access and payment lifecycle states. No subscription currently produces no read/write/search entitlement. Manual grants also exist. | A deliberate self-serve trial entitlement and expiry policy. Stripe trialing being mapped to active is not an implemented no-card free-month journey. |
| Referral offer | The new homepage says referrals can extend free usage. | Qualification, extension accounting and enforcement. I found no referral implementation in the reviewed auth, billing, server and CLI paths. |

This is a code-path review, not an audit of live production accounts or Stripe configuration. A private business-invitation page exists, but does not establish that a general self-serve trial has been built.

## A proposed first-use journey

`Email entered → Email received → Person verified → Workspace ready → Agent connected → Useful document saved`

`Trial activation` is an explicit event within this journey, not the homepage form submission.

`Email sign-in link` is private and expires. `Install prompt` can be copied to an agent and contains no reusable login secret. `Administrator request link` is a different capability and does not sign the administrator in as the requester.

`Log in` remains a recovery path for returning users. If someone already has an account, successful verification should resume it rather than create a second account or restart the trial.

`Cloud-first` should be visible in the first save: show the account/workspace, a confirmed document link, and a clear outcome if the upload fails.

## Three concrete scenarios

**Solo user with Gmail.** They request the email, redeem it on their phone, accept the account terms and get an install prompt. Their desktop agent installs the CLI and starts device authorization. They approve that named installation in the signed-in phone browser. The agent saves the requested document to their personal library. A browser on the desktop still needs its own session; the CLI credential does not create one automatically.

**Joe at ABC.com.** He follows the same path and can start a personal trial. He can copy a request link to his administrator without being told whether ABC.com already has a team. The administrator signs in, chooses an existing team or creates one, and approves Joe's membership. Joining should not silently move Joe's personal documents. Same-domain membership is not automatic unless the team explicitly chooses that policy.

**Remote agent.** The agent has no mailbox or interactive browser. It starts a named device authorization and sends the human its approval URL/code through their existing conversation. The person sees what is being connected and approves from their browser. The remote installation receives its own revocable credential. The person should not paste a long-lived personal token into the agent conversation.

## Decide these first

If you only answer eight items now, answer **1, 2, 5, 7, 9, 10, 13 and 17**. They determine the product promise, email/agent handoff, account activation, trial timing, team default and automatic-save boundary. The other decisions refine that shape and surface launch obligations.

The options below are suggestions, not added constraints. Each recommendation is a starting position to accept, change or leave undecided. Each question now has its context followed immediately by its answer control and an optional note. Save answers individually as you go; you can revise them while the feedback session is open. Choices begin as Undecided, and submitting feedback does not authorize deployment or accept account terms.

## Product promise

### 1. What are we launching?

**Recommended:** Cloud-first for new users. Make Cloud the normal onboarding and save destination first. Removing every local path is a separate, larger change.

**Alternatives:** Cloud-only for everyone; Keep Cloud optional.

```form
id: cloud_direction_1
fields:
  - name: product
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - Cloud-first for new users
      - Cloud-only for everyone
      - Keep Cloud optional
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 1
    final: false
```

### 2. Who changes first?

**Recommended:** New users; existing users opt in. Existing users have local documents and workflows. Offer migration without uploading their old files automatically.

**Alternatives:** Move all users immediately; A separate beta cohort.

```form
id: cloud_direction_2
fields:
  - name: migration
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - New users; existing users opt in
      - Move all users immediately
      - A separate beta cohort
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 2
    final: false
```

### 3. Can anyone read shared documents?

**Recommended:** Keep anonymous shared reading. Sharing should still work for a recipient who has never installed SmallDocs. Authoring and storage can require an account.

**Alternatives:** Require an account to read; Require accounts only for private shares.

```form
id: cloud_direction_3
fields:
  - name: reading
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - Keep anonymous shared reading
      - Require an account to read
      - Require accounts only for private shares
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 3
    final: false
```

### 4. Do agents still produce local Markdown?

**Recommended:** Keep local files as editable working copies. Agents already write files. Preserve that interface while Cloud becomes the durable library, with document IDs and revision bindings.

**Alternatives:** Create only remote documents; Let each user choose a primary store.

```form
id: cloud_direction_4
fields:
  - name: files
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - Keep local files as editable working copies
      - Create only remote documents
      - Let each user choose a primary store
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 4
    final: false
```

## Email and installation

### 5. What does the emailed link prove?

**Recommended:** Email ownership and browser sign-in. Redeeming a one-use email challenge can verify the address and sign in that browser. Sending an email alone does neither.

**Alternatives:** Email ownership only; Install permission only.

```form
id: cloud_direction_5
fields:
  - name: email
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - Email ownership and browser sign-in
      - Email ownership only
      - Install permission only
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 5
    final: false
```

### 6. What does the homepage promise?

**Recommended:** Email me an install prompt. The delivered page should contain an agent-ready prompt plus a terminal option. The prompt itself should contain no reusable account credential.

**Alternatives:** Get install link; Start my Cloud account.

```form
id: cloud_direction_6
fields:
  - name: cta
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - Email me an install prompt
      - Get install link
      - Start my Cloud account
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 6
    final: false
```

### 7. How is the agent installation authorized?

**Recommended:** One browser approval for that installation. Reuse device authorization: the person approves the machine or remote agent being connected. Avoid placing a mailbox sign-in secret in chat.

**Alternatives:** Email token directly authorizes an installation; Separate CLI login after install.

```form
id: cloud_direction_7
fields:
  - name: approval
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - One browser approval for that installation
      - Email token directly authorizes an installation
      - Separate CLI login after install
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 7
    final: false
```

### 8. How does a remote agent connect?

**Recommended:** Named revocable installation via device approval. Support a URL and code the human can approve from another device. A server cannot set a browser cookie on the agent machine by saving a CLI token.

**Alternatives:** Share the personal CLI credential; Dedicated agent accounts from day one.

```form
id: cloud_direction_8
fields:
  - name: remote
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - Named revocable installation via device approval
      - Share the personal CLI credential
      - Dedicated agent accounts from day one
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 8
    final: false
```

## Account activation and the free month

### 9. When does the account become usable?

**Recommended:** After verification and terms acceptance. Create a usable personal workspace and trial entitlement once the person activates. Typing an address is not activation or consent.

**Alternatives:** Immediately on email entry; Only after first document upload.

```form
id: cloud_direction_9
fields:
  - name: activation
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - After verification and terms acceptance
      - Immediately on email entry
      - Only after first document upload
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 9
    final: false
```

### 10. When does the free period start?

**Recommended:** Successful account activation. Activation gives a clear, reproducible start date without charging time before the person has opened the email.

**Alternatives:** First successful Cloud save; Homepage email submission.

```form
id: cloud_direction_10
fields:
  - name: trial_start
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - Successful account activation
      - First successful Cloud save
      - Homepage email submission
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 10
    final: false
```

### 11. What exactly is a free month?

**Recommended:** 30 days. Choose a precise clock and display the actual end date. Thirty days is a recommendation, not an existing product rule.

**Alternatives:** One calendar month; A metered document allowance.

```form
id: cloud_direction_11
fields:
  - name: trial_length
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - "30 days"
      - One calendar month
      - A metered document allowance
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 11
    final: false
```

### 12. Is a payment card required?

**Recommended:** No card; subscribe before expiry. No-card onboarding removes a substantial first-use step. Conversion then requires a deliberate paid subscription later.

**Alternatives:** Card at activation with automatic renewal; Different rules for teams.

```form
id: cloud_direction_12
fields:
  - name: trial_card
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - No card; subscribe before expiry
      - Card at activation with automatic renewal
      - Different rules for teams
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 12
    final: false
```

## Teams and administrator handoff

### 13. Where does a work-email newcomer start?

**Recommended:** Personal trial, with optional team handoff. Do not block someone while they find an administrator. Their personal documents should not silently become company documents later.

**Alternatives:** Require team approval before creating documents; Create a new team by default.

```form
id: cloud_direction_13
fields:
  - name: personal
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - Personal trial, with optional team handoff
      - Require team approval before creating documents
      - Create a new team by default
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 13
    final: false
```

### 14. How is the save destination chosen?

**Recommended:** Explicit workspace default with visible destination. Email identity, workspace membership and document ownership are separate. Make the first destination clear and remember a choice.

**Alternatives:** Infer it from the email domain; Choose a workspace on every save.

```form
id: cloud_direction_14
fields:
  - name: routing
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - Explicit workspace default with visible destination
      - Infer it from the email domain
      - Choose a workspace on every save
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 14
    final: false
```

### 15. What link can they send an administrator?

**Recommended:** Verified join-request link. A requester shares a link; an authenticated administrator chooses a team and approves. The link should not reveal which teams already exist.

**Alternatives:** Generic instructions to invite their email; Discover matching existing teams.

```form
id: cloud_direction_15
fields:
  - name: join
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - Verified join-request link
      - Generic instructions to invite their email
      - Discover matching existing teams
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 15
    final: false
```

### 16. Does a matching email domain grant membership?

**Recommended:** No; administrator approval still required. A company domain is a useful hint, not proof of permission. A Gmail user can also be invited by an administrator.

**Alternatives:** Join an approved domain automatically; Offer domain approval as an opt-in team policy.

```form
id: cloud_direction_16
fields:
  - name: domain
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - No; administrator approval still required
      - Join an approved domain automatically
      - Offer domain approval as an opt-in team policy
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 16
    final: false
```

## Saving, failure and permissions

### 17. When does an agent save to Cloud?

**Recommended:** On successful sdoc open and explicit CLI save. The existing Cloud-first path already creates or pushes when a Markdown file is opened with sdoc. Mere file edits do not necessarily mean a completed document.

**Alternatives:** Watch every Markdown file automatically; Only on an explicit upload command.

```form
id: cloud_direction_17
fields:
  - name: save
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - On successful sdoc open and explicit CLI save
      - Watch every Markdown file automatically
      - Only on an explicit upload command
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 17
    final: false
```

### 18. What happens when upload fails?

**Recommended:** Keep local work; report not saved; retry explicitly. A visible failed save protects the promise without destroying work. If a queue is chosen, it needs durable state and a clear queued status.

**Alternatives:** Queue for later automatic upload; Prevent opening until upload succeeds.

```form
id: cloud_direction_18
fields:
  - name: failure
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - Keep local work; report not saved; retry explicitly
      - Queue for later automatic upload
      - Prevent opening until upload succeeds
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 18
    final: false
```

### 19. What happens when both agent and human edit?

**Recommended:** Preserve both versions and ask to resolve. Revision bindings already exist. A write conflict should not silently discard a human edit or be misreported as saved.

**Alternatives:** Agent version always wins; Attempt automatic merging by default.

```form
id: cloud_direction_19
fields:
  - name: conflict
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - Preserve both versions and ask to resolve
      - Agent version always wins
      - Attempt automatic merging by default
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 19
    final: false
```

### 20. What can a connected agent access?

**Recommended:** Chosen workspace with scoped document permissions. The person should understand the destination and access scope. Fine-grained installation scopes require implementation work; user-level credentials alone do not establish them.

**Alternatives:** All workspaces the human can access; Only documents explicitly handed to it.

```form
id: cloud_direction_20
fields:
  - name: permissions
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - Chosen workspace with scoped document permissions
      - All workspaces the human can access
      - Only documents explicitly handed to it
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 20
    final: false
```

## Billing and document lifetime

### 21. Who pays after the free period?

**Recommended:** Personal account or team workspace. Match the existing personal/team pricing model. Decide what happens to an individual trial when they join a paid team.

**Alternatives:** Each agent installation; Document owner on every save.

```form
id: cloud_direction_21
fields:
  - name: billing
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - Personal account or team workspace
      - Each agent installation
      - Document owner on every save
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 21
    final: false
```

### 22. What happens when the trial ends unpaid?

**Recommended:** Keep reading and export; stop new writes. A read-only library preserves access to existing work and makes the paid boundary understandable. Do not make expiry erase documents.

**Alternatives:** Continue limited free writing; Block all access until payment.

```form
id: cloud_direction_22
fields:
  - name: expiry
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - Keep reading and export; stop new writes
      - Continue limited free writing
      - Block all access until payment
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 22
    final: false
```

### 23. How long do unpaid documents remain?

**Recommended:** Decide and disclose a retention period before launch. A free-month offer creates a storage obligation. Pick warning dates, export access and deletion timing together before promising retention.

**Alternatives:** Keep them indefinitely; Delete soon after trial expiry.

```form
id: cloud_direction_23
fields:
  - name: retention
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - Decide and disclose a retention period before launch
      - Keep them indefinitely
      - Delete soon after trial expiry
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 23
    final: false
```

### 24. What earns a referral extension?

**Recommended:** A referred new user activates and saves a document. Define successful sharing, extension amount, caps and repeat-account handling. The homepage already promises extensions, but the reviewed paths do not implement them.

**Alternatives:** The link is sent or clicked; Only when the referred user pays.

```form
id: cloud_direction_24
fields:
  - name: referral
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - A referred new user activates and saves a document
      - The link is sent or clicked
      - Only when the referred user pays
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 24
    final: false
```

## Trust, activation and rollout

### 25. What does encrypted Cloud storage mean?

**Recommended:** Describe the existing server-managed encryption. Do not conflate encrypted public short links with Cloud storage. A new encryption model changes search, agent access, recovery and key management.

**Alternatives:** Promise end-to-end encryption for Cloud; Offer both encryption models.

```form
id: cloud_direction_25
fields:
  - name: privacy
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - Describe the existing server-managed encryption
      - Promise end-to-end encryption for Cloud
      - Offer both encryption models
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 25
    final: false
```

### 26. How does the user get their first document?

**Recommended:** Ask the agent for one useful document, then confirm saved. Onboarding is complete when the person sees a useful Cloud document on web/mobile, not merely when the CLI binary exists.

**Alternatives:** Automatically upload an example; Land in an empty library.

```form
id: cloud_direction_26
fields:
  - name: first_doc
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - Ask the agent for one useful document, then confirm saved
      - Automatically upload an example
      - Land in an empty library
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 26
    final: false
```

### 27. What is the primary activation measure?

**Recommended:** Verified user with installation connected and first save. Instrument the intermediate steps separately so failed delivery, unclaimed links, device approval and upload failures can be distinguished.

**Alternatives:** Email addresses collected; CLI downloads.

```form
id: cloud_direction_27
fields:
  - name: measure
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - Verified user with installation connected and first save
      - Email addresses collected
      - CLI downloads
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 27
    final: false
```

### 28. How do we release the change?

**Recommended:** End-to-end beta before switching homepage onboarding. Validate delivery, cross-device use, existing accounts, team requests, trial expiry and recovery together before increasing traffic.

**Alternatives:** Replace the main flow in one release; Launch email collection while onboarding remains manual.

```form
id: cloud_direction_28
fields:
  - name: rollout
    type: select
    label: Your choice
    help: null
    default: Undecided
    options:
      - Undecided
      - End-to-end beta before switching homepage onboarding
      - Replace the main flow in one release
      - Launch email collection while onboarding remains manual
      - Different approach, explain below
  - name: comment
    type: textarea
    label: Notes for this decision (optional)
    rows: 2
buttons:
  - name: save
    label: Save answer 28
    final: false
```

## Implementation order after decisions

1. **Specify activation states.** Define requested, verified, activated, installation connected and first document saved. Make retries resume these states without duplicate accounts or trials.
2. **Build the email-to-browser path.** Connect the homepage request to a transactional email and one-use redemption. Show a clear Continue action before consuming the challenge, since mail clients and scanners may fetch links. Treat verification, terms acceptance and installation approval as separate events.
3. **Add the trial entitlement.** Use the chosen start event and expiry policy. Test existing users, existing paid teams, repeated requests and account reactivation. Do not use an unlimited manual grant as a substitute for a bounded trial.
4. **Connect the agent.** Deliver an install prompt that installs the CLI, authorizes that installation, selects its workspace and enables the Cloud skill. Support Windows, missing Node, remote machines and a person opening the email on another device. The existing shell installer still needs Node.
5. **Confirm the first save.** Return the document URL and a durable saved result; preserve local work on network failures. Test repeat saves and concurrent human/agent edits.
6. **Add administrator handoff and referrals.** These are separate flows. Team approval establishes membership; a referral grants promotional time. Neither is an email-verification shortcut.
7. **Align the public promise.** Change the homepage, onboarding email, CLI setup, agent skill, pricing and privacy language together. The current standard skill describes optional Cloud and local viewing as the default, so a Cloud-first launch needs a versioned skill change.

## Verification that matters before launch

Exercise delivery and expired/resend links; mail-link fetches without redemption; existing accounts; a browser already signed in as someone else; replayed and forwarded capabilities; phone-to-desktop and remote-agent approval; missing Node and Windows installation; repeated activation; missing/expired trial entitlements; failed uploads; conflicts; joining a paid team; and a trial expiring while the agent is working.

For email changes, use the existing Mailpit workflow in `maintainers/email-testing.md`, plus staging delivery checks. For auth, build on the existing email-code and CLI/device tests. For Cloud-first behavior, build on create/push and revision-binding tests. Validate one complete journey, not only isolated happy-path endpoints.

## Final notes

Save each answer beside its question. Add any overall feedback here, then finish when you are ready. Answers are stored in this local document.

```form
id: cloud_direction_notes
fields:
  - name: notes
    type: textarea
    label: Changes, exceptions or questions
    placeholder: Refer to the decision numbers where helpful.
    rows: 6
buttons:
  - name: finish
    label: Save final notes and finish
    final: true
```

## References and review boundary

Code reviewed in the homepage worktree on 14 October 2026: `server.js`, `public/homepage-next.js`, `lib/cloud-auth.js`, `cloud/auth/http.js`, `cli/bin/sdocs-dev.js`, `cli/lib/cloud-commands.js`, `cli/lib/setup.js`, `lib/cloud-store.js`, `lib/cloud-billing.js`, `lib/cloud-billing-lifecycle.js`, `public/cloud-business-invite.js`, and `maintainers/email-testing.md`.

[OAuth device authorization, RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html) supplies the relevant device-flow model. [Cross-device security, RFC 10027](https://www.rfc-editor.org/rfc/rfc10027.html) covers the need to make the source of an approval request understandable. These support keeping an explicit installation approval in the proposed journey.

[OWASP's token guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) supports random, expiring, one-use challenges and responses that do not disclose account existence. That source discusses password recovery; applying those token properties to this onboarding link is a design inference, not a claim that the flows are identical.

The recommended timings, trial behavior, team handoff and scope model are proposals. They need your product decisions before being turned into a build specification.
