---
tags:
  - "architecture"
  - "product"
  - "agents"
---
# SmallDocs embedded renderer SDK

Status: revised after security, Kent Beck-style and DHH-style reviews, then
corrected to preserve full rendering parity as the destination

## The product in one sentence

SmallDocs renders Markdown inside your application.

The primary API is:

```js
const view = await SmallDocs.render('#report', markdown);
```

`#report` is the host application's mount element. `markdown` is already
finished content. It may come from an agent, a database, a file or a person.

SmallDocs handles parsing, sanitisation, navigation, feature discovery, lazy
loading, rendering, visible fallbacks, updates and cleanup. The application
does not parse blocks, declare capabilities or tell the SDK which features the
document uses.

## Destination and delivery strategy

The SDK is intended to render the full depth of a SmallDocs reading surface,
not a chart-focused subset.

The implementation can still proceed through narrow vertical slices because
they create fast feedback and reduce refactoring risk. Those slices are
internal milestones, not the product definition. Chart is useful as the first
probe because it exercises discovery, lazy loading, a third-party renderer,
cleanup and state isolation. It has no special product status.

Development runs on two tracks:

1. A full-fidelity sandboxed iframe SDK uses the real SmallDocs reader early.
   It lets a pilot render the complete existing surface while the native
   renderer is being extracted.
2. A native modular renderer grows feature-by-feature and is compared against
   the real reader after every slice. It replaces the iframe engine only after
   it reaches the agreed parity matrix.

The public API does not change when the engine changes. A host continues to
call `SmallDocs.render(target, markdown)`.

The long-term implementation is one renderer kernel used by both the SDK and
the full SmallDocs application. It must lazy-load from document content while
remaining capable of rendering any supported SmallDocs document.

## Product boundary

### Full renderer includes

- One documented JavaScript API
- Markdown input, with optional SmallDocs YAML front matter
- Automatic navigation by convention
- A renderer-owned reading surface
- Automatic discovery of every supported SmallDocs block after Markdown has
  been produced
- Content-driven lazy loading of the matching renderers
- Visible source or bounded errors when rendering fails
- Multiple simultaneous instances
- Complete cleanup when an instance updates or is destroyed
- Exact-version browser caching
- A plain HTML integration example

### Full rendering parity matrix

The final native renderer must match the existing reader for:

- YAML document styles, typography and theme variables
- Headings, navigation and collapsible sections
- Prose, lists, callouts, links, images and tables
- Code highlighting, copying and focused reading
- Charts
- Math
- Mermaid diagrams and focused viewing
- Video blocks under the approved network policy
- Cells workbooks, formulas, tab groups, selection, fullscreen exploration and
  the reader-facing download behavior chosen for embeds
- Inline slides, shapes, nested rich content and presentation mode

Each slice gets a shared fixture rendered in both the current reader and SDK.
Parity is judged semantically and visually, with intentional embed differences
documented.

Forms are the one unresolved boundary. They render UI but also send structured
intent back to a host. Decide whether they belong in the full renderer or in a
separate interactive extension before the parity program closes.

### SDK excludes

- Comments and review events
- Write mode or raw Markdown editing
- Agent invocation
- Cloud persistence, authentication or sharing
- Full-document PDF, Word or Markdown export
- Framework-specific packages
- Server-side rendering
- Arbitrary host or document-provided feature modules

These are separate layers rather than missing rendering features.

## Primary API

### Render

```js
const view = await SmallDocs.render('#report', markdown);
```

The target may be a CSS selector or an `Element`. The promise resolves after
the document and every supported feature present in it have either rendered or
produced a visible fallback.

The first documentation example begins with a Markdown string, not
`agent.run()`. Agent integration is a later recipe:

```js
const markdown = await agent.run(prompt);
const view = await SmallDocs.render('#report', markdown);
```

This keeps the boundary clear: the agent creates Markdown; SmallDocs renders
it.

### Update

```js
await view.update(nextMarkdown);
```

The first implementation cleans up the old render and mounts the new one.
Feature-specific incremental updates are deferred until measurements show that
remounting is a problem.

### Destroy

```js
view.destroy();
```

Destroy is idempotent. It aborts the active generation, removes event
listeners, destroys active feature objects, disconnects observers and releases
instance-owned state.

Calling `update` after destroy rejects. When updates overlap, the newest update
wins.

