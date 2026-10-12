---
title: Designing an order API that survives retries
styles:
  background: "#F3F3FA"
  color: "#292743"
  h2:
    color: "#484079"
  blocks:
    background: "#E9E8F3"
    color: "#292743"
  chart:
    accent: "#62579B"
---

# Designing an order API that survives retries

Your checkout service creates an order, commits it, and loses the response. The browser offers a retry. What prevents the same purchase from becoming two orders?

> **Design decision:** Treat the idempotency key as the identity of an intended operation. Store the effect and its replayable result in one transaction, scoped to the authenticated account and endpoint.

This walkthrough covers a local order record in PostgreSQL. Charging a card is a separate effect and requires a separate protocol.

~~~mermaid
sequenceDiagram
  participant C as Client
  participant A as Order API
  participant D as Database
  C->>A: POST orders, key K, payload P
  A->>D: BEGIN and claim account + endpoint + K
  A->>D: Create order and save response
  A->>D: COMMIT
  A--xC: Response lost
  C->>A: Retry with the same K and P
  A->>D: Read committed operation
  A-->>C: Replay the saved response
~~~

## Define the contract before the handler

`POST /orders` requires an `Idempotency-Key`. A client creates a fresh random key when the user intends a new order and persists it through retries. The authenticated account supplies the scope; a caller cannot choose another account through the request body.

| Request | Result |
| --- | --- |
| New key, valid payload | Create the order and save its response |
| Existing key, identical payload | Replay the stored status and body |
| Existing key, different payload | Return a conflict; do not create an order |
| Invalid payload | Reject before executing the transaction |
| Same key arriving concurrently | Let the unique constraint serialize the claim |

Stripe's [idempotency API](https://docs.stripe.com/api/idempotent_requests) provides a concrete example of replaying results and rejecting parameter mismatches. The design below is an illustrative contract, not a reproduction of Stripe's implementation.

## Put the effect inside the boundary

The unique claim, order creation and response storage must commit together. A cache entry written after the order commits leaves a crash window. A cache entry written before the order commits can advertise a result that does not exist.

## A minimal storage model

~~~sql
CREATE TABLE order_operations (
  account_id bigint NOT NULL,
  endpoint text NOT NULL,
  operation_key uuid NOT NULL,
  request_hash text NOT NULL,
  order_id bigint,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, endpoint, operation_key)
);
~~~

Normalize validated business fields before hashing. Hashing arbitrary JSON bytes treats equivalent field orders as different requests. Include quantities, product identifiers and currency, and exclude transport metadata. Resolve prices on the server, then preserve the committed result on replay.

~~~text
validate request and compute canonical request hash
BEGIN
  INSERT operation ON CONFLICT DO NOTHING RETURNING operation_key
  if this transaction inserted the operation:
    create order
    store order id, response status and response body
  else:
    SELECT committed operation by scoped key
    reject if request hash differs
    reuse saved status and body
COMMIT
send response
~~~

At PostgreSQL's default Read Committed isolation level, the conflicting insert waits for the competing transaction; the subsequent statement can see its committed row. The transaction must stay on one database connection. A statement timeout, deadlock or serialization failure still needs explicit handling. [PostgreSQL's isolation documentation](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED) describes these visibility rules.

## The payment boundary remains separate

Do not hold a database transaction open while waiting for a remote card processor. Commit an order in a pending state plus an outbox message, then let a worker request the payment using a stable processor key. Record the processor's reference and reconcile ambiguous responses before marking the order paid.

~~~mermaid
flowchart LR
  A[Order and outbox commit] --> B[Worker reads outbox]
  B --> C[Processor request with stable key]
  C --> D[Record processor reference]
  D --> E[Update payment state]
  C --> F[Timeout: reconcile or retry same key]
  F --> C
~~~

The outbox makes delivery durable, not unique. The worker may deliver twice. The receiver must deduplicate, or the worker must reconcile using an external operation reference.

## Tests that expose the real failure modes

1. Drop the response after commit, retry, and assert one order plus an identical response.
2. Submit concurrent requests with the same key; assert one effect after both transactions settle.
3. Reuse the key with a changed quantity; assert a conflict and no additional order.
4. Crash before commit; assert that neither the order nor its operation record survives.
5. Make the payment worker redeliver; assert that the processor's operation identity stays unchanged.

Choose a retention window longer than the supported retry and reconciliation window. After deleting the key, this mechanism can no longer identify an old retry. A durable business uniqueness rule may still be needed for purchases that must remain distinguishable indefinitely.

For the intent model and late-arriving requests, see [AWS's idempotent API design discussion](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/).
