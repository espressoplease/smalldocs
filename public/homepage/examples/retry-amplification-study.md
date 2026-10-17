---
title: Retries multiply - a reproducible failure study
cells-tabs: tabbed
styles:
  background: "#EFF5F6"
  color: "#17383D"
  h2:
    color: "#23636A"
  blocks:
    background: "#DFECEE"
    color: "#17383D"
  chart:
    accent: "#297B84"
    palette:
      - "#297B84"
      - "#B3653C"
---

# Retries multiply: a reproducible failure study

Retries can improve the chance of receiving an answer while also increasing server load and repeating a committed effect. These are three separate outcomes. A single success-rate metric can conceal the other two.

> **Result:** In the controlled model below, a 20% response-loss probability and three total attempts produce 1.24 server executions per logical operation. A stable operation key reduces committed effects to one, but it does not remove the retry traffic. With three attempts at each of five nested layers, complete failure can trigger 243 leaf calls.

The experiment is synthetic, deterministic and fully enumerable. It measures the consequences of its assumptions, not a production failure rate. The notebook-sized Python listing at the end reproduces every probability in the first chart.

## 1. Specify the failure, not just the error message

Every request reaches the server, successfully applies its effect and then independently loses its response with probability $p$. The client retries until it receives a response or exhausts $A$ total attempts. There are no failures before execution, no contention and no recovery delays.

~~~mermaid
flowchart LR
  A[Logical operation] --> B[Server applies effect]
  B --> C{Response delivered?}
  C -->|Yes| D[Client observes success]
  C -->|No| E{Attempt budget left?}
  E -->|Yes| B
  E -->|No| F[Client outcome unknown]
~~~

This isolates the ambiguous-outcome problem: the client's missing answer and the server's committed work can coexist. [AWS's timeout and retry guidance](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/) discusses this distinction and the load added by retries.

## 2. Derive the expected work

Attempt $i$ occurs only if all $i-1$ earlier responses were lost. Consequently:

$$
E[T] = \sum_{i=0}^{A-1}p^i
= \frac{1-p^A}{1-p},\qquad 0 \leq p < 1
$$

The probability of receiving no response is $p^A$. For $p=1$, all attempts occur and $E[T]=A$. Since the first attempt always commits in this model, the probability of at least one duplicate effect without deduplication is $p$, provided $A>1$.

~~~chart
{
  "type": "line",
  "title": "Three attempts: expected executions per logical operation",
  "labels": ["0% loss", "5%", "10%", "20%", "40%", "80%"],
  "datasets": [
    {"label": "Server executions", "values": [1, 1.0525, 1.11, 1.24, 1.56, 2.44]},
    {"label": "Committed effects with deduplication", "values": [1, 1, 1, 1, 1, 1]}
  ],
  "format": "number",
  "beginAtZero": true
}
~~~

At 20% loss, three attempts leave 0.8% of client outcomes unknown. Increasing the budget to five lowers that fraction to 0.032%, but raises expected executions from 1.24 to 1.2496. The extra traffic buys more answers, not fewer underlying effects.

## 3. Make assumptions editable

The workbook separates inputs, expected results and nested retry amplification. Expand it to edit the assumptions or export all tabs to Excel. Values are probabilities, not percentages already multiplied by 100. The formulas assume integer attempts of at least one and loss between zero and one.

~~~cells RetryModel/Inputs
format: B3=%.1
Assumption,Value
Logical operations,10000
Response loss probability,0.2
Total attempts,3
Retrying layers,5
~~~

~~~cells RetryModel/Expected
format: B4=%.3 B5=%.1
Metric,Value
Expected executions per operation,"=IF(Inputs!B3=1,Inputs!B4,(1-Inputs!B3^Inputs!B4)/(1-Inputs!B3))"
Expected server executions,=Inputs!B2*B2
Unknown client outcome probability,=Inputs!B3^Inputs!B4
Duplicate-effect probability without keys,"=IF(Inputs!B4>1,Inputs!B3,0)"
Expected effects without keys,=B3
Effects with durable keys,=Inputs!B2
Excess effects without keys,=B6-B7
Unknown outcomes expected,=Inputs!B2*B4
~~~

~~~cells RetryModel/Nesting
Layers,Attempts per layer,Worst-case leaf calls
1,=Inputs!B4,=B2^A2
2,=Inputs!B4,=B3^A3
3,=Inputs!B4,=B4^A4
4,=Inputs!B4,=B5^A5
5,=Inputs!B4,=B6^A6
Configured layers,=Inputs!B5,=Inputs!B4^Inputs!B5
~~~

These are expectations, not integer counts from one random run. Ten thousand operations at the default settings produce 12,400 expected executions, 2,400 excess effects without keys and 80 unknown client outcomes.

## 4. Retrying layers multiply during complete failure

A gateway, service client and database adapter can each retry independently. If every child call fails and each layer makes three total attempts, a stack of $L$ retrying layers makes up to $3^L$ calls at the leaf. This is a worst-case bound, not an average under independent response loss.

~~~chart
{
  "type": "bar",
  "title": "Complete failure: leaf calls for one upstream operation",
  "labels": ["1 layer", "2 layers", "3 layers", "4 layers", "5 layers"],
  "values": [3, 9, 27, 81, 243],
  "format": "number",
  "beginAtZero": true,
  "color": "#B3653C"
}
~~~

Use one intentional retry boundary wherever possible. Carry an end-to-end deadline; a retry after that deadline adds work after the caller has stopped benefiting. Backoff controls spacing, jitter separates callers in time, and a retry budget limits volume. None of these changes the identity of the operation.

## 5. Add deduplication without hiding the boundary

~~~mermaid
sequenceDiagram
  participant C as Client
  participant S as Service
  participant D as Transactional store
  C->>S: Operation K and payload P
  S->>D: Atomically claim K, apply effect, save result
  D-->>S: Commit succeeds
  S--xC: Response lost
  C->>S: Retry operation K and payload P
  S->>D: Fetch result by scoped K
  S-->>C: Replay result without another effect
~~~

In the model, deduplication retains keys indefinitely. A real contract needs an authenticated scope, payload conflict detection, concurrent-claim handling, an atomic effect/result commit and a stated retention period. If the effect crosses into another system, a local key alone cannot make that system's effect unique. See [AWS's idempotency design discussion](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) for request identity and late-arriving requests.

