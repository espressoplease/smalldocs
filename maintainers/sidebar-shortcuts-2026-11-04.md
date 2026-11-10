# Sidebar shortcuts and tooltips

The shared sidebar footer contains Account settings (or Sign in), What's new,
SmallDocs on X, and SmallDocs on GitHub. All four use the established circular
shortcut style. Social links open a new tab with `noopener noreferrer`.

The confirmed X profile is `https://x.com/smalldocs_org`. GitHub points to
`https://github.com/espressoplease/smalldocs`.

The existing document tooltip is now shared through `sdocs-sidebar-shared.js`
and `sidebar-shared.css`. One body-level tooltip escapes sidebar and toolbar
overflow clipping. Delegated events handle existing and newly rendered
`data-tip` targets. `SDocs.attachTooltips` remains available for existing callers.

Tooltips prefer the space below the target, switch above near the viewport
bottom, and clamp horizontally. The caret points to the target after clamping.
Keyboard focus also shows help; Escape, blur, click, scrolling and resize dismiss
it. Touch taps do not create hover tooltips. Labels use text nodes and preserve
any existing accessible description when the tooltip closes.

Validation covers document, Library and account sidebars with active trials and
paid subscriptions, short viewports, compact navigation, keyboard and touch use,
dynamic labels and escaped markup. Existing document actions, sidebar parity
and truncated-document-title tooltip checks pass. Full Node checks and the
SDK snapshot/manifest checks also pass.
