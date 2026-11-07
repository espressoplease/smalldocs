# Cloud install prompt evaluation

29 October 2026. Scope: the prompt copied from Cloud Install settings, generated
by `public/sdocs-cli-setup.js`. The standard-edition installer prompt and the
Cloud skill body were not changed.

## Method

Agents started with fresh conversation context. Each install run received only
the generated prompt and instructions for using a disposable test environment.
The evaluator did not tell execution agents what a successful tour should say.
A separate reviewer assessed the copy and the actual resulting guide.

Each install used a new temporary home, the real packed CLI, the real Cloud
onboarding fixture and a separate user/library. Browser opens were recorded;
the fixture simulated the human approving the CLI connection. No real team
membership, subscription, payment or document was changed.

## Results

| Run | Observed outcome |
| --- | --- |
| Original prompt | Agent installed CLI 1.20.0-rc.11 and skill v43, authenticated and verified document creation. It created no document or tour because neither was requested. It noticed the installation account setting did not also set the credential's library default and explicitly set that default. |
| First revision | A different agent installed from scratch, selected the requested default, created one getting-started guide with `getting-started` and `smalldocs` tags, verified the receipt and opened its Cloud URL. The guide and chat repeated much of the same tour. |
| Final revision | Another fresh agent completed setup without errors, created one tagged guide and gave a short chat response with its Cloud link and three example requests. The guide covered Cloud libraries, concrete tag examples, ordinary document requests, finding and updating work, comments, member management and billing. |
| Ordinary document request | A further fresh agent, given the installed skill catalog and a request for a launch checklist without naming SmallDocs, read the skill, saved a Cloud document and chose `shared-notes`, `launch` and `release-checklist` tags. |
| Ordinary document retest | After correcting the loopback wrapper, a new agent was asked for a weekly customer feedback document without naming SmallDocs. It saved and opened the document with `customer-feedback` and `team-process` tags. It corrected one shell quoting error while writing its draft; no CLI or Cloud error occurred. |

The copy review led to keeping the guide in the document and the chat reply
short. Payment and cancellation now explicitly open browser pages where the
human completes the action. Member actions depend on their role. The guide
explains that invitations do not share existing private documents.

## Automated verification

- 18 Playwright checks passed across Cloud onboarding, email onboarding and
  homepage signup, including mobile and desktop, delivered email codes, Google
  provider callback fixtures, preserved return destinations, clipboard copy,
  one usable library, explicit CLI default selection, first save and same-URL
  revision updates.
- Two hosted-install checks passed, including a fresh staging package install,
  persisted staging origin, Cloud skill installation and manual staging update
  policy, plus generated POSIX/Windows instructions.
- The signed-out redirect check now starts its own Cloud fixture. Previously it
  depended on the default test server having Cloud authentication enabled.

## Test limits

The execution lab used a loopback service rather than a public Google sign-in
or a real payment. It did not visually inspect the agent-created guide in a
browser. The browser suites separately rendered and exercised the onboarding
pages and saved Cloud documents.

The lab's raw npm tarball did not contain the staging channel's persisted HTTPS
origin. The first ordinary-document test therefore initially requested login
at the default origin. That pending login was terminated, then the existing
loopback credentials were used successfully. The wrapper was corrected to
supply the fixture origin for later clean-context requests. Persisted origin
behavior of the actual staging package was tested separately above.
