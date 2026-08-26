---
cells-tabs: tabbed
---

# Northline: investment decision

The analysis supports opening a Rotterdam operations hub before committing to a wider European network. The document combines the decision, evidence, model, implementation logic, and briefing materials in one agent response.

> **Decision:** approve a 12-month Rotterdam launch with three anchor customers and a review after month six.

## Decision at a glance

| Question | Finding | Action |
| --- | --- | --- |
| Where should the first hub open? | Rotterdam | Begin site and partner diligence |
| What should unlock expansion? | 72% capacity utilisation | Review after six months of operation |
| What is the main risk? | Customer concentration | Secure three anchor contracts before fit-out |
| How much capital is at risk? | EUR 1.42m | Release in two gated tranches |

## How the decision is gated

~~~mermaid
flowchart LR
  A[Three anchor contracts] --> B[Rotterdam fit-out]
  B --> C[Six months operating data]
  C --> D{Capacity above 72%?}
  D -->|Yes| E[Prepare second hub]
  D -->|No| F[Hold network expansion]
~~~

The model keeps expansion contingent on observed utilisation rather than the launch forecast.

## Demand evidence

Northline can reach enough demand through existing customers to fill most of the first hub. Expansion requires new-logo demand rather than more volume from the same accounts.

~~~chart
{
  "type": "stacked_bar",
  "title": "Monthly pallet demand by customer source",
  "labels": ["Month 1", "Month 3", "Month 6", "Month 9", "Month 12"],
  "datasets": [
    {"label": "Anchor customers", "values": [3800, 4700, 5400, 5700, 5900]},
    {"label": "New customers", "values": [200, 650, 1600, 2400, 3100]}
  ],
  "format": "number",
  "stacked": true
}
~~~

## Financial model

The two tabs separate editable assumptions from calculated results. The browser recalculates the workbook and exports both sheets to one XLSX file.

~~~cells launch/Assumptions
Input,Value
Monthly capacity,12000
Revenue per pallet,18.5
Variable cost per pallet,10.2
Monthly fixed cost,62000
Launch investment,1420000
Month 6 utilisation,0.72
Month 12 utilisation,0.80
~~~

~~~cells launch/Economics
Metric,Month 6,Month 12
Handled pallets,=Assumptions!B2*Assumptions!B7,=Assumptions!B2*Assumptions!B8
Revenue,=B2*Assumptions!B3,=C2*Assumptions!B3
Variable cost,=B2*Assumptions!B4,=C2*Assumptions!B4
Contribution,=B3-B4-Assumptions!B5,=C3-C4-Assumptions!B5
Contribution margin,=B5/B3,=C5/C3
~~~

The month 12 contribution margin is:

$$
\operatorname{margin} = \frac{\operatorname{revenue} - \operatorname{variable\ cost} - \operatorname{fixed\ cost}}{\operatorname{revenue}}
$$

## Implementation rule

The application can turn the analyst's assumptions into an explicit gate without parsing the SmallDocs document itself.

~~~javascript
export function expansionDecision(metrics) {
  const utilisationReady = metrics.capacityUtilisation >= 0.72;
  const concentrationReady = metrics.topCustomerShare <= 0.45;
  const serviceReady = metrics.onTimeRate >= 0.96;

  return utilisationReady && concentrationReady && serviceReady
    ? 'prepare-second-hub'
    : 'hold-and-learn';
}
~~~

## Briefing slides

The same agent output can include a presentation for the investment committee.

~~~slide
grid 16 9 bg=#07111f
r 1 0.75 14 0.55 text=caption align=left color=#b9f264 | NORTHLINE / INVESTMENT COMMITTEE
r 1 2.0 13.5 2.0 text=title align=left color=#ffffff | Open Rotterdam with a six-month expansion gate
r 1 5.1 11.5 0.8 text=subtitle align=left color=#a9b8cc | One hub, three anchor customers, observed demand before network scale
l 1 7.35 4.8 7.35 stroke=#b9f264 strokeWidth=0.18
r 11.5 6.8 3.4 0.9 fill=#3157d5 color=#ffffff radius=0.18 | AUGUST 2026
~~~

~~~slide
grid 16 9 bg=#f7f8fb
r 1 0.7 14 0.7 text=subtitle align=left color=#101828 | CAPITAL FOLLOWS OBSERVED EVIDENCE
r 1 2.65 3.1 1.55 fill=#3157d5 color=#ffffff radius=0.2 | Anchor contracts
a 4.3 3.42 5.8 3.42 color=#64748b
r 6 2.65 3.3 1.55 fill=#ffffff color=#101828 stroke=#94a3b8 strokeWidth=0.07 radius=0.2 | Rotterdam launch
a 9.5 3.42 11 3.42 color=#64748b
chev 11.2 2.65 3.7 1.55 fill=#b9f264 color=#101828 | Month 6 gate
r 1 5.6 4.1 1.25 fill=#e8edff color=#101828 radius=0.14 | 72% utilisation
r 5.95 5.6 4.1 1.25 fill=#e8edff color=#101828 radius=0.14 | 96% on-time rate
r 10.8 5.6 4.1 1.25 fill=#e8edff color=#101828 radius=0.14 | Below 45% concentration
~~~

~~~slide
@extends closing
#lead: Approve the first hub, not the network
#contact: Return with observed operating data after month six
~~~

## Supporting video

The final block demonstrates a supported external video reference. The surrounding explanation remains useful when the reader does not play it.

~~~video
https://www.youtube.com/watch?v=M7lc1UVf-VE
title: Embedded video example
start: 12
~~~

## Next actions

1. Convert the three anchor commitments into signed volume bands.
2. Complete site diligence before releasing the fit-out tranche.
3. Track utilisation, on-time delivery, and concentration weekly.
4. Return to the committee after month six with observed results.
