# Math

SmallDocs renders LaTeX with KaTeX.

Use single dollar delimiters for short inline expressions:

```md
The expected value is $E[X] = \sum_i p_i x_i$.
```

Use double dollar delimiters for display equations:

```md
$$
\operatorname{NPV} = \sum_{t=0}^{n} \frac{C_t}{(1+r)^t}
$$
```

A dollar amount such as `$5` is not intended as math. Write currency normally and reserve matching delimiters for equations.

KaTeX supports the commands listed at https://katex.org/docs/supported.html. Keep the raw equation understandable because a loading or syntax failure should not remove the underlying source.
