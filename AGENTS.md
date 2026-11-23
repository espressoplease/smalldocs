# SDocs

Local machine notes may live in `AGENTS.local.md`. Read it when it exists; it is intentionally ignored by git and must not be committed.

Lightweight stateless markdown editor with live styling, plus a zero-dependency CLI (`sdoc`) and server routes. No build step, no frontend framework.

## Area guides and playbooks

Read the relevant guide before changing code in that area:

- **CLI, agent skill, installer, npm tarball**: `cli/AGENTS.md`
- **Tests, Playwright quirks, CLI setup harness, visual preview**: `test/AGENTS.md`
- **Frontend (`public/`), module map, UMD pattern, code viewer/comments, charts, UI patterns**: `maintainers/frontend.md` (kept outside `public/` because `walkPublic()` hashes and serves every file in `public/`)
- **Server HTML routes, asset cache-busting, pre-deploy SW check**: `maintainers/server-and-deploy.md`
- **Adding a new markdown feature** (15-step checklist): `maintainers/adding-markdown-feature.md`
- **Writing style, public-facing copy, `copywriter` reviewer**: `maintainers/public-copy.md`
- **Email templates, SMTP, local Mailpit preview**: `maintainers/email-testing.md`
- **Spreadsheet engine and Excel parity**: `maintainers/spreadsheet-parity.md`

## Repo structure

The repo holds two programs that never share a `package.json`:

- **Server** (root `package.json`, `"private": true`, `name: sdocs-server`) - `server.js` and server-side modules (`lib/`, `cloud/`, `short-links/`, `feedback/`, `analytics/`, `teams/`, `read/`).
- **CLI** (`cli/package.json`, `name: sdocs-dev`) - published to npm with zero runtime dependencies. Lives entirely under `cli/`.
- **Renderer and authoring references**: the external Renderer SDK and its integration demos have been retired. The application renderer remains under `public/`, with browser/CLI shared modules under `cli/shared/`. Authoring references live in `public/authoring/`; their `/developers/authoring/<topic>` pages use the normal application reader.
- **Shared browser/CLI modules**: four UMD files (`sdocs-yaml.js`, `sdocs-styles.js`, `sdocs-slugify.js`, `sdocs-slide-stdlib.js`) live as real files under `cli/shared/` and are symlinked into `public/`. Always edit the real file in `cli/shared/`.
- **No build step**: browser JS cannot use ES modules (`import`/`export`). Browser modules communicate via `window.SDocs` with late binding; Node-shared modules use the UMD IIFE pattern (see `maintainers/frontend.md`).

## Releasing: get sign-off on user-facing content before it ships

User-facing release artifacts must be **read and approved by the user before they reach production**. This is a hard gate, not a courtesy. It covers:

- the **notification alert** (`public/notifications.json`) and the **feature-introduction doc** it links to (including the example links / walkthroughs inside it),
- any **announcement / blog / showcase copy**,
- the **agent skill** copy (what `sdoc setup` installs).

The rule: when a release includes any of the above, **open the actual rendered artifact (the intro doc, the walkthrough examples, the notification target) and wait for the user to read and approve it before deploying or pushing the notification.** Do not deploy the intro doc or light up the notification dot on unreviewed content. "Commit and release" authorizes the code release and deploy; it does **not** waive this review of the user-facing announcement content - confirm that content explicitly, separately.

If a deploy has already gone out with unreviewed announcement content, the fix is to pull the notification entry (or the offending copy), redeploy, and restore it only after the user has signed off.

Code, tests, and the deploy mechanics themselves don't need this extra gate (the user reviews those as the work happens); this is specifically about the *words and demos the public sees*.

## Dashes

Never use em dashes or en dashes anywhere: source files, comments, commit messages, docs. Use a plain hyphen (`-`) instead. This also means no `\u2014` / `\u2013` Unicode escapes.

## Product design reuse

### Develop the interface as it will appear in production

Local development and test flows must show the interface that production users will see. Do not add preview banners, demo badges, testing notes, environment disclaimers, or artificial labels such as "Local Fish CLI preview" to application pages, connected-machine names, or other user-visible records. Use realistic names and production copy. The user already knows which environment they are using and needs to evaluate the actual product experience.

Keep scenario controls and testing explanations in terminal output, test documentation, or a separate test launcher. Do not inject them into the application interface. If a preview needs different authentication or disposable data, implement that behind the scenes without adding explanatory UI.

Reuse existing SmallDocs interface patterns before creating a new component, token set, layout rule, or interaction. If two surfaces perform the same job, they should use the same dimensions, colours, typography, spacing, states, and responsive behaviour. Reposition an existing pattern when the information architecture requires it, such as moving a side panel from right to left, without redesigning the pattern itself.

Create a new pattern only when the user need or interaction is materially different. Before doing that, identify the existing pattern that comes closest and state why extending or reusing it would not serve the new requirement.

## Writing style (summary)

Calm, explicit, honest. State what something does, name trade-offs out loud, skip rhetorical questions and self-defense, avoid hype words ("simply", "just", "blazing", "seamless", "best-in-class", "trust us", "rest assured", "don't worry") and exclamation points in technical copy. For public-facing copy (homepage, install copy, README, docs, UI strings) and the `copywriter` reviewer pass, read `maintainers/public-copy.md`.

## Running

```bash
node server.js                              # http://localhost:3000
PORT=8080 node server.js
SDOCS_DEV=1 node server.js                  # dev mode: no-cache, SW disabled
node test/run.js                            # starts server on :3099, runs unit/integration + CLI setup scenarios
npx playwright test test/write-mode.spec.js # write mode browser tests (needs Chromium)
node cli/bin/sdocs-dev.js <file.md> --url http://localhost:3000  # run local CLI against local server
```

**Dev mode (`SDOCS_DEV=1` or `NODE_ENV=development`)**: serves CSS/JS with `Cache-Control: no-store`, injects a flag into the HTML that unregisters the service worker and clears its caches on load. Use this when iterating on frontend code so changes appear without hard-refreshing.
