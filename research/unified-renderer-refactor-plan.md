# One SmallDocs reader, two hosts

## Decision

The production application and the SDK should not contain separate renderers.

SmallDocs should have one canonical, instance-scoped reader. The existing application and the SDK should host that reader in different ways:

- The SmallDocs application supplies comments, editing, sharing, local file access, URL state, and application chrome.
- The SDK supplies a mount element, document content, lifecycle methods, and customer configuration.
- Both use the same parser orchestration, DOM components, CSS, controls, fullscreen views, downloads, and rich feature implementations.

The current SDK lifecycle and security work is useful. Its independently implemented UI is not the right long-term boundary.

## What is wrong today

There are currently two rendering paths.

The production path in `public/sdocs-app.js` parses the document, decorates headings, tables, quotes, and code, then invokes the mature chart, math, Mermaid, video, slide, cell, highlighting, and comment modules in a specific order.

The SDK path in `sdk/browser/native/core.js` has its own orchestration, its own code controls, its own stylesheet, a generic fullscreen overlay, a separate spreadsheet renderer, and a separate presentation experience.

This means the SDK is not returning the production reader's HTML and styles. It is recreating the idea of the reader. Parser sharing cannot produce fidelity because much of SmallDocs is implemented after Markdown parsing through DOM controllers, feature state, overlays, downloads, keyboard handling, and CSS.

The two examples the current SDK exposes most clearly are:

- Production code blocks use `attachCodeCopyButtons()` and the full `sdocs-code-focus.js` viewer. The SDK uses `decorateCode()` and a generic overlay.
- Production slides use `sdocs-slides.js` and `sdocs-present.js`. The SDK has a separate presentation implementation.

Changing the SDK CSS would make those experiences look closer, but it would leave two implementations that can drift again.

## Target architecture

### Reader instance

Introduce one small per-document reader session. It should grow only when a real extraction needs another dependency.

```js
const reader = createReader({
  root,
  markdown,
  meta,
  options,
  services: {
    assets,
    clipboard,
    downloads,
    overlays,
    preferences,
    history,
    comments,
    sourceWriteback,
    forms,
    fileResolver
  }
});

await reader.render();
await reader.update(nextMarkdown);
reader.destroy();
```

The instance owns:

- Its root and generated IDs.
- Current Markdown and metadata.
- Per-feature state, such as charts and cell workbooks.
- An abort signal and generation number for asynchronous work.
- Event listeners, observers, object URLs, timers, and cleanup.
- Any fullscreen surface opened from that document.

Feature components receive the reader instance or a deliberately smaller context. They must not discover their document through `#_sd_rendered`, `document.querySelectorAll()`, or mutable `window.SDocs` state.

### Two hosts

The production host remains the complete SmallDocs application. It creates one reader and supplies adapters backed by the existing application state. `window.SDocs` can remain temporarily as a compatibility facade while individual features are extracted.

The SDK host remains a small browser API:

```js
const view = await render('#report', markdown, options);
await view.update(nextMarkdown);
view.destroy();
```

It supplies read-only defaults and does not mutate the customer application's title, hash, history, or global styles.

The SDK should not contain its own implementations of code focus, slide presentation, cells, Mermaid focus, or other reader UI.

### Capabilities, not forks

Some production features do not belong in the initial SDK. That should create configuration differences, not separate components.

For example, the canonical code viewer can receive a comments capability. The production application supplies it, so comment controls appear. The rendering SDK does not, so those controls are absent. Copy, wrap, fold, fullscreen, theme, and download remain the same component with the same markup and CSS.

The same boundary applies to:

- URL and history integration.
- Cloud sharing.
- Local bridge and source file access.
- Document writeback.
- Form submission.
- Comments and editing.

### Canonical CSS

The production reader stylesheet should become the SDK stylesheet.

1. Add a canonical root class such as `.sdoc-reader` to the existing `#_sd_rendered` element.
2. Move reader selectors from fixed IDs and application-wide theme selectors to that class gradually.
3. Keep application chrome CSS separate from reader and feature CSS.
4. Use the existing `--md-*` custom properties as the supported styling contract.
5. Load the same canonical CSS in the SDK, optionally in a low-priority CSS layer so customer CSS can override it naturally.
6. Keep fullscreen surfaces canonical. Copy the owning reader's computed variables to the fullscreen portal.

