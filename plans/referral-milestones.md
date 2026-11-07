# Referral milestones

Accepted 2 November 2026. Deploy to Cloud staging only.

## Offer

- A new verified signup through a referral link gets one extra calendar month of personal trial access.
- The referrer earns one person-month after the friend connects an agent and saves their first tagged Cloud document. The document must have been created by that friend. An existing shared document, a failed save, or connecting an agent alone does not qualify.
- The referrer earns two more person-months after activation and the friend's first confirmed, nonzero monthly subscription payment. The events can arrive in any order. There are three referrer person-months in total.
- A person paying for themselves or sponsoring a team can earn the payment milestone on their subscription. A team invitation or being covered by someone else's subscription does not count as making a payment. A sponsored member can still activate a referral and later qualify by starting their own subscription.

## Applying the benefit

- Original trial rows and team trial dates stay unchanged.
- Signup bonuses and rewards earned while unpaid add personal access. Each month begins at the later of the current personal access deadline and the award time. UTC calendar arithmetic clamps month-end dates.
- The personal extension follows its recipient across permitted libraries. It grants no document permissions and does not extend anyone else's access, including members of a team owned by the recipient.
- Rewards earned while the referrer has their own continuing subscription stay as billing credit. Rewards for someone covered by another paid billing account stay with their own account for future use, rather than discounting the sponsor's bill.
- A subscribed team owner uses one credit per billed person-month. Ten seats and one credit cost nine seat-months. Five credits cover five seats. Excess credits carry forward.
- An access month already granted is not also redeemable on an invoice. Subscribing during free access starts payment immediately, as with the existing trial. It does not turn elapsed or remaining trial time into billing credit.
- The existing seven-day warning follows the effective free-access deadline. No deletion policy is introduced.

## Recovery and existing referrals

- Persist document activation evidence in the content database in the successful create transaction. A billing failure after a save must not lose the milestone. Retry it during authenticated activity and before invoice eligibility checks.
- Each reward unit is unique by referral, milestone and unit number. Payment and activation may be repeated, reversed in delivery order, or retried concurrently without double awards.
- A legacy one-month reward counts toward the two-month payment bonus. Its reservation, consumption and invoice linkage survive migration. Completing activation adds the missing units, to a maximum of three total. Existing referrals receive the signup bonus once when recovered.
- Signup attribution keeps the existing verified-email identity check and authentication outbox. Account linking, reinstalling, document retries and recreating the same referred email cannot generate another referral.
- No document ID, title, text or tags appear in referrer history. History exposes activation and reward progress only. Signed invoice handling continues to verify the customer, subscription, billing account and configured monthly price.

## API and interface

- Refer explains the extra trial month, one-month activation reward and two-month payment bonus.
- History distinguishes signup, agent connected, first document saved and the completed payment bonus, with the number of person-months earned.
- Balances distinguish available billing credit, pending invoice reservations and rewards used for personal access. The personal free-access deadline is visible to its owner through billing/status and Refer.
- Homepage attribution describes the recipient's benefit and what referral progress is visible. Subscription, CLI help and agent guidance use the same rules.

## Verification matrix

Test verified email and Google signup, delayed onboarding, tagged and untagged saves, both document create routes, browser/CLI event ordering, lost billing responses, duplicate requests, disabled/deleted users and legacy database migration.

Test a referrer on an active trial, in the warning week, behind the paywall, paid solo, sponsoring ten people, and sponsored by someone else. Assert only the recipient gains personal access; other members retain their own dates and document permissions.

Test one and several credits, zero-value invoices, first payment before activation, repeated paid invoices, foreign customers, incomplete invoice lines, checkout expiry, voids, concurrent reservations and cancellation. Run the existing billing, trial, CLI, onboarding and referral regressions, plus desktop/mobile browser flows. Deploy and verify staging assets and the local staging CLI/skill. Production is unchanged.
