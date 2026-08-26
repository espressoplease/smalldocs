# Canonical slides SDK acceptance matrix

## Goal

Use the same slide renderer and presentation components in the production SmallDocs reader and the browser SDK. Preserve production rendering and interaction. Remove the SDK slide approximation after the shared component passes the production and clean-customer suites.

## Intentional host differences

| Capability | Production reader | SDK |
| --- | --- | --- |
| Document history | May read and write `present=N` | Must not change the host URL, history, title, or hash |
| Slide comments | Available through the existing comment capability | Omitted because comments are outside SDK 0.2.0 |
| Application export menu | Remains in the SmallDocs application shell | Slide downloads are exposed by the canonical presentation component |
| Images | Preserve existing safe remote and data-image rendering | No upload, proxy, hosting, or new image pipeline in this work |

All other visible slide rendering and presentation behavior should come from the same canonical implementation.

## Existing production faults to characterize before extraction

- An asynchronous `sdoc-slide-error` event can be attributed to the last slide because the loop listener closes over a function-scoped `wrapper` variable.
- Presentation refresh can leave a blank stage and invalid counter when an update removes slides below the active index.
- The slide-comment hit layer currently has a reproducible alignment failure immediately after the presentation comment panel opens.
- The Present button tooltip advertises Enter even though the inline button has no separate Enter shortcut. Native button activation with Enter and Space must still work.

These faults should receive narrow regression tests and fixes before their surrounding code moves. The comment alignment fix remains production-only but protects the canonical presentation refactor from preserving a known regression.

## Shared component boundaries

### Reader-owned slides controller

`createSlides(reader, services)` owns only slides under `reader.root` and receives:

- shape parser and renderer
- template resolver and standard templates
- nested chart, Mermaid, math, and code processors
- presentation service
- clipboard and diagnostics helpers
- per-render abort signal and cleanup registry
- control options

It must not query the whole document, consult mutable application state through `window.SDocs`, or mutate host history.

### Per-render shape session

Before either host shares the inline controller, shape rendering must return an owned session:

```text
renderShapes(dsl, mount, { runtime, signal, ...options })
  -> { result, ready, destroy }
```

The runtime is captured for that call. `ready` settles after nested work or abort. `destroy()` is idempotent and disconnects scaler and nested-render observers, charts, timers, polling, and temporary stages. Rendering again into the same mount destroys the previous session. SVG resource IDs include the reader and render identity.

### Reader-owned presentation controller

`createPresentation(reader, services)` reuses the production rail, topbar, stage, mobile behavior, and export panel. It receives:

- a root-scoped slide collector
- a history adapter
- an optional comments capability
- an owner-aware overlay service
- style and theme forwarding from the reader root
- export services
- nested renderer services

One presentation may be visible per browser document, but it must retain the owning reader identity. Updating or destroying another reader must not close or mutate it.

### Per-call export services

PDF and PowerPoint generation receive the deck, owning reader, style source, shape runtime, nested rasterizers, dependencies, filename, abort signal, and cleanup collection for each call. No mutable `ACTIVE`, `SDK_RUNTIME`, or document-wide slide lookup may determine export content.

## Acceptance matrix

### 1. Inline slide rendering

- A `slide` fence is replaced by the canonical `.sdoc-slide` structure in both hosts.
- Template declarations stay hidden and consumers resolve in document order, including consumers that precede a template.
- All documented standard templates render through the same resolver.
- Grid size and background, aspect ratio, shape geometry, layers, references, text roles, autofit, rotation, style references, and per-shape copy controls match production.
- The Present control has the same markup, icon, dimensions, contrast behavior, label, hover, focus, and control-option behavior.
- The Present control label and tooltip describe the action without advertising an unsupported shortcut.
- Slide body text remains selectable and the slide body is not an activator.
- Parse, bounds, template, and style-reference failures use the canonical visible diagnostic and copyable source report. Nested chart and Mermaid diagnostics are tracked as an improvement because current production behavior is not consistent.
- An error from slide A cannot appear on slide B.
- Two readers with identical slide indices render independently.
- Updating or destroying a reader cancels pending nested work and removes its listeners, observers, temporary nodes, and presentation.

### 2. Desktop presentation

- Opening from slide N shows slide N in the canonical dialog.
- Previous and next actions clamp at the first and last slide. They do not wrap.
- The SDK and production use the same rail, thumbnails, topbar, counter, previous and next controls, copy action, export panel, close action, geometry, and responsive behavior.
- Rail thumbnails preserve nested chart snapshots and remain scoped to the owning deck.
- Arrow keys, Space, Page Up, Page Down, Home, End, and Escape behave as production does and do not steal keys from form fields, links, buttons, selectors, or other interactive controls.
- Opening and closing preserve horizontal and vertical scroll state and restore focus to the invoking control.
- Production deep links with `present=N`; the SDK leaves host URL, history, hash, and title unchanged.
- Production refresh after deck growth, shrink, or reorder rebuilds the rail, clamps the active index, and never shows stale thumbnails, a blank stage, or an invalid counter. Refresh to zero slides closes the presentation.
- SDK `update()` follows the existing lifecycle contract and closes its owned presentation before replacing the document rather than refreshing it in place.
- Two reader instances cannot mix slide sources, styles, thumbnails, counters, or cleanup.

### 3. Mobile presentation

