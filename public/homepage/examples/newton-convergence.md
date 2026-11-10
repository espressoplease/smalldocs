---
title: Newton's method - a proof, a computation and a counterexample
cells-tabs: tabbed
styles:
  background: "#F5F1F8"
  color: "#382842"
  h2:
    color: "#694579"
  blocks:
    background: "#EDE3F2"
    color: "#382842"
  chart:
    accent: "#79528B"
---

# Newton's method: a proof, a computation and a counterexample

Newton's method replaces a nonlinear equation with a tangent-line approximation. Near a suitable root, the error can shrink quadratically. A starting point outside that local region can instead enter a cycle.

> **Two outcomes:** Starting at 1, the square-root iteration approaches $\sqrt{2}$ with quadratic convergence. Starting at 0, Newton's method for $x^3-2x+2$ alternates forever between 0 and 1 in exact arithmetic.

This note proves the square-root case directly, exposes its calculations in a workbook and constructs the failure rather than relying on a plot to suggest it.

## From a tangent to an iteration

Setting the tangent approximation $f(x_n)+f'(x_n)(x-x_n)$ to zero gives:

$$
x_{n+1}=x_n-\frac{f(x_n)}{f'(x_n)}
$$

For $f(x)=x^2-2$, this becomes:

$$
x_{n+1}=\frac{1}{2}\left(x_n+\frac{2}{x_n}\right)
$$

The update requires $x_n\ne0$. We will take $x_0>0$, targeting the positive root.

## An exact error identity

Write $r=\sqrt{2}$ and $e_n=x_n-r$. Using $r^2=2$:

$$
e_{n+1}
=\frac{x_n^2+2-2rx_n}{2x_n}
=\frac{(x_n-r)^2}{2x_n}
=\frac{e_n^2}{2x_n}
$$

For every positive starting value, the first update is at least $r$ by the arithmetic-geometric mean inequality. Once $x_n\ge r$, the next iterate remains at least $r$ and satisfies:

$$
x_{n+1}-x_n=\frac{2-x_n^2}{2x_n}\le0
$$

Thus the sequence from the first update is decreasing and bounded below. Its limit $L>0$ satisfies $L=(L+2/L)/2$, so $L=r$. For a nonterminating exact sequence, the error identity gives:

$$
\lim_{n\to\infty}\frac{|e_{n+1}|}{|e_n|^2}
=\frac{1}{2\sqrt{2}}
$$

That is quadratic convergence, not merely a claim that the numbers get small quickly. If an iterate equals the root exactly, the iteration has already finished.

## Compute the sequence

The workbook evaluates the recurrence directly. The residual $|x_n^2-2|$ avoids needing a stored approximation to the true root. Formatting shows twelve decimal places, but the underlying calculations retain the renderer's floating-point precision.

~~~cells Newton/Iterations
format: B=.12 C=.12
n,Iterate,Absolute residual
0,1,=ABS(B2^2-2)
1,=(B2+2/B2)/2,=ABS(B3^2-2)
2,=(B3+2/B3)/2,=ABS(B4^2-2)
3,=(B4+2/B4)/2,=ABS(B5^2-2)
4,=(B5+2/B5)/2,=ABS(B6^2-2)
5,=(B6+2/B6)/2,=ABS(B7^2-2)
~~~

~~~cells Newton/Checks
Metric,Value
Final iterate,=Iterations!B7
Final residual,=Iterations!C7
Residual below 1e-12,=Iterations!C7<0.000000000001
~~~

For this equation, residual and root error are related exactly by $|x_n-r|=|x_n^2-2|/(x_n+r)$. A small residual therefore has a clear interpretation while the iterate remains positive. For an arbitrary poorly conditioned equation, a small residual alone need not imply a small root error.

## A cycle with no division by zero

Take $g(x)=x^3-2x+2$, with derivative $g'(x)=3x^2-2$:

$$
N(0)=0-\frac{2}{-2}=1,
\qquad
N(1)=1-\frac{1}{1}=0
$$

Neither derivative vanishes at these points, yet the sequence never reaches a root. A real root exists between -2 and -1 because the polynomial changes sign there.

~~~chart
{
  "type": "line",
  "title": "The failure case: iterates cycle between 0 and 1",
  "labels": ["n=0", "1", "2", "3", "4", "5", "6"],
  "values": [0, 1, 0, 1, 0, 1, 0],
  "format": "number",
  "min": 0,
  "max": 1.2
}
~~~

## Reproduce both outcomes

~~~python
from math import sqrt, isclose

x = 1.0
for n in range(6):
    print(n, f"{x:.12f}", f"residual={abs(x*x-2):.3e}")
    if n < 5:
        x = (x + 2/x) / 2
assert isclose(x, sqrt(2), rel_tol=1e-14)
assert abs(x*x-2) < 1e-12

def step(x):
    return x - (x**3 - 2*x + 2) / (3*x*x - 2)

x = 0.0
sequence = [x]
for _ in range(6):
    x = step(x)
    sequence.append(x)
assert sequence == [0, 1, 0, 1, 0, 1, 0]
print("Cycle:", sequence)
~~~

## Local theorem, global limitation

The general quadratic-convergence result requires a sufficiently close initial point, a twice continuously differentiable function and a simple root with nonzero derivative. [Stanford's root-finding lecture](https://web.stanford.edu/class/math114/decks/rootfinding/newtons_method3.html) states these local conditions. The square-root proof above establishes more for that particular function and positive starting points; it does not extend that guarantee to every nonlinear equation.

In a numerical implementation, distinguish residual, step size and iteration budget. A sign-changing bracket supports bisection; a safeguarded method can use Newton steps only when they stay within that bracket. The exact proof and the finite-precision computation answer different questions, and both belong in the record.