The document should remain in light DOM. Shadow DOM would work against natural customer styling. A custom element could be added later as syntax sugar, but it does not solve this architecture.

Reader layout should respond to the width of its mount using container queries. Fullscreen views should continue to respond to the viewport.

### Overlays

Code focus, Mermaid focus, cell focus, and slide presentation should keep their purpose-built production UI. They should share a small ownership mechanism, not one generic visual overlay.

A per-document overlay manager should track:

- Which reader owns each overlay.
- Body scroll lock with reference counting.
- Escape handling for the top overlay only.
- Focus containment and focus restoration.
- Nested overlays, such as Mermaid focus opened from a slide presentation.
- Cleanup when a reader updates or is destroyed.

## Migration strategy

This should be a feature-sized strangler refactor, not a rewrite.

For each slice:

1. Characterize current production behavior.
2. Extract the exact production component into an instance-scoped factory.
3. Make the production application its first consumer.
4. Run the existing production suite unchanged.
5. Make the SDK consume the same factory.
6. Run shared production and SDK parity tests.
7. Delete that SDK approximation.

No slice should leave two editable canonical implementations.

### Slice 1: code blocks and code focus

Start with code because it is visibly different and exercises most important boundaries.

- Preserve `.pre-wrapper`, `.pre-tools`, the current button order, icons, sizing, and CSS.
- Convert `sdocs-code-focus.js` from singleton state to `createCodeFocus(reader)`.
- Inject comments, share, and local file behavior as optional capabilities.
- Scope overflow detection, resize handling, keyboard listeners, generated IDs, and cleanup to the reader.
- Switch the SDK to the canonical component.
- Remove SDK `decorateCode()` and its generic code overlay.

Acceptance checks:

- Inline wrap, copy, expand, and download controls match production.
- Fullscreen toolbar, line numbers, folding, theme, and keyboard behavior match production.
- Download filename and bytes match.
- Production comments and sharing still work.
- SDK-only code views omit unavailable controls without changing the remaining layout.
- Two readers can open the correct code independently.
- Update and destroy remove only the owning reader's listeners and overlay.

### Slice 2: slides and presentation

- Make slide processing reader-owned.
- Convert `SDocPresent` into `createPresentation(reader)`.
- Scope slide discovery to the reader root.
- Preserve the exact inline button, presentation rail, topbar, navigation, mobile behavior, and exports.
- Inject production URL behavior. The SDK default is no host URL mutation.
- Pass nested chart, math, Mermaid, and shape dependencies per reader instead of reading mutable globals.
- Switch the SDK to the canonical presentation and remove its substitute.

Acceptance checks include custom shapes, keyboard navigation, mobile landscape, copy, PDF, PPTX, nested features, different aspect ratios, two decks, and update or destroy while presenting.

### Later slices

A practical order after code and slides is:

1. Math, highlight, and video.
2. Mermaid and Mermaid focus.
3. Cells, cells focus, scratch editing, and XLSX.
4. Charts.
5. Base headings, tables, blockquotes, and collapsible sections.
6. The shared orchestration sequence.
7. Forms and source-backed content after their host I/O policy is explicit.

The order is adjustable. The invariant is that production adopts the extracted component before the SDK does.

## Packaging and lazy loading

Do not add a framework or bundler as a prerequisite.

The application can keep its buildless UMD modules while they become instance factories. Add a dependency-free release script that snapshots the canonical reader modules and CSS into an immutable SDK version directory. Generated SDK snapshots must never be hand-edited, and CI should fail if their manifest differs from the canonical source.

The SDK's ESM entrypoint remains a thin loader and lifecycle facade.

Lazy loading remains content-driven:

- Ordinary Markdown loads the reader core only.
- A document containing Mermaid loads the canonical Mermaid feature.
- A document containing slides loads the canonical slide and presentation components.
- Shared library downloads are cached by exact URL across reader instances.
- Render models, controllers, feature state, and cleanup stay instance-local.

