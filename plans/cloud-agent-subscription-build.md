# Cloud account management through agents

Branch: codex/homepage-next-review. Deployment target: staging only.

1. Add an explicit trial timeline shared by HTTP responses, CLI receipts and browser billing: one calendar month, seven further days with normal access and a warning, then an enforced payment wall. Retain original deadlines across libraries and team membership. Paid coverage takes precedence.
2. Return structured billing notices and recovery URLs on successful document commands and payment-required failures. Keep a single JSON response. Payment is completed by the human through existing Stripe Checkout and customer portal integration.
3. Add authenticated CLI billing status, subscription and exact settings links, invitations, invitation revocation and member removal. Preserve existing membership checks, last-owner protections and billing seat reconciliation.
4. Add a trial feedback page and authenticated CLI submission. The agent asks the human for feedback and does not invent it.
5. Make Library mean Cloud and use the existing library icon. Keep existing accounts on their legacy navigation by default, with a setting to opt in or out. New accounts default to Cloud navigation.
6. Reuse existing SmallDocs sidebar, auth-card and settings controls for subscribe links, warnings, payment wall and feedback. Test desktop, mobile, keyboard access and refreshes.
7. Extend real-server, CLI, permission, billing boundary and migration tests; update skill/help; refresh the staging install; deploy only to staging after verification.

Retention decision: keep unpaid Cloud documents until the user decides a deletion policy. No automatic deletion or deletion promise is introduced. Legacy workspace billing deletion jobs and notices are skipped in the single-plan model, including already queued jobs. Explicit document or library deletion remains a separate action.

Stripe references: https://docs.stripe.com/customer-management/integrate-customer-portal and https://docs.stripe.com/payments/checkout/build-subscriptions . The CLI opens authenticated SmallDocs pages and reads authoritative billing state; it does not collect payment credentials or require users to connect their own Stripe merchant account.
