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

No document navigation, fold controls, copy actions, or downloads are added in this configuration. Mermaid and code can still open in their focused views.
