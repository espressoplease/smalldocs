# Cloud direct editing evaluation

28 October 2026. Local, disposable fixtures. No staging or production deployment.

## Delivered behavior

The original full-document read and pull/edit/push commands remain available. Direct editing adds selected reads, exact replacements, original-base batches, contextual unified diffs and previews. Saves use the existing permissions, subscription checks, merge transaction, encrypted revisions, idempotency and 90-day history. The browser continues to check revisions on focus and every ten seconds while visible.

`cloud edit` returns a compact receipt with the saved revision, complete content hash, match locations, contextual diff, overlap excerpts and Cloud URL. It does not return the complete Markdown. Large diagnostics identify truncation. Match failures and overlapping operations within a batch save nothing. Concurrent overlapping passages from different writers remain preserved by default.

The source Cloud skill is v41. The installed staging CLI and skill must be released together with the server routes. This work does not install an incompatible skill against the existing staging server.

## Clean-context agent trials

Eight agents received fresh contexts, an isolated CLI, the generated skill and ordinary document tasks. They could inspect accessible documents and help, but not application source, credentials, fixture controls or evaluation answers. Documents, IDs, libraries and several policy values were generated per run. An external inspector checked the stored result and unrelated documents, independently of agent claims.

| Trial | Observed result |
| --- | --- |
| Baseline, existing CLI | Used pull/edit/push, saved one intended line, preserved metadata and decoys. Fourteen calls, 58,623 bytes of CLI output, excluding skill text. |
| Initial direct batch | Naturally selected direct Cloud editing, saved two changes in one revision and preserved the unrelated sandbox document. |
| Long document, scoped batch | Read 37 relevant lines of a 1,539-line document. Saved the two intended changes atomically. External check found exact expected Markdown and unchanged metadata/decoys. Ten calls. |
| Initial concurrent overlap | First save retained both passages and a concurrent note. The agent then consolidated the explicitly requested policy value. This exposed formatting noise and the need for clearer overlap excerpts. |
| Proposal only | Returned a scoped preview. External check found the original revision, content and metadata unchanged. |
| Access revoked before save | Save and subsequent read failed generically. No content revision was created and no permissions were broadened. |
| Final inline batch | Naturally used inline `--edits`, saved exactly two intended lines in one revision and verified scoped content. Nine calls and 29,709 bytes of CLI output, excluding skill text. |
| Final concurrent preservation | Kept both policy passages and the concurrent note without imposing a review. External check found exact expected Markdown, including unchanged metadata formatting. One injected human revision and one agent revision. |

The baseline and final tasks have different document sizes and workloads. These figures describe those trials, not a controlled latency or token benchmark. General help and the full authoring skill remain substantial; agents that fetched them unnecessarily used more output. Scoped operational reads avoided the long audit section in the final batch trials.

## Iterations from feedback and review

- Added inline JSON batches alongside JSON files, so a small batch needs no temporary file.
- Added bounded base/current/proposed overlap excerpts and explicit truncation fields.
- Added a combined find/read/edit path to focused edit help.
- Explained account creation capability separately from document editing permission.
- Added recovery guidance for an unavailable document without claiming a previous interrupted request could not have committed.
- Preserved byte-identical front matter during body-only concurrent merges. Differently serialized metadata still uses the established comment-aware merge, with a duplicate-comment regression test.
- Enforced the existing document size limit while planning edits, before large replacements are materialized. Valid final batches may include expanding and shrinking operations in either order.
- Streamed repeated replacements and used compact numeric line offsets. Separate subprocess regressions capped at a 96 MiB heap cover ten million replacement matches and a 10 MiB newline-heavy document, without reducing document limits.
- Replaced quadratic repeated patch-context matching with a linear matcher. Added CRLF, EOF, repeated-context and malformed-input regression cases.

## Reproduce

```sh
node test/run.js
npx playwright test test/cloud-direct-edit.spec.js test/cloud-ui-real.spec.js --workers=2
node scripts/update-eval/text-edit-fuzz.js
node scripts/update-eval/direct-edit-lab.js
```

The lab prints isolated task directories and URLs. Run each trial in a fresh agent context using its local `AGENTS.md`, skill and `./bin/sdoc`. Keep fixture controls outside the agent context. Inspect results from the parent workspace:

```sh
node scripts/update-eval/inspect-direct-edits.js LAB_ROOT targeted review revoked
node scripts/update-eval/inspect-direct-edits.js LAB_ROOT overlap --keep-overlaps
```

The seeded differential check verifies 1,000 exact replacements against an independent splice oracle and 300 actual system `diff -u` patches against their target documents. The short regression suite covers ambiguity, atomic failure, stale revisions, overlap preservation, lost committed responses, permission revocation, cross-company access, output bounds and parallel writers.

Final validation: all 2,034 Node checks pass, alongside 12 browser checks and the 1,300 seeded differential cases. The independent reviewer reran the original resource and comment reproductions, plus 100 line-index cases crossing numeric-index chunk boundaries. No actionable findings remain from that review. The CLI package dry run includes both new runtime modules and no bundled dependencies.

The browser test uses a real fixture server and verifies both focus and timer updates. A page sentinel and `performance.timeOrigin` confirm that the document updates without reloading the page. Existing browser tests also cover merging unsaved browser edits and comments.

## Practical limits

Heading selection recognizes root ATX and setext headings outside fenced code. It does not implement every Markdown container rule. Use line selections or exact surrounding context for unusual structures. A repeated patch context must be made unique; a line offset alone does not choose a copy. Partial reads still decrypt the selected full revision on the server, but return only the requested content to the agent.

The edit receipt's diff describes the change from the concurrent head to the saved result. To inspect all intervening human contributions, use revision history or compare the original base with the saved revision. Retaining conflicting passages can leave contradictory prose or invalid structured text, as with the existing merge policy.
