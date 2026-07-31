---
title: "Onboarding Redesign: Q2 Results"
---

~~~slide
@extends cover
#eyebrow: Product Review - Q2 2026
#title: Onboarding Redesign: Q2 Results
#subtitle: What changed, what moved, and what we ship next
#meta: Priya Nair, PM - Growth - June 28, 2026
~~~

~~~slide
@extends section
#kicker: Where we started
#title: The first run was leaking users
#subtitle: 41% of new signups never reached their first saved document
~~~

~~~slide
@extends title-body
#title: What we changed in Q2
#body:
- Cut the signup form from 7 fields to 3 (email, name, use case)
- Replaced the empty dashboard with a guided "create your first doc" flow
- Added a 4-step progress checklist that persists across sessions
- Moved the team-invite prompt from day 0 to day 3
- Instrumented every step so we can see exactly where people drop
#footer: Shipped in three releases between April 8 and May 20
~~~

~~~slide
@extends metric
#metric: 41% -> 67%
#context: New-user activation (reached first saved document within 24h). Measured on the cohort that signed up after May 20, compared to the March baseline.
~~~

~~~slide
@extends metric
#metric: 9.2 min -> 3.4 min
#context: Median time from signup to first saved document. The guided flow removed the "blank dashboard" stall that accounted for most of the old delay.
~~~

~~~slide
@extends two-column
#title: Before vs after the redesign
#left-header: Old flow
#left:
- 7-field signup form
- Empty dashboard on first load
- No sense of progress
- Invite prompt shown immediately
- 41% activation, 22% day-7 retention
#right-header: New flow
#right:
- 3-field signup form
- Guided first-doc creation
- Persistent 4-step checklist
- Invite prompt deferred to day 3
- 67% activation, 38% day-7 retention
~~~

~~~slide
@extends quote
#lead: I made a real document in under five minutes without reading a single help page. The old version made me feel like I'd forgotten a step.
#attribution: Marcus Lee, beta user - design studio owner, 4-person team
~~~

~~~slide
@extends closing
#lead: Activation is up 26 points. Next: carry the same guided pattern into the team-invite and first-share moments.
#contact: Priya Nair - priya@example.com - full metrics in the Q2 Growth dashboard
~~~
