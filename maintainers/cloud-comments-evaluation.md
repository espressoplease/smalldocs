# Cloud comment feedback evaluation

28 October 2026. Local fixture evaluations followed by staging verification. Production unchanged.

## Result

Cloud feedback now has a structured CLI path, separate from downloading complete Markdown. It lists notes, replies, status, source context, location diagnostics and document/comment URLs. Agents can reply, resolve, reopen, delete, add and explicitly reattach comments. Source storage remains the document's encrypted Markdown, with the same permissions, revisions and retention as other content.

Browser reply and resolution controls use the existing comment cards. Exported footnotes remain readable, with a lossless structured sidecar for anchors and discussion metadata. Newly created comments get stable UIDs; legacy comments retain their original data until modified.

## Independent tasks

Seven fresh-context agents completed ordinary user requests in isolated workspaces. They saw a skill and CLI, without implementation source, fixtures, expected values or previous agents' findings. Production values were randomized. Each library included archive/draft/sandbox decoys, private inaccessible material, other authors' comments, resolved feedback, a missing target and 1,500 audit lines.

| Trial | Observed result |
| --- | --- |
| Previous CLI baseline | Correct edit, manual YAML handling and manual anchor retargeting. Full reads and a full preview produced large responses. |
| First structured-feedback candidate | Correct scoped edit, reply and resolution without a full read. Exposed a stale visual quote after the edit, which led to automatic source mapping. |
| Independent concurrent edit | Correct production change and resolution, with the injected operator note preserved. Missing feedback remained open. |
| More than one feedback page | Found the unresolved question beyond the first 25 notes. Preserved all 34 original comments and other authors' work. Requested author filters and automatic pagination. |
| Proposal only | No document, reply or resolution was saved. Exposed misleading preview revision_created, now false. |
| Access removed during editing | No content or comment action saved. The agent retained its proposed local change and reported the failure. |
| Author filter iteration | Naturally used author filtering and complete pagination; corrected the requested value, resolved its note and left the missing question open. Preserved all 34 notes and the exact unrelated body. |

The parent independently read final stored documents, compared body bytes with randomized oracles, checked note text/authors/status and decoy heads, and inspected command logs. The independent/concurrent, pagination and author-filter runs all retained an exact source match for the updated comment.

Agents still sometimes choose full reads or broad history diffs to verify preservation. Those outputs can be large. The structured interface removes the requirement to read the whole document, but does not make every agent's verification strategy token-efficient. A body-only comparison mode and an atomic edit-and-resolve operation remain useful possible follow-ups.

## Bugs found and corrected

- Reader and code viewer disagreed about duplicate and shifted targets.
- Inserting code fences could transfer a comment by ordinal.
- Portable exports lost location or thread fields, and quoted labels broke some imports.
- Reply layouts could overflow code; delayed highlighting could erase a reply draft.
- Deleted text could jump to another surviving occurrence, including stale add/reattach requests.
- Comment and targeted-edit retry receipts were not migrated with document moves.
- A concurrent save during decryption could escape the comment retry loop.
- Imported footnotes were projected against their raw bracket syntax, reporting valid anchors as lost.
- CRLF imports could parse literal fenced examples as feedback and remove Markdown hard line breaks.
- Initial page loading and URL normalization could consume a comment link before its focus was applied.
- A remote update could discard an unsaved reply draft. Cloud refresh now waits until the draft is saved or cancelled; a submitted reply merges with the newer content.

## Checks

The suites cover duplicate prose, formatted text, block/list/table/slide hints, shifted fences and code rows, tokens, multiline selections, removed targets, stable IDs, replies/resolution, portable imports/exports, source coordinates and layout geometry. Live Cloud browser tests cover updates to an open tab, browser replies surviving reload, and explicit repair of an unplaced comment.

API checks cover pagination snapshots, filters, dry runs, stale-note guards, simultaneous and staggered replies, lost responses, library moves, private documents, company separation, and revocation during decryption or encryption. The full-file pull/edit/push path and normal reader refresh remain covered by the existing direct-edit suites.