### Deliberately absent from the initial API

- No separate `view.ready`. Await `render` or `update`.
- No public custom-element method. A custom element may be an implementation
  detail if the isolation spike selects it.
- No feature allowlist in agent output.
- No `assetBase` option. Modules resolve relative to the exact-version entry
  module.
- No external AbortSignal or diagnostic event system until a pilot needs one.
- No navigation option. Navigation follows one documented convention.

The host themes the renderer through documented CSS custom properties. Add
theme options only if a real integration cannot use that seam.

## What exists today

The current reader already follows the right conceptual pipeline:

1. Marked parses Markdown.
2. DOMPurify sanitises the base HTML.
3. `sdocs-app.js` inserts that HTML.
4. Feature processors replace inert placeholders such as
   `code.language-chart` with rich DOM.
5. CSS variables style the result.

The current orchestration in `public/sdocs-app.js` then invokes charts, math,
Mermaid, video, slides, forms, cells and highlighting.

The extraction risks are ownership and isolation:

- Browser modules communicate through the singleton `window.SDocs`.
- Several modules locate a fixed `_sd_rendered` element.
- Charts, cells and slides hold document-global mutable state.
- Fullscreen and keyboard behavior can be document-global.
- The full page eagerly loads SmallDocs feature wrappers even when their heavy
  third-party libraries remain lazy.
- Current JavaScript and CSS cache for one day, not immutably by SDK version.

The first representative feature slice must prove a practical sharing seam
between the current classic-script app and the new browser module. Chart is the
initial candidate for that engineering probe. The result must generalise
through later slices rather than turn chart into the SDK's scope.

## Phase 0: executable isolation and security spike

This spike is disposable. It answers a small set of architectural questions
before production extraction begins.

### Three surfaces to compare

Render the same plain document and representative full-depth document using:

1. A stripped reader in a sandboxed iframe
2. A custom element with Shadow DOM
3. Direct rendering into a host-owned element

Measure and inspect:

- Amount of existing code reused
- Host CSS and SmallDocs CSS leakage
- Font and theme inheritance
- Document height and resizing
- Sticky navigation behavior
- Fullscreen and overlay ownership
- Keyboard and focus behavior
- Module requests for plain versus rich documents
- CSP compatibility
- What host privileges renderer code receives

The iframe is a legitimate experimental embed, not a straw man. It can ship
first to one internal pilot if it gives a real application the current reading
surface faster. It also remains the safer tier for applications that require
containment from renderer or dependency compromise.

The native custom-element path is preferable only if the spike demonstrates
that its tighter layout and theming integration are worth the extraction cost.

### Phase 0 security deliverables

Before choosing the native surface, write:

- A threat model
- A sanitiser allowlist
- A parser-provenance design for rich blocks
- A remote-content and network policy
- A resource-budget table
- A dependency and release-integrity policy
- A CSP and Trusted Types compatibility decision

These are release inputs, not Phase 5 hardening.

### Phase 0 acceptance

- One host page has only an import and `<div id="report"></div>`.
- Plain Markdown renders with headings, prose and a table.
- A plain document makes no rich feature requests.
- A rich document loads only the modules required by its content.
- Script, event-handler and `javascript:` payloads do not survive.
- Host CSS and renderer CSS behavior is visible for all three surfaces.
- The spike identifies the exact code-sharing seam using one representative
  feature.
- The selected surface and its security guarantee are recorded in an ADR.

## Phase 1: the native walking skeleton

Build the smallest trustworthy renderer:

- Target resolution
- Optional front matter parsing
- Marked with existing SmallDocs Markdown behavior
- An SDK-specific DOMPurify policy
- Base reader CSS
- Heading IDs
- Automatic navigation
- Unknown-fence source fallback
- One render generation
- Destroy and remount update
- Exact-version hosted ESM

No rich feature abstraction is required yet.

### Automatic navigation convention

The initial convention should be decided once and documented. A proposed rule
is to show navigation when at least two eligible section headings render.
There is no agent setting and no per-document capability declaration.

## Phase 2: first representative slice

Chart is the proposed first extraction vehicle, not the intended product
boundary. If the isolation spike reveals another feature with a cleaner and
equally representative seam, use that feature instead.

Chart is a useful first extraction because it proves:

- Content-driven discovery
- Lazy feature code loading
- A heavy third-party renderer
- Input validation
- Cleanup
- Multiple-instance state
- Error fallback
- Sharing code with the current reader