A pinned SDK release must not silently execute later production code. It should be a release snapshot of the same canonical source, not an independently maintained copy.

## Compatibility and risk controls

The main rule is that current production rendering remains the reference behavior.

- Add `.sdoc-reader` alongside `#_sd_rendered`; do not remove the ID early.
- Keep `window.SDocs` as a compatibility facade while modules move behind reader instances.
- Avoid broad selector renames and global state removal in one commit.
- Put each feature extraction in a separately reversible change.
- Run the full production suite before switching the SDK.
- Do not ship the new SDK as complete until every advertised surface uses a canonical component.

The current native SDK's private parser and sanitizer, Trusted Types support, generation aborts, versioned assets, mount ownership, and `render` / `update` / `destroy` lifecycle should be preserved. Sharing the production UI must not reintroduce ambient host globals into that security boundary.

## Shared parity harness

The same fixture document should render through both the production host and an isolated customer host.

Compare:

- Normalized semantic DOM, canonical classes, ARIA labels, and control order.
- Selected computed styles and geometry.
- Fixed-font screenshots at mobile, desktop, and narrow-container widths.
- Light, dark, and custom theme variables.
- Clipboard and download results.
- Fullscreen interaction and keyboard behavior.
- Feature cleanup after update and destroy.

Normalize instance-specific IDs and unstable Mermaid internals instead of relying on one large HTML snapshot.

Important isolation tests include:

- Two mounts with identical headings and feature names.
- Simultaneous lazy loading with one network request per asset.
- An update overtaking an earlier asynchronous render.
- Destroy during Mermaid or chart work.
- Overlay ownership, Escape order, focus restoration, and scroll-lock cleanup.
- Aggressive customer CSS resets and deliberate customer overrides.
- Current XSS, DOM clobbering, Trusted Types, and CSP cases.
- Production retains its hash, history, comment, edit, Cloud, and bridge behavior.
- SDK does not mutate host history or expose unavailable production controls.

For the features the user can see and manipulate, screenshots alone are insufficient. Both hosts should run the same behavior contract.

## Known edge cases found during review

- Charts keep global active instances and document-delegated listeners.
- Cells keep workbook and fullscreen state on the singleton application namespace.
- Code, Mermaid, cells, and presentation each hold module-global focus state.
- Presentation and exports scan document-wide slide collections.
- Several features fall back to `#_sd_rendered`.
- Body classes and scroll lock do not currently have per-reader ownership.
- Async rich features can finish after an SDK update unless they use the active generation signal.
- Production presentation history behavior would collide with a customer SPA.
- Host CSS resets can disturb controls unless the canonical stylesheet includes a scoped reset.
- Local preferences should not accidentally span unrelated customer applications.
- Existing production code and presentation components mix app-only services into otherwise reusable UI.

One likely existing production bug should be tested separately: the asynchronous slide error listener in `public/sdocs-slides.js` appears to close over a function-scoped `var wrapper`, so an error from an earlier slide may be appended to the final slide. It should receive a characterization test and a separate fix, not be hidden inside the SDK refactor.

## What should disappear

As canonical components are adopted, remove the matching hand-built SDK code:

- SDK code decoration.
- The generic SDK visual overlay where it substitutes for a production fullscreen component.
- The SDK presentation implementation.
- Separate SDK cells and other feature UIs.
- Independently edited SDK reader CSS.
- Hand-maintained forks of production feature modules.

The finished SDK should contain distribution, asset discovery, lifecycle, security, options, and service adapters. It should not contain a second interpretation of how a SmallDocs document looks or behaves.

## First deliverable

The first implementation milestone is not a complete renderer rewrite. It is a customer fixture in which one code block uses the exact production inline controls and exact production fullscreen viewer, while the normal SmallDocs application remains unchanged.

That proves the central seam: one component, two hosts, natural customer CSS, optional application capabilities, and reversible migration. Slides should follow immediately because they expose the second major fidelity problem and exercise nested features, overlays, exports, and responsive behavior.
