# Referrals and Learn

Implemented on the Cloud-first branch, 1 November 2026; expanded to two reward milestones on 2 November 2026. Production has not been changed. See [the accepted milestone spec](../plans/referral-milestones.md).

## Product rules

- Each signed-in person has an opaque `/home?ref=CODE` link. `/home` uses the new homepage in the single-plan deployment.
- The referral is bound to the email verification challenge or browser-bound OAuth transaction that creates the account. The homepage passes its explicit referral code into that signup action. No persistent referral tracking cookie is set. A completed referral cannot be overwritten by another link or linked identity.
- Email and Google signup attach the new account to that introduction. Existing accounts and linked sign-in methods cannot generate another referral.
- The referral appears after verified signup, which gives the friend one extra calendar month of personal trial access. Onboarding can finish later without losing the bonus.
- The referrer earns one person-month when the friend has connected a CLI and saved a tagged Cloud document they created. Tagging an initially untagged own document also qualifies. Connecting alone, failed saves and editing someone else's shared document do not qualify.
- The referrer earns two additional person-months after activation and the referred subscriber's first nonzero paid monthly invoice. A subscription can cover one person or a team, but being sponsored on someone else's bill is not a payment by the referred person. Each referral earns three referrer person-months in total; event order does not matter.
- The referred person is shown the referrer's first name and a notice that their name and referral progress will be visible. Email addresses, invoice details, and document or library access are not shared.
- Rewards earned without paid coverage become personal free access, starting at the later of the current free-access deadline and the award time. Paid users receive billing credit. A referrer's credit belongs to their own billing account. It is retained if someone else currently sponsors them. It does not silently transfer to their employer's bill.
- Credits apply before tax at the configured monthly per-person price. Ten seats plus one credit discounts one seat. Five seats plus five credits covers that invoice. Excess credits carry forward. Rewards do not extend an entire team's trial or move its billing date.
- Original trial rows are preserved. Separate personal-access grants extend only the recipient, including when they own a team or join one. The effective personal deadline appears in billing/status, document receipts, the subscription page and Refer. The seven-day warning follows that deadline. Paid coverage takes priority over personal free access. Subscribing starts payment immediately; unused trial time is not converted to billing credit.
- A reward spent on personal access cannot also discount an invoice. Balances include `access_person_months`, `billed_person_months` and `personal_access_ends_at_ms` alongside available, reserved and used totals.
- Self referrals, repeated webhook delivery, repeated CLI installation, and a recreated account using an already-referred verified email do not generate another reward. Different verified email addresses can still belong to the same human; this implementation does not claim to detect that.

Referral progress and credits are available in the shared sidebar on document, library and account pages, and through `sdoc cloud referrals --json`. Learn reuses the existing sidebar accordion and document renderer.

## Storage and recovery

`cloud_referral_links`, `cloud_referrals`, `cloud_referral_rewards` and `cloud_referral_redemptions` live in the billing database. Reward units are unique by referral, milestone and unit number. Billing credits are reserved transactionally and consumed only after Stripe confirms the invoice was paid with the corresponding discount. Checkout expiry and voided invoices release reservations.

`cloud_billing_person_access_grants` stores once-only calendar-month access grants per person. An unpaid reward's grant and consumption commit together with its milestone. Signup grants may be pending until the original personal trial exists. Deadline reads normally use read-only queries; pending grants materialize in a billing transaction. Original trial rows and team subscription clocks are never rewritten.

`cloud_document_activation_events` in the content database records each creator's first tagged save in the revision transaction. It contains only the actor, document identifier and time, not document text or tags. Authenticated activity and invoice qualification recover this evidence into referral progress after a temporary billing failure. History exposes the milestone, never the document identifier or metadata.

The original reward table had a unique referral identifier. Startup migrates it transactionally to milestone units, preserving reward IDs, invoice reservations and consumed state. Its one existing paid reward counts as the first of the two payment units. Once activation is established, only the remaining units are added, to a total of three. Existing attributed users get the signup bonus once when their referral progress is recovered.