### Minimal chart contract

Do not begin with a generic
`discover/mount/update/destroy` framework. Start with:

```js
const cleanup = await mountCharts(context);
```

On update, call cleanup and remount. After chart plus at least one meaningfully
different feature have been extracted, derive the smallest common contract
from real differences.

### Code-sharing sequence

1. Add black-box characterization tests around current chart behavior.
2. Define which chart behaviors belong in an embedded read-only report.
3. Run the same semantic fixtures against the SDK and observe failures.
4. Extract the smallest shared parser and configuration core.
5. Give the existing app and SDK thin adapters around that core.
6. Keep both suites green.
7. Remove old duplicate logic only after both consumers use the shared code.

The embedded chart must match the existing reader's understanding and visual
quality. Application-only source mutation and style-panel hooks remain outside
the rendering kernel.

## Safe content discovery

The reviews exposed a useful design tension:

- Scanning the sanitised DOM is simple and matches the current architecture.
- Trusting classes found in DOM is unsafe because raw HTML can forge
  `language-chart` or internal SmallDocs classes.
- A general token dependency graph is too much machinery for one feature.

Use a narrow provenance registry:

1. Marked parses the document.
2. When the trusted code-fence renderer sees a recognized `chart` token, it
   records an instance-local block record.
3. It emits an inert placeholder carrying an opaque generated block ID.
4. The sanitiser removes author-provided internal `sdoc-*` classes,
   `data-sdoc-*` attributes and custom elements.
5. After insertion, hydration resolves only the opaque IDs present in the
   parser-owned registry.
6. Raw HTML that imitates a chart class remains ordinary sanitised content and
   never triggers module loading.

The registry maps the fixed feature name `chart` to a fixed module URL.
Document text never contributes to an import URL.

When math or Mermaid arrives, reuse this approach if it still fits. Do not add
a dependency graph until nested slides make one necessary.

## Render lifecycle

Each mounted document owns a `RenderSession`:

- Root or iframe handle
- Parsed metadata
- Current Markdown
- Current generation number
- AbortController
- Cleanup stack
- Chart instances
- Observers, timers and listeners
- Diagnostics for the active generation

### Generation rule

AbortSignal alone is insufficient because dynamic imports and third-party
renderers may not be cancellable.

Every render captures a monotonically increasing generation number. Before
every asynchronous DOM commit it checks:

```js
if (signal.aborted || session.generation !== generation) return;
```

Cleanup is registered before asynchronous work begins. Disconnecting or
destroying an instance increments the generation and runs cleanup.

### Multiple instances

ES module code and immutable lookup tables may be shared. Mutable document
state may not.

Two SmallDocs on one page must not share:

- Chart objects or parsed chart stores
- Counters
- Heading IDs
- Observers
- Timers
- Fullscreen state
- Keyboard ownership
- Error queues
- Theme state

## Security model

### Trust boundaries

Treat as untrusted:

- Markdown
- YAML front matter
- Raw HTML
- Rich-block payloads
- Links and media URLs
- Remote assets referenced by a document

Treat as trusted and privileged:

- Host application JavaScript
- SDK configuration
- SmallDocs SDK code
- Every bundled third-party dependency

Native renderer code executes with the host application's origin and
JavaScript privileges. Shadow DOM is style isolation, not a sandbox. A
sanitiser bypass or compromised SDK dependency can affect the host page.

Separate native instances provide correctness isolation, not confidentiality
from one another. Applications requiring containment from renderer code should
use the separately hosted sandboxed iframe tier if Phase 0 validates it.

Browser extensions and a malicious host application are outside this threat
model.

### SDK-specific sanitiser policy

Do not copy the full reader's default DOMPurify policy without review. Define
explicit semantic tag and attribute allowlists for the embedded surface.

The initial policy should:

- Permit the semantic HTML needed for prose, headings, lists, tables, links,
  figures and code.
- Forbid scripts, inline event attributes and inline styles.
- Forbid document-authored forms and controls in the rendering-only SDK.
- Forbid iframes, objects, embeds, media tags, metadata tags, templates and
  document-authored custom elements.
- Strip author-provided internal classes, attributes, slots and parts.
- Normalize URLs through an SDK-owned protocol policy.
- Harden against DOM clobbering and named properties.
- Decide and test Trusted Types support.

