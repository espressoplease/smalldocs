# Streets that stay useful in the heat

Shade, seating, water, and slower traffic should be treated as one public-space system. The first investment should focus on the routes people already use between homes, shops, schools, and transit.

> **Field decision:** fund three connected cool corridors before distributing isolated interventions across the district.

## What the evidence says

The hottest walking routes also carry the highest share of older residents and school journeys. Shade matters most when it forms a continuous path rather than a collection of pleasant but disconnected points.

| Signal | Current condition | 2028 target |
| --- | ---: | ---: |
| Continuous shaded route | 14% | 48% |
| Seating within 100 metres | 31% | 72% |
| Public drinking water | 3 sites | 11 sites |
| Safe crossings on priority routes | 46% | 90% |

## A connected response

~~~mermaid
flowchart LR
  A[Homes] --> B[Shaded walking route]
  B --> C[Local shops]
  B --> D[School]
  B --> E[Transit]
  F[Water and seating] --> B
  G[Slower crossings] --> B
~~~

The corridor becomes useful when each intervention supports the next. A shaded bench without a safe crossing does not complete the journey.

## A small implementation rule

Teams can rank candidate street segments with a transparent score before detailed design begins.

~~~javascript
function priorityScore(segment) {
  const exposure = segment.heatRisk * 0.4;
  const dailyUse = segment.walkingTrips * 0.35;
  const equity = segment.vulnerableResidents * 0.25;

  return exposure + dailyUse + equity;
}
~~~

## First 90 days

1. Map the three most-used journeys during the hottest four weeks.
2. Walk each route with residents at midday and after sunset.
3. Mark gaps in shade, seating, water, and safe crossing points.
4. Cost one continuous corridor before selecting individual objects.

### Measure the whole journey

Report the percentage of each route that a person can complete comfortably. Counting trees, benches, or fountains alone does not show whether the street works as a connected system.

## Recommendation

Start with the library-to-market corridor. It connects two bus routes, a primary school, the health centre, and the district's largest concentration of residents over 65. Use the first corridor to establish the design and measurement pattern for the next two.