An auth-database outbox keeps the verified new-account introduction available if writing attribution to billing temporarily fails. Sign-in and CLI connection remain usable, and the attribution is retried on the next continuation or authenticated CLI operation. Outbox entries contain a keyed intent hash, not OAuth tokens or sign-in codes.

Discount operations have stable Stripe idempotency keys and immutable, stored coupon amounts. An interrupted provider response is recovered from the current invoice state. Async Stripe work runs outside the existing synchronous webhook transaction. The referral handler is independently idempotent, so it can recover even when the general webhook receipt is already recorded.

The existing billing backup includes this ledger. Keep the auth pepper stable: it hashes signup intent keys and already-used verified email identities. Referral codes grant no account permissions. Abandoned signup-intent records are removed after two days; the corresponding OAuth and email challenges expire earlier under their existing authentication policy.

Rewards qualify from a successful nonzero monthly payment, not from merely creating a subscription or completing a zero-value invoice. Refunds and disputes currently require manual referral-credit reconciliation. The implementation does not automatically charge back a previously granted reward.

## Stripe configuration before enabling in a deployment

The standard price must be a monthly, per-person price. Each price currency option supplies its corresponding coupon amount. Coupon discounts are fixed amounts restricted to the standard product, valid once, with one redemption. They never use a percentage discount against the whole team.

The webhook destination must include the existing subscription events plus:

- `invoice.created`: apply credits to the draft monthly renewal invoice before finalization.
- `invoice.paid`: confirm reward eligibility and consume invoice reservations.
- `invoice.voided` and `invoice.deleted`: release unused reservations.
- `checkout.session.expired`: release abandoned Checkout reservations.

The restricted Stripe credential needs read access to prices, subscriptions, invoices and Checkout sessions, and write access to coupons and draft invoices in addition to existing Checkout permissions. Verify these permissions in the sandbox before deployment. A deployment without the invoice events will not complete the reward flow.

The first subscription invoice finalizes immediately, so its coupon must be attached when Checkout is created. Renewals have a draft interval in which `invoice.created` can add the discount. Do not try to edit an already-finalized first invoice.

## Research

- [Stripe: subscription invoice lifecycle](https://docs.stripe.com/billing/invoices/subscription) explains the immediate first invoice and draft renewal interval.
- [Stripe: coupons](https://docs.stripe.com/billing/subscriptions/coupons) supports fixed-amount, single-use, product-specific and multi-currency discounts before tax.
- [Stripe: customer invoice balance](https://docs.stripe.com/billing/customer/balance) provides an immutable monetary credit ledger. We keep earned rewards in person-months and use coupons so the benefit follows per-person pricing and handles tax correctly.
- [Rewardful: attribution settings](https://help.rewardful.com/en/articles/14148863-campaign-settings-overview) distinguishes first-touch and last-touch attribution and recommends treating referrer-visible customer details as an explicit choice.

## Verification

`test/test-cloud-referrals.js` and `test/test-cloud-referral-milestones.js` run isolated signup, CLI authorization, personal access and signed billing-webhook flows against a temporary application database and `test/stripe-referral-fixture.js`. They cover active trials, warning/paywall recovery, personal and team payers, sponsored members, cross-company access, event ordering, retried saves, calendar boundaries and legacy reserved credits. They never use real customer data or payment credentials. Browser coverage exercises Google/email attribution, shared sidebar presentation, copy, mobile layout and the Learn prompts.

The real SmallDocs Stripe sandbox also passed four checks on 1 November 2026: ten seats with one credit charged $45; five seats with five credits charged $0; one GBP seat with one credit charged £0; adding one credit to a real draft monthly invoice for ten seats reduced it to $45. See `maintainers/qa/referrals/stripe-sandbox-2026-11-01.json`. All test subscriptions were cancelled, test customers and coupons deleted, and test prices/products archived. No live payments or existing customers were used.

Re-run the provider contract checks with `node scripts/check-referral-stripe-sandbox.js` after authenticating the Stripe CLI to the sandbox. The script requires `livemode: false` before creating its fixtures, uses the application's Stripe adapter through the CLI transport, and writes a receipt to `/tmp/sdocs-referral-stripe-sandbox-receipt.json`. This verifies API behaviour, not the restricted staging application key's permissions or webhook subscriptions.
