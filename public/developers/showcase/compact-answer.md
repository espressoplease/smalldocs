# Shift risk summary

The overnight distribution shift can proceed. Keep the manual dispatch fallback active until the routing service has completed three clean cycles.

> **Current state:** one delayed feed is contained. Customer delivery windows are not at risk.

## Live path

~~~mermaid
flowchart LR
  A[Orders] --> B[Routing service]
  B --> C[Dispatch queue]
  D[Manual fallback] -. ready .-> C
~~~

## Operator check

~~~javascript
const ready = feed.ageMinutes < 15
  && queue.unassigned === 0
  && fallback.available;
~~~

| Check | State |
| --- | --- |
| Feed age | 8 minutes |
| Unassigned jobs | 0 |
| Manual fallback | Ready |

No document navigation, fold controls, or downloads are added in this configuration. Copy actions and focused Mermaid and code views remain available.
