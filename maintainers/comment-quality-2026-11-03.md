# Comment structure and agent cleanup

The test document is [Release operations field guide](https://cloud-staging.smalldocs.org/docs?cloud-document=c08e69d3-929b-4e66-90f2-872752a96b87), saved in Joshua Eichler-Summers with smalldocs, qa and comments tags. Its source is `test/fixtures/comment-structure.md`.

## Corrections

- Selection highlights no longer extract or clone partially selected list items, paragraphs or code containers. Safe inline selections use one span; structural selections use text fragments with the same comment ID and one card.
- Overlapping highlights exclude existing comment cards and controls. Selecting feedback text does not offer a new document anchor.
- List-item hosts cover each run of own content, including paragraphs after nested lists. Nested lists retain their original parents, and the item card follows its final own-content run.
- Complete contexts survive list insertions. Repeated and overlapping contexts remain ambiguous instead of selecting the first matching item.
- Server-generated offsets identify their normalized whitespace basis. The browser translates them to DOM positions. Older anchors can use a whitespace-normalized context fallback, preserving the actual document text.
- Nested code selections use the same sidecar during composition and after saving. Late highlighting preserves selections and drafts.
- Async callbacks from an earlier render cannot rebuild the current document's comment controls.
- Deliberate Cloud mode changes persist immediately; style and document URL updates remain debounced. Reloading feedback keeps comment mode.
- Selection popovers stay inside the viewport.

## Agent workflow

Cloud skill v48 and CLI help treat cleanup as part of addressing feedback. Verify the saved passage, then normally delete its addressed thread. Resolve with a note when retaining the discussion is useful. Resolution keeps the card visible; deletion removes the current thread and replies. Earlier revisions retain feedback under the existing 90-day policy.

An edit never automatically closes feedback. Edit, push and bound-file open receipts expose `comment_follow_up`, with open and resolved counts, up to 20 open IDs and a truncation indicator. Preview reminders explicitly require saving and verification first. Finish by listing all remaining open comments; unclear feedback stays open.

## Validation

`test/comment-structure.spec.js` checks actual accessibility list markers as well as DOM parentage, paragraph and code content, block and inline comments, compose/cancel/save/delete, overlapping formatting, repeated text, 30 varied selections, desktop/mobile views, and Cloud save/reload/edit/cleanup. The original saved cross-item case reproduced additional list items before the correction.

Two clean-context agents worked through an isolated real CLI and HTTP backend. One naturally verified the change, deleted the addressed thread, preserved another writer's injected operator note, retained unrelated feedback, and left an unclear question open. The other prepared a proposal without changing document or feedback state. Parent-side checks confirmed exact body expectations and unchanged decoy documents. The lab inspector now accepts either verified deletion or resolution as completion.

The targeted Node suite covers comment models, source projections, rebasing, direct edits, CLI actions, previews, retention, permissions, retries and skill/setup installation. SDK snapshots remain unchanged.

These checks cover the observed failure classes. They do not guarantee recovery of an author's intended anchor after arbitrary rewriting. Lost or ambiguous feedback remains visible for explicit inspection.