## 6. Reproduce the probabilities without random noise

This Python 3 program enumerates the terminal paths. A delivered response after attempt $k$ has probability $p^{k-1}(1-p)$; exhausting the budget has probability $p^A$. Both final delivery and final loss perform $A$ executions, but only one produces an observed answer.

~~~python
from math import isclose

def enumerate_outcomes(p, attempts):
    assert 0 <= p <= 1 and attempts >= 1
    paths = [(k, p ** (k - 1) * (1 - p), True)
             for k in range(1, attempts + 1)]
    paths.append((attempts, p ** attempts, False))
    assert isclose(sum(weight for _, weight, _ in paths), 1)
    executions = sum(k * weight for k, weight, _ in paths)
    unknown = sum(weight for _, weight, answered in paths
                  if not answered)
    duplicates = sum(weight for k, weight, _ in paths if k > 1)
    return executions, unknown, duplicates

if __name__ == "__main__":
    for p in [0, .05, .10, .20, .40, .80]:
        executions, unknown, duplicates = enumerate_outcomes(p, 3)
        print(f"{p:.0%},{executions:.4f},{unknown:.4%},{duplicates:.4%}")
    assert isclose(enumerate_outcomes(.2, 3)[0], 1.24)
    assert isclose(enumerate_outcomes(.2, 3)[1], .008)
    assert isclose(enumerate_outcomes(.2, 3)[2], .2)
    assert enumerate_outcomes(1, 3) == (3, 1, 1)
    assert enumerate_outcomes(.2, 1)[2] == 0
    assert 3 ** 5 == 243
~~~

## 7. What would change the result?

**Correlated failures:** An overloaded service does not usually fail independent coin flips. Retry volume can worsen the failure probability, invalidating the geometric model.

**Failures before execution:** If requests sometimes fail before applying their effect, the expected number of effects falls below the number of executions. Unknown outcomes remain possible; deduplication must distinguish intent rather than infer execution from an error code.

**Finite retention:** A delayed retry after key expiration can execute again. The one-effect line in the chart is conditional on keys remaining valid and their result records surviving.

**Cancellation and deadlines:** Canceling the client wait does not necessarily cancel a committed server operation. Propagate cancellation where supported, but reconcile ambiguous outcomes using an operation reference.

## 8. Measurements for a production rollout

Track logical operations separately from transport attempts. Measure attempts per operation, replay rate, conflicting payloads, deadline exhaustion and committed effects per operation. Inject response loss after commit, not only connection failures before a request reaches the service. Run concurrency and crash tests against the actual storage boundary.

The useful acceptance criterion is two-part: repeated requests do not create repeated effects inside the declared boundary, and retry traffic remains within the service's capacity budget.
