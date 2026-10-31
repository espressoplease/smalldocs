# Single-plan libraries implementation

## Product behaviour

- Signing in and completing the profile creates an initial library when the person has none. The normal route goes straight to Install, without an intermediate account-type choice.
- Libraries have owners, members and document permissions. A subscription pays for a person; membership and payment are independent. Paying never grants access to another library's documents.
- A person can use several libraries with one paid seat. A library owner can sponsor members who are not already covered by an active payer. The same person is counted once across the payer's libraries.
- Creating another library preserves the original trial deadline. Joining a different trial does not extend the person's original trial.
- Library creation and join requests live in settings. A company email does not establish ownership of an email domain or expose other users.
- Existing private documents remain private when someone joins. Sharing with Everyone applies only to members of that library.

## Documents and computers

The document's Cloud row shows a coloured library icon and name before the access pill when several libraries are available. It opens the same panel or mobile sheet used by sharing and tags.

A creator can move a document to an accessible destination project. The operation re-encrypts every retained revision under the destination key, preserves document and revision IDs, and resets access to Only you. The UI explains the access change before the move. Source permissions, destination membership and the expected head are checked again inside the transaction.

Each connected computer can have a default library. It affects new, unbound CLI files. An explicit --account wins. An existing file binding keeps its document and library. A create retry keeps the originally resolved destination and idempotency key even if the computer default changes after a lost response.

CLI commands:

```sh
sdoc cloud libraries --json
sdoc cloud library-default LIBRARY_UUID --json
sdoc cloud library-default clear --json
sdoc cloud move DOCUMENT_UUID --account LIBRARY_UUID --dry-run --json
sdoc cloud move DOCUMENT_UUID --account LIBRARY_UUID --json
```

The Cloud skill and help describe these commands and require agents to link to the returned Cloud URL in chat.

## Billing and rollout

Enable the implementation with CLOUD_SINGLE_PLAN_ENABLED=1. Configure STRIPE_STANDARD_PRICE_ID for the new price. Without the flag, existing billing behaviour remains available. The new checkout never silently selects the old team price. No production subscriptions or prices have been migrated.

The homepage uses the existing localised individual amounts: USD 5, GBP 4, EUR 5 per person per month. The sandbox standard price is price_1URS120RfTbC6JQX8x0aHm8S, on product prod_VSMkNSdjojmI5Z. It has the same currency amounts and tax behaviour as the existing individual price. No live catalogue change has been made.

The billing database maps libraries to payer accounts and people to coverage. Existing internal team-tier limits are reused; they are currently enforced per library. The public single-plan UI uses the standard plan label. This is not a migration of the historical plan schema.

Checkout operations persist provider idempotency keys, reuse open sessions, expire obsolete seat quantities and wait for signed subscription webhooks before activating payment. An existing live subscription blocks a second checkout. If sponsorship ends, a person can subscribe without creating another library. Seat reconciliation updates the former payer when coverage moves to self-payment.

Single-plan billing accounts are not treated as physical workspaces by the legacy billing purge job. Expired payment makes saving unavailable while authorised reading remains available. Define the long-term retention policy before enabling production cleanup for these accounts.

The real Stripe sandbox rehearsal now passes price checks, checkout idempotency, subscription creation, seat changes, scheduled cancellation, reversal, failed payment and recovery. Test subscriptions are cancelled, checkout sessions expired and test customers deleted after the run. Signed webhook application, replay and rejection remain covered by application integration tests. The real sandbox checks do not establish live provider configuration.

Existing subscriptions are retained at their current prices. Billing settings identify an existing rate rather than displaying the new price against an old subscription. A read-only migration review chooses an existing paid account before an unpaid library and reports multiple Stripe subscriptions owned by one person. Adding an owner does not give that person ownership of the first owner's subscription. Historical personal libraries become collaboration-capable without changing names, documents, keys or access groups.

## Validation

Headless browser tests exercise signup, settings, the library panel, document moves and computer defaults at mobile and desktop widths. Backend tests cover cross-organisation access denial, unrelated users with the same email domain, revoked credentials and membership, scoped Everyone access, private moves, encryption rollback, trials and unique sponsored seats. CLI tests cover discovery, defaults, moves and lost-response retry destinations. Authentication, invitations, billing lifecycle and existing UI regressions are also checked.

## Follow-up

Provide a reviewed bulk document-access operation for the case where a solo user later adds colleagues and wants selected existing documents shared with Everyone. The existing single-document CLI access operation is available. Adding a member does not automatically publish historical documents.

The older onboarding and personal-to-team conversion plans describe superseded UX. Their implementation remains behind the legacy mode; do not use them as the current single-plan product specification.
