---
title: Simpson's paradox - when two correct comparisons disagree
cells-tabs: tabbed
styles:
  background: "#F2F6EE"
  color: "#283B25"
  h2:
    color: "#42643B"
  blocks:
    background: "#E5EEDD"
    color: "#283B25"
  chart:
    accent: "#527C46"
---

# Simpson's paradox: when two correct comparisons disagree

Solver A succeeds more often than solver B on both easy and hard problems. Yet B has the higher overall success rate. The arithmetic is correct: the two totals summarize different mixtures of problems.

> **Result:** A leads by 10 percentage points in each difficulty group, but trails by 18.64 points overall. With a shared difficulty mix, A leads by 10 points for every possible weighting.

All counts in this worked example are constructed. They are not measurements of real solvers. The purpose is to isolate the mathematics of aggregation.

## The reversal

| Difficulty | A successes / attempts | A rate | B successes / attempts | B rate |
| --- | --- | --- | --- | --- |
| Easy | 90 / 100 | 90% | 800 / 1,000 | 80% |
| Hard | 20 / 100 | 20% | 10 / 100 | 10% |
| Total | 110 / 200 | 55% | 810 / 1,100 | 73.64% |

~~~chart
{
  "type": "bar",
  "title": "Success rates within groups and overall (%)",
  "labels": ["Easy", "Hard", "Overall"],
  "datasets": [
    {"label": "Solver A", "values": [90, 20, 55]},
    {"label": "Solver B", "values": [80, 10, 73.6363636364]}
  ],
  "format": "number",
  "min": 0,
  "max": 100
}
~~~

Half of A's problems are easy; ten elevenths of B's are easy. An overall rate weights each group's success rate by its share of attempts, not by its share of successful outcomes.

## Write down the weights

Let $w_A$ and $w_B$ denote each solver's proportion of easy problems. Then:

$$
R_A = 0.9w_A + 0.2(1-w_A) = 0.2 + 0.7w_A
$$

$$
R_B = 0.8w_B + 0.1(1-w_B) = 0.1 + 0.7w_B
$$

Hence B's aggregate rate exceeds A's exactly when:

$$
R_B>R_A\quad\Longleftrightarrow\quad w_B-w_A>\frac{1}{7}
$$

Here $w_B-w_A=10/11-1/2=9/22$, which exceeds $1/7$. The reversal follows from the mixture difference, without changing either within-group rate.

## A common comparison population

If both rates use the same easy-problem weight $w$, the difference is:

$$
R_A(w)-R_B(w)
=w(0.9-0.8)+(1-w)(0.2-0.1)=0.1
$$

This is also a general argument. If $a_i>b_i$ in every group and both totals use the same nonnegative weights summing to one, then $\sum_i w_i(a_i-b_i)>0$. A strict reversal requires different weights. With weak inequalities, the weighted difference is nonnegative rather than necessarily positive.

## Inspect the calculations

The first tab retains the counts; the second recomputes both the observed totals and a standardized comparison. Edit the common easy-problem weight between zero and one. At the default 50/50 mix, the standardized rates are 55% and 45%.

~~~cells Mixtures/Counts
format: D=% G=%
Difficulty,A successes,A attempts,A rate,B successes,B attempts,B rate
Easy,90,100,=B2/C2,800,1000,=E2/F2
Hard,20,100,=B3/C3,10,100,=E3/F3
Total,=SUM(B2:B3),=SUM(C2:C3),=B4/C4,=SUM(E2:E3),=SUM(F2:F3),=E4/F4
~~~

~~~cells Mixtures/Weights
format: B=%
Metric,Value
Common easy-problem weight,0.5
A observed easy-problem weight,=Counts!C2/Counts!C4
B observed easy-problem weight,=Counts!F2/Counts!F4
A standardized rate,=B2*Counts!D2+(1-B2)*Counts!D3
B standardized rate,=B2*Counts!G2+(1-B2)*Counts!G3
Standardized A minus B,=B5-B6
Observed A minus B,=Counts!D4-Counts!G4
~~~

## What the calculation does not establish

Standardization answers how these conditional rates compare under a chosen mix. It does not prove that either solver causes a better outcome: problems within the same difficulty label might still differ. For a measured benchmark, use comparable tasks, retain denominators and specify the population the weights represent.

For the broader connection between aggregation and confounding, see [Philip Stark's Berkeley statistics text on Simpson's paradox](https://www.stat.berkeley.edu/~stark/SticiGui/Text/experiments.htm). The counts and derivations above are specific to this example.
