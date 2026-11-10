# Cloud audit repairs, 26 October 2026

These repairs follow the flow audit against `19da4852` on
`codex/homepage-next-review`. They have not been deployed to staging or production.

## CLI coordination and refresh

`cli/lib/file-lock.js` coordinates local state across processes. Binding and
pending-operation mutations lock the complete read-modify-write, then atomically
replace the JSON file. Unreadable binding state is preserved and reported rather
than replaced by an empty object. Lock ownership records include a process ID
and a unique marker. A terminated writer can be recovered by the next command.

Refresh is serialized per origin on the same computer. After obtaining the lock,
the client reloads the credential and uses a fresh rotation from another command
when available. Before sending a refresh, it durably saves a random request ID
with the old credential. A failed response keeps that request for retry.

The server stores the keyed hash of that request ID with the previous refresh
hash. An exact retry using both the old token and request ID recovers the same
new tokens. Derivation uses the raw old token, raw request ID, and server pepper;
the stored hash alone cannot recover a token. Recovery applies to the latest
rotation only. A different replay still revokes the installation. Account and
Terms checks still apply. Legacy clients that omit the request ID keep the old
rotation behavior, including its response-loss limitation.

Ship the server support before distributing this CLI. The packed CLI includes
the new helper and still has no runtime dependencies. The npm version remains
`1.20.0-rc.11`; no package was published and the user's installed CLI was not
replaced by this task.

## Billing and communication

The billing schema adds `access_activated_at_ms` and `initial_payment_pending`.
An incomplete first payment preserves the original trial and seven-day warning
week. After the paywall it does not unlock reads. An expired initial payment can
be retried with a new Checkout. Successful activation preserves read-only access
when that paid subscription later ends.

Existing active and past-due subscription rows receive an activation timestamp
on migration. Existing read-only and canceled rows do not prove the history of
the first payment. Reconcile those rows with current provider state during the
production-data rehearsal. Fresh fixtures and new provider events are covered
by the regression tests; no production database was changed here.

Activation reconciles the current sponsored seat count. It queues durable work
before attempting Stripe and also reconciles duplicate activation webhooks.
Calls are serialized per billing account within the application process, and
quantity writes use a change ID, provider subscription ID, and quantity in their
idempotency key. The local billing quantity is updated after confirmation.
The current deployment has one application process. This queue does not provide
a distributed lock for multiple application instances.

Single-plan billing now schedules and delivers subscription, payment, and
cancellation messages to the billing owner, including owners whose billing
account is not itself a library. Automatic deletion jobs and warnings remain
disabled. Browser and CLI subscription receipts expose failed-payment notices
and the grace deadline. Sidebar and settings links distinguish updating payment
from starting another subscription.

Legal, privacy, cancellation, Cloud pricing, and homepage copy match retained
unpaid documents and all previous revisions for 90 days. The Terms version is
`2026-10-26`. The unsupported referral-extension promise has been removed.
When the existing single-plan flag is enabled, `/` and `/home` serve the new
homepage; `/home-next` remains available.

## Recovery and team requests

The subscription page checks payment confirmation with ten bounded status
polls, then offers an explicit check again action. Polling never starts another
Checkout. Reauthentication links return to the original page. Settings open
reauthentication in another tab so the draft remains in place.

Invitation receipts distinguish an email scheduled for delivery from a link
that must be shared. They expose the actual invitation URL in either case.

Join requests use an eligible verified work address, including an address linked
after Gmail signup. Multiple work addresses are selectable. The request stores
the chosen address, and review and invitation issuance recheck that it is still
verified. An administrator must hold an eligible address at the same domain and
an appropriate library role. Knowing a company domain grants no membership.

## Checks and remaining release work

The canonical Node runner now executes the five previously skipped suites,
including all 84 authentication, billing, lifecycle, Stripe, and jobs checks.
New tests exercise independent CLI processes, response-loss recovery, stopped
writers, incomplete payment, changing seats, captured billing email, recovery
links, linked work addresses, and pending confirmation.

The flow audit records the final check counts. Remaining work includes retiring
an old sign-in method or primary contact address, publishing the accepted CLI,
live Google/email and Stripe sandbox acceptance, a production snapshot migration
and backup rehearsal, and deployment-VM capacity measurements for large libraries.
No staging or production deployment was attempted.
