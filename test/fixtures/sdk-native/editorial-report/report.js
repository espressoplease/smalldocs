export const editorialMarkdown = String.raw`# Renewal economics

The retention agent combined customer interviews, account history, and support themes into one report. The result is ordinary Markdown with SmallDocs features where they help a reader inspect the work.

<section class="research-summary" data-status="reviewed" aria-label="Research summary">
  <strong>Decision:</strong> improve team onboarding before changing price. Retention improvement has the strongest effect on lifetime value and requires the smallest commercial assumption.
</section>

> The model is useful for comparing scenarios. It is not a promise about future revenue.

## Evidence

Thirty-four interviews point to a sharp difference between teams that complete onboarding together and accounts where one person configures the product alone.

| Segment | Twelve-month retention | Annual value | Primary friction |
| --- | ---: | ---: | --- |
| Coordinated teams | 91% | £18,400 | Data mapping |
| Individual-led teams | 76% | £4,100 | Colleague adoption |
| Dormant trials | 18% | £0 | No first workflow |

### What customers described

1. The first shared workflow matters more than the first personal workflow.
2. Teams tolerate setup effort when the result replaces a recurring spreadsheet.
3. A visible owner reduces stalled implementations.

## Model

Expected annual value is $V = R \times M$, where $R$ is recurring revenue and $M$ is gross margin.

$$
LTV = \frac{ARPA \times GrossMargin}{1 - Retention}
$$

The analysis service uses the following deliberately small calculation before it sends the Markdown to the renderer:

~~~javascript
export function expectedValue(revenue, grossMargin, retention) {
  const annualContribution = revenue * grossMargin;
  return annualContribution / (1 - retention);
}
~~~

## Recommendation

Run a six-week onboarding experiment with ten coordinated teams. Measure time to the first shared workflow, weekly active collaborators, and the number of manual spreadsheets retired.

### Decision gates

- Continue when eight teams complete a shared workflow in their first week.
- Revise the intervention when setup still depends on one specialist.
- Stop when the experiment adds support work without improving collaboration.

## Evidence

This second Evidence heading intentionally repeats the earlier title. An embedded renderer must generate a distinct anchor without colliding with the first section or another document on the page.

[Open the underlying research archive](./archive/renewal-study).`;

export const editorialUpdateMarkdown = String.raw`# Renewal economics: updated

The agent incorporated the latest cohort. Coordinated onboarding remains the strongest intervention.

## Updated evidence

| Measure | Previous | Current |
| --- | ---: | ---: |
| Twelve-month team retention | 91% | 92% |
| First-week shared workflows | 64% | 71% |

The live view was updated without reconstructing the customer page.`;

export const unsafeMarkdown = String.raw`# Sanitisation check

Safe prose should remain visible while executable document markup is removed.

<script>window.hostCompromised = true</script>
<button id="unsafe-button" onclick="window.hostCompromised = true">Unsafe handler</button>
<a id="unsafe-link" href="javascript:window.hostCompromised=true">Unsafe link</a>
<iframe srcdoc="<script>parent.hostCompromised=true</script>"></iframe>
<svg onload="window.hostCompromised=true"><circle cx="5" cy="5" r="5"></circle></svg>
<style>body { display: none }</style>`;
