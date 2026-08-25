export const boardMarkdown = String.raw`# Project Meridian

The strategy agent recommends a 90-day Netherlands pilot before a broader European launch. This document combines the written decision, evidence chart, and board-ready slides in one response.

> Approve the pilot and its decision gates. Do not approve the full regional launch yet.

## Decision at a glance

| Question | Finding | Board implication |
| --- | --- | --- |
| First market | Netherlands | Concentrated buyer network and shorter sales cycle |
| Initial customer | Mid-market logistics teams | Visible coordination cost and reachable buying committee |
| Entry method | Three design partners | Observe use before broader localisation |
| Main risk | Integration effort | Prove two reusable connections during the pilot |

## Reachable demand

The Netherlands has the smaller absolute market but the highest reachable share in year one.

~~~chart
{
  "type": "bar",
  "title": "Reachable mid-market accounts in year one",
  "labels": ["Netherlands", "Germany", "Belgium", "France"],
  "values": [420, 610, 180, 330],
  "format": "number",
  "colors": ["#1646d8", "#87a0eb", "#c2cbeb", "#c2cbeb"]
}
~~~

## Board briefing

The deck uses SmallDocs custom shapes so the agent can explain sequence and decision logic visually rather than turning every idea into bullets.

~~~slide
grid 16 9 bg=#07111f
r 1 0.75 14 0.55 text=caption align=left color=#d9ff43 | PROJECT MERIDIAN / BOARD BRIEF 07
r 1 2.0 13.7 2.1 text=title align=left color=#ffffff | Enter Europe through a focused Netherlands pilot
r 1 5.15 10.8 0.8 text=subtitle align=left color=#a9b8cc | Evidence, sequence, and explicit decision gates
l 1 7.35 4.4 7.35 stroke=#d9ff43 strokeWidth=0.18
r 11.8 6.7 3.1 0.95 fill=#1646d8 color=#ffffff radius=0.18 | AUG 2026
~~~

~~~slide
grid 16 9 bg=#f7f8fb
r 1 0.7 14 0.65 text=subtitle align=left color=#101828 | ANALYSIS BECOMES A CONTROLLED DECISION
r 1 2.55 3.2 1.5 fill=#1646d8 color=#ffffff radius=0.18 | Agent analysis
a 4.4 3.3 6.0 3.3 color=#101828
r 6.2 2.55 3.2 1.5 fill=#ffffff color=#101828 stroke=#101828 strokeWidth=0.08 radius=0.18 | 90-day pilot
a 9.6 3.3 11.2 3.3 color=#101828
chev 11.4 2.55 3.5 1.5 fill=#d9ff43 color=#101828 | Board gate
r 1 5.45 4.15 1.35 fill=#e3e9ff color=#101828 radius=0.12 | Adoption / 4 weekly users
r 5.92 5.45 4.15 1.35 fill=#e3e9ff color=#101828 radius=0.12 | Delivery / under 10 days
r 10.84 5.45 4.15 1.35 fill=#e3e9ff color=#101828 radius=0.12 | Economics / paid conversion
l 1 7.5 15 7.5 stroke=#1646d8 strokeWidth=0.12
r 1 7.7 14 0.45 text=caption align=left color=#536174 | Scale only when all three signals hold
~~~

~~~slide
grid 16 9 bg=#1646d8
r 1 0.75 14 0.55 text=caption align=left color=#d9ff43 | REQUESTED DECISION
r 1 2.0 12.8 1.8 text=title align=left color=#ffffff | Approve the pilot, not the regional launch
r 1 4.8 4.0 1.3 fill=#d9ff43 color=#101828 radius=0.14 | 3 design partners
r 5.7 4.8 4.0 1.3 fill=#ffffff color=#101828 radius=0.14 | 2 integrations
r 10.4 4.8 4.0 1.3 fill=#07111f color=#ffffff radius=0.14 | Week 8 review
l 1 7.4 6 7.4 stroke=#d9ff43 strokeWidth=0.18
r 1 7.65 12 0.45 text=caption align=left color=#dce5ff | Owner: Growth team / Next review: 19 October 2026
~~~

## Conditions for approval

1. Recruit three Netherlands design partners from the existing logistics network.
2. Scope the two integrations all three partners require.
3. Agree adoption, delivery, and economics thresholds before implementation.
4. Return to the board after week eight with observed use and delivery cost.

The agent keeps the recommendation in prose as well as slides, so the decision remains readable if the presentation view is never opened.`;

export const boardUpdateMarkdown = String.raw`# Project Meridian: decision recorded

The board approved the Netherlands pilot with the proposed adoption, delivery, and economics gates.

## Next meeting

The growth team will return in week eight with observed results. No broader regional launch has been approved.`;