Every post-sanitise feature has a separate output trust contract. For chart,
construct DOM from validated data rather than reinserting document HTML.

### Network policy

Automatic network activity can disclose document content, viewer identifiers,
IP address, referrer and authenticated same-origin requests.

Before a public SDK release, the user must approve a default policy for:

- Markdown images
- Fonts
- Links
- Same-origin relative URLs
- Future video, slide images and Mermaid links

The security review recommends:

- No document-triggered remote requests by default
- Host-provided fonts
- Video click-to-load when video ships
- No referrer on permitted external requests
- An explicit host network policy for more permissive applications

This is a recommendation pending product approval, not an invisible
implementation choice.

### Resource budgets

Before the first release, measure representative documents and approve bounds
for:

- Markdown and front matter bytes
- Token, heading and code-block counts
- Table cells
- Total rich blocks
- Chart source bytes
- Chart datasets, points, labels and string sizes
- Chart numeric ranges and finite values
- Generated DOM nodes
- Concurrent module loads
- Render wall time diagnostics

Promises and timeouts cannot interrupt synchronous parsing or chart layout.
Input budgets are the first availability defense. Worker isolation can be
considered later for expensive pure parsing.

### Dependency and release integrity

- Use exact dependency versions.
- Do not retain mutable major-version jsDelivr aliases in the SDK.
- Serve runtime dependencies from the same exact SmallDocs release or bundle.
- Make builds reproducible.
- Produce checksums and an SBOM.
- Document the security reporting and advisory process.
- Use correct JavaScript MIME types, CORS and `nosniff`.
- Never redirect an exact-version module to mutable content.
- Explain that SRI on one ESM entry does not automatically protect its
  transitive graph.
- Recommend npm or self-hosting later for sensitive applications.

### CSP

The first release must run in a strict fixture without `unsafe-eval`. Decide
whether Shadow DOM styling uses external versioned stylesheets or another
CSP-compatible mechanism. Do not inject unrestricted global style tags.

Test:

- `script-src` for hosted ESM
- `style-src` for renderer styles
- `font-src` and `img-src` for the selected network policy
- `require-trusted-types-for 'script'` if supported
- CSP violation reports contain no document content

## Distribution and caching

Start with one distribution:

```html
<script type="module">
  import { render } from
    'https://smalldocs.org/sdk/0.1.0/smalldocs.js';
</script>
```

Use `smalldocs.org` behind its existing CDN rather than introducing a separate
CDN service.

Every exact version directory is immutable:

```http
Cache-Control: public, max-age=31536000, immutable
```

Feature modules and pinned dependencies use relative URLs within that release.
The browser downloads the core and only the feature modules encountered in a
document, then reuses them across pages and later visits. A single-page
application imports each module once for its page lifetime.

A moving alias such as `/sdk/latest/` or `/sdk/v1/` must revalidate and must not
carry `immutable`.

The current server caches general JavaScript and CSS for one day. Add an
explicit exact-version SDK route rather than changing all application assets.

Do not add a service worker initially. Do not design npm, self-hosting, source
maps and bundler interop simultaneously. After the hosted API survives a real
pilot, publish the same release directory as an npm package.

## Initial repository layout

Keep canonical SDK source separate from the CLI:

```text
sdk/
  browser/
    smalldocs.js
    render-session.js
    markdown.js
    chart.js
    reader.css
    vendor/
  README.md

public/sdk/ -> ../sdk/browser/
examples/sdk-readonly/
test/sdk/
```

Do not add `sdk/package.json` until npm distribution becomes the current
vertical slice. The root server and CLI package remain separate.

The hosted demo and future npm artifact must eventually execute the same
canonical files.

## Two-track delivery sequence

The project should create feedback early without redefining the final product
around whichever feature is easiest to extract first.

### Track A: full-fidelity iframe SDK

Build a stripped reader page around the existing SmallDocs renderer:

- Sandboxed iframe wrapper
- The stable `SmallDocs.render(target, markdown)` host API
- `postMessage` input with strict origin and source checks
- Height synchronization
- Theme handoff
- The current full reader feature set
- No comments, editing, cloud or document export
- One internal integration followed by a small pilot

Because this engine hosts the actual reader, it can offer full rendering depth
from the beginning. It establishes integration, caching, sizing and trust
feedback while the native renderer is re-architected.

