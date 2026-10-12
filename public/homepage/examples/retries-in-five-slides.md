---
title: One operation, two requests
styles:
  background: "#F1F5FA"
  color: "#172D48"
  blocks:
    background: "#E3ECF6"
    color: "#172D48"
---

~~~slide
@extends cover
#eyebrow: SOFTWARE ENGINEERING / FIVE SLIDES
#title: One operation, two requests
#subtitle: A timeout tells you what the client observed. It does not tell you whether the server committed.
#meta: A visual guide to safe retries
~~~

~~~slide
grid 16 9 bg=#F1F5FA
r 1 0.6 14 1 text=subtitle align=left color=#172D48 | The response can disappear after the work is done
r 1 2.7 3.6 2 #client fill=#DFEAF7 color=#172D48 radius=0.2 | **Client** sends order A
r 6.2 2.7 3.6 2 #server fill=#DFEAF7 color=#172D48 radius=0.2 | **Server** commits order A
r 11.4 2.7 3.6 2 #timeout fill=#F4E4D7 color=#573820 radius=0.2 | **Response lost** client times out
a @client.right @server.left color=#385C86
a @server.right @timeout.left color=#A25F33
r 1 6 14 1.8 text=body align=left color=#172D48 | The order exists. Retrying as a new operation can create another order.
~~~

~~~slide
grid 16 9 bg=#F1F5FA
r 1 0.6 14 1 text=subtitle align=left color=#172D48 | Give the operation a stable identity
r 1 2.7 4 2 fill=#DFEAF7 color=#172D48 radius=0.2 | **First request** key = order-A
r 6 2.7 4 2 fill=#DFEAF7 color=#172D48 radius=0.2 | **Retry** key = order-A
r 11 2.7 4 2 fill=#E0EDE5 color=#204431 radius=0.2 | **One stored result** both requests read it
a 5.1 3.7 5.9 3.7 color=#385C86
a 10.1 3.7 10.9 3.7 color=#385C86
r 1 6 14 1.8 text=body align=left color=#172D48 | A retry keeps the key and payload. A different intended order gets a different key.
~~~

~~~slide
grid 16 9 bg=#F1F5FA
r 1 0.6 14 1 text=subtitle align=left color=#172D48 | The key needs an atomic boundary
r 1 2.4 14 3.2 fill=#E0EDE5 color=#204431 radius=0.2 padding=0.4 | **In one database transaction:** claim the scoped key, create the order, store the result, then commit.
r 1 6 6.5 1.8 text=body align=left color=#172D48 | Concurrent retry: uniqueness resolves the race.
r 8.5 6 6.5 1.8 text=body align=left color=#172D48 | External payment: needs its own deduplication protocol.
~~~

~~~slide
grid 16 9 bg=#F1F5FA
r 1 0.6 14 1 text=subtitle align=left color=#172D48 | Safety and load are separate problems
r 1 2.5 6.5 3.2 fill=#DFEAF7 color=#172D48 radius=0.2 padding=0.4 | **Stable identity** prevents repeated local effects within the retention window.
r 8.5 2.5 6.5 3.2 fill=#F4E4D7 color=#573820 radius=0.2 padding=0.4 | **Bounded retries and jitter** reduce synchronized pressure on a struggling service.
r 1 6.3 14 1.3 text=body align=left color=#172D48 | Retry only while the result is useful. Carry a deadline across the call chain.
~~~

## Sources and scope

This is a conceptual explanation for a single database effect. It does not promise exactly-once execution across independent systems.

- [AWS: making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) explains client request identifiers and repeated intent.
- [AWS: timeouts, retries, backoff and jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/) explains why timeouts and retries require separate load controls.
- [HTTP semantics, RFC 9110 section 9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2) defines idempotent methods. Application-level request keys extend a specific API contract; they do not change HTTP's method definitions.