A local source-projection sample of 10,000 paragraphs (637,796 bytes) and 500 distinct exact comments returned all 500 matches in 168 ms. Observed process RSS grew about 65 MiB and used heap about 18 MiB. This is a single-machine diagnostic, not a latency or concurrency guarantee.

## Comment deletion follow-up

The branch CLI exposes `cloud comments DOCUMENT_ID --id c7 --delete --json`.
It removes the selected thread and replies from the current document. Earlier
revisions containing feedback follow the existing 90-day retention policy.
Resolve remains available when the discussion should stay in the document.

Validation: 47 comments API and CLI checks, 83 skill and setup checks, and five
headless reader checks passed. Coverage includes deletion preview, open and
resolved threads, deleting the last thread, portable footnote imports, unchanged
prose and metadata, retained history, lost-response retries, concurrent feedback,
company isolation and revocation during asynchronous work. The reader removes
deleted feedback without navigation and keeps the quoted document passage.

## Staging verification, 28 October 2026

Code release `fe955563a0ac99e62bf88e424202d64f4f0d1126` is deployed to
`https://cloud-staging.smalldocs.org`. The preceding release is `19da4852`.
Before deployment, staging state and configuration were backed up together at
`/var/backups/smalldocs-staging/cloud-comments-20261028T161204Z.tar.gz`.

The release passed all 2,141 Node checks and 36 targeted browser checks.
Sixteen live assertions used the installed CLI against staging and a separate
test account. They covered tagged creation, structured comments, direct edits,
anchor updates, replies, resolution, reopening, deletion preview and commit,
retained feedback history, unchanged body text and other comments, live browser
updates, and another account being unable to read or delete private feedback.
The test document was removed and the temporary CLI credential revoked.

All 54 packaged CLI runtime files matched the source release. The normal local
installation and `~/code/smalldocs-cloud-experiment` now use that staging runtime
and the exact generated Cloud skill v43. Eighteen existing Cloud state files
were unchanged by installation. Prior runtime and skill copies were preserved.
The package version remains `1.20.0-rc.11`; the installed runtime fingerprint is
`a8c0af63b70d541d792bb9085fc377ff25e35edf89c7f6eb035ad42bc88ec0e1`.
No npm package was published.

A browser controlled by the old service worker upgraded from `b26e89bdc0` to
`abffc7e34e` on ordinary reload. The new comment module loaded without page
errors. Both services remained active. The production release, environment
configuration hash and systemd unit hash matched their pre-deployment values.

The developer's existing staging session requires review and acceptance of
Terms version `2026-10-26` at `/cloud/terms`. Its credential was preserved; the
Terms were not accepted on the developer's behalf. Live checks used test accounts.

## Reproduce

```sh
node test/run.js
node scripts/update-eval/comment-agent-lab.js --baseline
node scripts/update-eval/comment-agent-lab.js
```

The lab prints isolated workspace paths and writes tasks outside those workspaces. Give a fresh agent one ordinary task and its workspace. Inspect results from the parent:

```sh
node scripts/update-eval/inspect-comments.js LAB_ROOT independent history review revoked
```

Use the branch CLI and source skill in disposable workspaces. Do not replace an installed skill with commands its deployed server does not yet support.

## Limits and research

Automatic source updates map a previously located range through edits and require surviving evidence. Plain prose, verbatim spans inside formatting, and code line/token/method anchors are supported. Selections spanning Markdown syntax and structural list/table/slide targets remain conservative. Missing or ambiguous targets retain their evidence and stay visible; explicit reattachment chooses their new passage.

Source diagnostics do not claim a verified visual attachment. Names and imported user IDs are editable document metadata, not proof of authorship. Existing document ACLs remain the authorization boundary.

The design uses the combination of positional and quote/context evidence described by the [W3C annotation model](https://www.w3.org/TR/annotation-model/#text-quote-selector) and [Hypothesis anchoring](https://web.hypothes.is/blog/fuzzy-anchoring/). The structured discussion model follows established comments/replies concepts in the [Google Drive comments API](https://developers.google.com/workspace/drive/api/guides/manage-comments). It does not claim collaborative character-by-character editing or guaranteed recovery of an author's intent after deletion.