Do not promise that iframe is temporary. If some customers value its
containment, it may remain a supported engine.

### Track B milestone 1: native core

- Safe Markdown
- Front matter styles
- Typography and navigation
- Unknown-fence fallback
- Instance lifecycle
- Content provenance registry
- Hosted exact-version ESM

This is an internal engineering milestone, not the definition of the SDK.

### Track B milestone 2: representative rich feature

Use chart first unless the Phase 0 spike identifies a better probe:

- Lazy module discovery
- Shared core with current reader
- Input validation
- Async readiness and fallback
- Cleanup and multiple-instance behavior

The purpose is to prove the extraction pattern.

### Track B milestone 3: renderer family

Port a second and third different feature, likely:

1. Syntax highlighting or math
2. Mermaid
3. Video after network behavior is approved

Only then derive a shared feature contract from the implementations that
exist.

### Track B milestone 4: stateful depth

Port the features that require deeper re-architecture:

- Cells models, formulas, tab groups, selection and fullscreen exploration
- Inline slides and shapes
- Nested rich content inside slides
- Presentation mode and fullscreen ownership

Work feature-by-feature, but keep the iframe engine as the visible parity
reference.

### Track B milestone 5: parity cutover

Create one full-depth parity document and a capability matrix. The native
engine can become the default only when:

- Every agreed reader feature passes semantic fixtures
- Visual comparisons have no unexplained differences
- Network and lazy-loading behavior is verified
- Multiple instances and cleanup pass
- Accessibility behavior is equivalent
- Fallbacks remain readable

Until then, the iframe engine is the full-fidelity SDK and the native engine is
an experimental implementation behind the same API.

### Later platform work

- npm package
- Self-hosting guide
- Framework wrappers if evidence shows they help
- Full reader migration onto the shared kernel
- Comments and agent revision events
- Export services

## Test-first extraction method

For every feature:

1. Add a representative fixture to the current reader.
2. Write semantic black-box assertions before moving code.
3. State which behaviors belong in the embedded product.
4. Run the fixture against the SDK and watch it fail.
5. Extract the smallest shared pure core or DOM builder.
6. Give both hosts thin adapters.
7. Run both suites green.
8. Add malformed, oversized, network and cleanup fixtures.
9. Remove the old path only after both consumers use the shared code.

Prefer semantic assertions over whole-HTML snapshots:

- Visible text
- Heading IDs
- Table semantics
- Chart canvas or error state
- Source preservation
- Keyboard behavior
- Network requests

Use screenshot parity later for visual drift.

## Native walking-skeleton acceptance tests

### Core rendering

- A clean host with one import and `#report` renders a heading and paragraph.
- Duplicate headings receive stable, unique IDs.
- Navigation targets headings in the correct instance.
- Host CSS does not break the renderer if Shadow DOM wins Phase 0.
- Renderer CSS does not style the host page.
- An unknown fence remains readable as code.
- Parser errors produce a bounded visible fallback.

### Representative lazy feature slice

- Plain Markdown requests neither chart adapter nor Chart.js.
- One chart fence loads the exact-version chart code once.
- Malformed chart input leaves source or a bounded error.
- Huge arrays, deep JSON, non-finite values and extreme strings are rejected by
  approved budgets.
- Two instances share module code but not chart state.
- Updating chart Markdown to plain Markdown destroys the chart exactly once.

### Security

- Script tags, event attributes and unsafe URLs do not execute or survive.
- Forged `language-chart`, `data-sdoc-*` and internal `sdoc-*` markup never
  hydrates.
- Forms, controls, autofocus, popovers, custom elements and clobbering names
  are removed.
- Content-derived values never affect import URLs.
- Style metadata cannot create `url()` or `@import` requests.
- Remote content behavior matches the approved network policy.
- A delayed render cannot write after update, destroy, disconnect or target
  replacement.
- One instance cannot target another through IDs, selectors, events or delayed
  completion.
- Strict CSP passes.

### Lifecycle

- Render and update promises settle after chart success or fallback.
- The newest overlapping update wins.
- Destroy is idempotent.
- Update after destroy rejects.
- Removing the host element triggers cleanup for a custom-element
  implementation.

### Distribution and cache

- Exact version URLs return immutable cache headers.
- A moving alias revalidates.
- Plain and chart examples load from a clean temporary host.
- Hosted modules have correct CORS, MIME and `nosniff` behavior.
- There are no unversioned transitive runtime requests.
- Released exact-version bytes do not change.

