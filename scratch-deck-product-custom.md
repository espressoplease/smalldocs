---
title: "Onboarding Redesign: Q2 Results"
---

~~~slide
grid 100 56.25 bg=#0f172a
r 4 18 0.8 24 fill=#0d9488
r 6 16 70 3 text=caption align=left valign=center color=#5eead4 | Product Review - Q2 2026
r 6 19 84 12 text=title align=left valign=center color=#f8fafc | Onboarding Redesign: Q2 Results
r 6 32 74 5 text=subtitle align=left valign=center color=#94a3b8 | What changed, what moved, and what we ship next
r 6 49 84 3 text=caption align=left valign=center color=#64748b | Priya Nair, PM - Growth - June 28, 2026
~~~

~~~slide
grid 100 56.25 bg=#0f172a
r 6 16 70 3 text=caption align=left valign=center color=#5eead4 | Where we started
l 6 21 18 21 stroke=#0d9488 strokeWidth=0.12
r 6 22 86 12 text=title align=left valign=center color=#f8fafc | The first run was leaking users
r 6 35 78 6 text=subtitle align=left valign=center color=#94a3b8 | 41% of new signups never reached their first saved document
~~~

~~~slide
grid 100 56.25
r 5 4 88 6 text=subtitle align=left valign=center color=#0f172a | What we changed in Q2
l 5 11 17 11 stroke=#0d9488 strokeWidth=0.1
icon 5.5 14 4 4 name=form-input color=#0d9488
r 11 13.5 84 5 text=body align=left valign=center color=#0f172a | Cut signup from 7 fields to 3: email, name, use case
icon 5.5 20.7 4 4 name=layout-dashboard color=#0d9488
r 11 20.2 84 5 text=body align=left valign=center color=#0f172a | Replaced the empty dashboard with a guided "create your first doc" flow
icon 5.5 27.4 4 4 name=list-checks color=#0d9488
r 11 26.9 84 5 text=body align=left valign=center color=#0f172a | Added a 4-step progress checklist that persists across sessions
icon 5.5 34.1 4 4 name=calendar-clock color=#0d9488
r 11 33.6 84 5 text=body align=left valign=center color=#0f172a | Moved the team-invite prompt from day 0 to day 3
icon 5.5 40.8 4 4 name=activity color=#0d9488
r 11 40.3 84 5 text=body align=left valign=center color=#0f172a | Instrumented every step
r 5 52.5 90 2.5 text=caption align=left valign=center color=#64748b | Shipped in three releases, Apr 8 to May 20.
~~~

~~~slide
grid 100 56.25
r 5 5 70 3 text=caption align=left valign=center color=#0d9488 | New-user activation
l 5 9 17 9 stroke=#0d9488 strokeWidth=0.1
r 5 21 26 8 text=subtitle align=left valign=center color=#94a3b8 | from 41%
icon 32 22 6 6 name=arrow-right color=#0d9488
r 41 11 52 28 align=left valign=center color=#0d9488 size=90px h1Scale=2.8 |
  # 67%
r 5 42 90 7 text=body align=left valign=top color=#0f172a | Reached first saved doc within 24h. Cohort after May 20 vs the March baseline.
r 5 52.5 90 2.5 text=caption align=left valign=center color=#64748b | Activation = share of new signups reaching their first saved document.
~~~

~~~slide
grid 100 56.25
r 5 5 70 3 text=caption align=left valign=center color=#0d9488 | Time to first saved document
l 5 9 17 9 stroke=#0d9488 strokeWidth=0.1
r 5 22 28 8 text=subtitle align=left valign=center color=#94a3b8 | from 9.2 min
icon 34 23 6 6 name=arrow-right color=#0d9488
r 43 11 50 30 align=left valign=center color=#0d9488 size=90px h1Scale=2.8 pScale=0.55 |
  # 3.4
  min
r 5 44 90 6 text=body align=left valign=top color=#0f172a | Median time from signup to first saved document. The guided flow removed the blank-dashboard stall.
r 5 52.5 90 2.5 text=caption align=left valign=center color=#64748b | Measured on the same post-May-20 cohort.
~~~

~~~slide
grid 100 56.25
r 5 4 88 6 text=subtitle align=left valign=center color=#0f172a | Before vs after the redesign
l 5 11 17 11 stroke=#0d9488 strokeWidth=0.1
r 5 14 43 30 fill=#f1f5f9 radius=1 align=left valign=center padding=2.5 color=#475569 |
  ## Before
  - 7-field signup form
  - Empty dashboard
  - No progress shown
  - Invite shown immediately
  - **41% activation**, 22% day-7 retention
r 52 14 43 30 fill=#ccfbf1 radius=1 align=left valign=center padding=2.5 color=#0f172a |
  ## After
  - 3-field signup form
  - Guided first-doc creation
  - Persistent 4-step checklist
  - Invite deferred to day 3
  - **67% activation**, **38% day-7 retention**
r 5 52.5 90 2.5 text=caption align=left valign=center color=#64748b | Activation and day-7 retention measured on the same cohorts.
~~~

~~~slide
grid 100 56.25
icon 6 8 9 9 name=quote color=#0d9488
r 11 17 80 22 text=subtitle align=left valign=center color=#0f172a | I made a real document in under five minutes without reading a single help page. The old version made me feel like I'd forgotten a step.
l 11 42 17 42 stroke=#0d9488 strokeWidth=0.1
r 11 43 80 4 text=body align=left valign=center color=#64748b | **Marcus Lee** - beta user, design studio owner, 4-person team
~~~

~~~slide
grid 100 56.25 bg=#0f172a
r 6 12 70 3 text=caption align=left valign=center color=#5eead4 | Where we go next
l 6 16 18 16 stroke=#0d9488 strokeWidth=0.12
r 6 18 86 11 text=title align=left valign=center color=#f8fafc | Activation is up 26 points.
r 6 31 82 8 text=subtitle align=left valign=center color=#94a3b8 | Next: carry the same guided pattern into the team-invite and first-share moments.
r 6 50 88 3 text=caption align=left valign=center color=#5eead4 | Priya Nair - priya@example.com - full metrics in the Q2 Growth dashboard
~~~