- Portrait and landscape layouts use the canonical production component.
- Swipe navigation, pinch zoom, double-tap zoom, pan bounds, landscape chrome hiding, ghost close, Fullscreen API handling, and best-effort orientation locking remain functional.
- Mobile slide counts and navigation are reader-scoped rather than document-wide.
- Closing, update, and destroy remove document classes, listeners, timers, transforms, fullscreen state, and orientation locks owned by that presentation.

### 4. Nested rich content

- Chart, Mermaid, and math inside slide shape Markdown render inline and in presentation mode. Highlighted nested code is a possible later enhancement, not current parity.
- A plain slide deck does not request unused nested feature libraries.
- Nested renderer failures settle the parent render and leave a visible bounded diagnostic.
- Strict Trusted Types and the documented CSP continue to work for nested math and Mermaid.
- Two decks may perform nested rendering concurrently without swapping runtimes or signals.

### 5. Styles and host control

- A named set of mapped SmallDocs variables produces matching critical slide and presentation computed styles in production and the SDK. Production retains `--md-*`; the public SDK contract retains its documented `--sdocs-*` mapping.
- Explicit `grid bg=`, shape `fill=`, `color=`, and other DSL attributes override inherited document values as they do in production.
- SDK customer variables and scoped, unlayered CSS can restyle the reader without requiring an iframe or Shadow DOM.
- Presentation overlays inherit variables from their owning reader, not from `#_sd_rendered`, the document root, or the last mounted SDK instance.
- An aggressive host reset does not make canonical controls unusable, while SDK CSS does not style elements outside the renderer.
- Narrow host containers on wide viewports produce a usable inline slide without relying only on viewport breakpoints.

### 6. PDF and PowerPoint

- PDF produces one page per rendered slide, preserves each page's grid ratio, and keeps supported native text and primitives vector or selectable while retaining the documented raster exceptions.
- PPTX preserves the established editable shape, freeform polygon, text, rotation, and rich-content rasterization behavior.
- Mixed-ratio PPTX normalization remains explicit and tested unless the exporter is deliberately enhanced later.
- Chart, Mermaid, math, icon, cloud, and other raster paths use the owning deck's runtime and do not include raw source text.
- Downloads have correct filenames, MIME types, non-empty bytes, and no leaked object URLs or measurement stages.
- Concurrent export requests from separate readers cannot use the other reader's deck, styles, runtime, filename, or abort signal.
- Disabled SDK download controls prevent the corresponding presentation actions without producing a second presentation design.

### 7. Accessibility and ownership

- Existing dialog, control labels, `aria-modal`, focus restoration, and keyboard behavior remain intact.
- As launch-quality improvements, the active rail item should expose a programmatic selected state, counter changes should be announced without interrupting slide reading, and focus should remain within the open presentation unless a nested owned overlay is active.
- Escape closes only the top owned overlay and then the presentation, not an unrelated reader surface.
- Reduced-motion coverage beyond the current mobile rules is an optional improvement, not a parity gate.

### 8. Loading, security, and compatibility

- Plain Markdown loads no slide implementation or slide export dependencies.
- A slide that uses no icon does not load the full icon bundle.
- Two readers deduplicate identical immutable assets while keeping models and mutable state per instance.
- First-party shared slide sources and CSS are generated into the versioned SDK snapshot and the manifest check fails on drift.
- Markdown and shape content continue through the current sanitisation and Trusted Types boundaries.
- Unsafe HTML, URLs, attributes, IDs, names, SVG, Mermaid output, and slide source cannot escape the reader or impersonate owned assets.
- An older unsupported renderer leaves a new or unknown slide fence readable as source.
- The plural `slides` fence is either adopted by both hosts as a documented alias or removed from the SDK approximation. It must not remain an accidental host difference.
- Any source-size, shape-count, polygon-point, numeric-range, or slide-count limits require a separate product decision. If adopted, they must produce a readable diagnostic and must not break template resolution by truncating declarations before resolution.

## Test strategy

For every implementation slice:

1. Add a production characterization or regression test before moving behavior.
2. Run the same Markdown fixture through production and a clean customer SDK page.
3. Compare semantic DOM, classes, controls, labels, selected computed styles, and behavior. Normalize only generated instance IDs.
4. Exercise two readers, update, destroy, and a delayed nested renderer.
5. Run focused production suites and the native SDK suite.
6. Visually inspect desktop, narrow-container, and touch-sized presentation checkpoints.
7. Remove the corresponding SDK approximation only after both hosts call the canonical component.

## Proposed vertical delivery

1. Correct the acceptance criteria and characterize error attribution, presentation refresh, boundary, keyboard, scroll, tooltip, and comment-panel behavior.
2. Make shape rendering per-call, abortable, disposable, and resource-ID safe without changing visible production output.
3. Extract canonical inline slide processing and use it from production first.
4. Connect the SDK to the canonical inline controller, establish snapshot drift checks, and use a new immutable SDK version before public release.
5. Move PDF and PowerPoint generation to per-call reader contexts.
6. Extract the canonical desktop presentation with injected history, comments, export, accessibility, and overlay capabilities.
7. Add reader-owned mobile presentation behavior. Automatic fullscreen, orientation locking, and persistent coachmarks are opt-in SDK capabilities rather than default host effects.
8. Prove nested rich-content parity, multi-instance isolation, styling, CSP, and lifecycle cleanup throughout each preceding slice.
9. Delete the remaining SDK slide approximation after clean-customer parity passes.