## Accessibility

- Use semantic headings, lists, tables, figures and code.
- Give navigation an accessible name.
- Preserve heading order.
- Make navigation and chart controls keyboard reachable.
- Give charts a meaningful text fallback.
- Respect reduced motion.
- Test zoom and the existing mobile breakpoint.

## Documentation

The first documentation answers:

1. How do I render Markdown?
2. What does `#report` mean?
3. Does an agent need to know about SmallDocs?
4. How does SmallDocs discover rich blocks?
5. What is downloaded for plain Markdown versus a rich document?
6. How are SDK files cached across pages?
7. How do I update or destroy a view?
8. How does styling interact with the host?
9. What network requests can document content cause?
10. What security guarantee does native embed provide?

Include a network-panel walkthrough showing core load, one lazy feature load
and cache reuse on another page.

## Product and commercial decisions before public release

1. SDK license and redistribution terms. The repository's Elastic 2.0 license
   may not express the intended commercial embedding terms.
2. Whether native rendering is free infrastructure, a paid SDK or an entry
   point to metered hosted services.
3. Whether the SDK performs telemetry. The proposed default is none.
4. The embed sizing contract: document height, internal scrolling, sticky
   navigation and host overflow.
5. The automatic navigation threshold.
6. The default remote image and link policy.
7. Whether all runtime dependencies must come from the exact SmallDocs release.
8. Browser support baseline.
9. Stable syntax expectations across SDK versions.
10. Whether the iframe containment tier is a supported product or only a
    prototype.

## Definition of done for the full renderer

A developer can write:

```js
const view = await SmallDocs.render('#report', markdown);
```

and receive:

- A readable, responsive SmallDoc inside their application
- Automatic navigation
- Automatic discovery and lazy loading of every agreed SmallDocs rendering
  feature
- Full semantic and visual parity with the native SmallDocs reader
- No agent feature negotiation
- No application-authored parsing code
- Visible fallbacks
- Safe treatment of untrusted Markdown under the approved threat model
- Correct update, cleanup and multiple-instance behavior
- Cached exact-version modules
- A plain HTML example

Internal vertical slices are how this result is built and tested. They do not
reduce this definition to Markdown plus one convenient feature.

## Review record

### Security review

Accepted:

- Make the trust boundary explicit.
- Treat Shadow DOM as style isolation, not containment.
- Add an iframe decision for higher-containment applications.
- Use a strict SDK-specific allowlist.
- Hydrate only parser-proven rich blocks.
- Make remote-content policy and resource budgets release decisions.
- Vendor or serve pinned dependencies from the exact release.
- Gate late asynchronous commits by render generation.
- Move security work into Phase 0 and Phase 1.

### Kent Beck-style review

Accepted:

- Replace the horizontal framework plan with a walking skeleton.
- Characterize current behavior before extraction.
- Use Markdown plus one representative feature as the first extraction proof.
- Derive a shared feature interface only after real extractions.
- Use destroy-and-remount updates first.
- Keep one public API and one readiness mechanism.
- Make every feature an independently testable increment toward full parity.

### DHH-style review

Accepted:

- Lead with Markdown, not agents.
- Keep the public API conventional and small.
- Prove demand before extracting the whole reader.
- Start with one hosted exact-version distribution.
- Use smalldocs.org rather than introducing a new CDN service.
- Delay npm and framework packages.
- Extract cells and slides later because they require deeper state work.
- Add licensing, telemetry, sizing and network behavior to the product
  decisions.

### Deliberate synthesis

The design reviews proposed discovering rich blocks from sanitised DOM because
that is the simplest current seam. The security review showed that raw HTML can
forge those classes. The plan adopts a small parser-provenance registry without
adopting the original general token dependency graph.

The custom element remains a candidate, not a foregone conclusion. Phase 0
compares it with a sandboxed iframe and direct host DOM before the native
surface is selected.

### User correction after review

The reviewers' recommendation to begin with one chart slice was initially
written as a chart-sized first product. That was an accidental narrowing.

The corrected plan keeps the incremental method but restores the intended
destination:

- The SDK must render the full agreed depth of SmallDocs.
- The iframe track supplies full fidelity early.
- Chart is only a representative extraction probe.
- The native renderer becomes default only after the parity matrix is complete.
