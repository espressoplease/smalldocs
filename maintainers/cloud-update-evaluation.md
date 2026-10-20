# Cloud document update evaluation, 20 October 2026

The candidate keeps the user's chosen permissive merge policy. Independent edits
merge; overlapping passages are both saved. It adds an agent-readable change log,
revision comparisons, read-only previews and clearer save receipts. Strict saves
remain an optional capability for tasks that explicitly need them.

## Agent trials

Nine valid clean-context trials used installed CLI snapshots, generated skills,
real HTTP authentication, encrypted stores and separate temporary workspaces.
Agents received ordinary user tasks and CLI help, without the oracle or hidden
interference. They could not inspect credentials, implementation or evaluation
answers. Final documents were inspected independently of the agents' reports.

| Trial | Observed result |
| --- | --- |
| Baseline targeted edit | Found the current policy among archived, sandbox, draft and private decoys; changed only the intended limit. |
| Baseline history repair | Recovered the verified phone and preserved the newer rota, but unintentionally renamed the Cloud filename after choosing a local working filename. |
| Baseline overlap | Both values were initially saved; the agent then made another save to resolve them. This preceded the user's explicit preference to retain both. |
| Baseline independent edit | Preserved a collaborator's appended operator note. |
| Baseline revocation | Save and read failed after access was removed; agent correctly reported no saved update. |
| Candidate history repair | Used old-revision reads, preview, guarded save and revision diff; recovered only the phone and preserved filename, newer rota and access. |
| Candidate permissive overlap | Saved both concurrent limit values and the collaborator's note in one save, verified the committed revision and inspected history diffs without an approval step. |
| Candidate proposal only | Two previews, no agent-created Cloud revision. Preserved another writer's intervening note and verified the current Cloud value remained unchanged. |
| Candidate independent edit | Used normal push, preserved the collaborator's note and verified the committed revision and change log. |

All decoy documents remained unchanged. Every candidate trial preserved the
Cloud filename. The proposal-only trial's extra revision came from the injected
collaborator, not the agent. One intermediate concurrency rerun was discarded:
its instrumentation fired on `push --help` before the read. The corrected harness
excludes help calls, and the concurrency scenario was repeated.

Agents requested revision diffs, historical reads, non-mutating previews,
read-only access inspection and clearer edit capability. Those are implemented.
One agent attributed canonical YAML quoting to pull; hashes proved pull preserved
the bytes. The merge during preview had canonicalized the front matter.

Machine-readable observations are in
`maintainers/evaluations/cloud-update-2026-10-20.json`.

## Deterministic and security checks

`node scripts/update-eval/concurrency.js` starts two real CLI processes against a
disposable HTTP server. It verifies simultaneous independent saves, simultaneous
overlapping saves preserving both values, optional strict-save atomicity,
response loss after commit with exact idempotent retry, and an unchanged push
refusing success after access revocation.

The new store/HTTP suite tests preview immutability across all database tables,
scalar/YAML/JSON/delete-edit conflict evidence, head changes during decryption or
encryption, revoked permissions, cross-organization isolation, pruned-base
recovery, reviewed-head checks and idempotency. CLI regressions cover download
and binding races, local deletion during upload, honest no-change receipts,
read-only history/access commands, unsupported dry-run rejection, restore
preview and explicit restore base revisions.

The audit found document mutation receipts stored merged Markdown in plaintext.
New receipts are encrypted with project keys and authenticated context binding.
Legacy document receipts are migrated before the server listens; active database
pages and WAL are scrubbed. Tests inspect raw database/WAL canaries, receipt
relocation, replay revocation and interrupted migration recovery. Older backups
are not rewritten by this migration and retain their existing backup policy.

Independent review also identified exact-retry failure after a library move and
filename-only preview/save disagreement. Both were fixed, including move/save
ordering races and receipt integrity downgrade tests. Location checks prevent
saving a receipt under a stale library key when another process moves the document.

The generated checks in `scripts/update-eval/generated.js` reconstruct 1,000
randomized line edits from their diffs and verify 300 independent two-writer
merges. The seed is fixed for reproduction. The headless HTTPS/CLI acceptance
test also checks non-mutating previews, committed revision hashes, filename
preservation, revision comparisons and history diffs.

## Final local validation

- Full Node suite: 1,706 passed, including 37 new store/HTTP preview and security tests and 72 CLI tests.
- Clean-context agent trials: nine valid trials across baseline and candidate rounds.
- Real concurrent CLI and lost-response scenarios: five passed.
- Generated checks: 1,000 diff reconstruction cases and 300 independent merge cases passed.
- Headless HTTPS access/search/fresh-CLI acceptance: three passed; the unrelated opt-in live Stripe portal test was skipped.
- Packed release candidate 1.20.0-rc.3 starts without runtime dependencies and contains the shared diff module and skill v33.
- Skill validator, exact changelog checks and setup migration scenarios passed.

Production deployment and npm publication are outside this candidate's release.

## What Google Docs contributes

Google's published collaboration design transforms small editing operations
against concurrent operations so clients converge. Its API exposes both a strict
`requiredRevisionId` and a `targetRevisionId` that incorporates collaborators'
changes. These mechanisms cannot decide which conflicting business fact is
correct. SmallDocs merges complete Markdown snapshots and deliberately keeps
both overlapping passages under the chosen policy.

References: [Google collaboration design](https://drive.googleblog.com/2010/09/whats-different-about-new-google-docs_22.html),
[Docs API write controls](https://developers.google.com/workspace/docs/api/how-tos/best-practices),
[Google version history](https://support.google.com/docs/answer/190843).

## Limits and decisions

History already exists for every document. The default retains the current
revision and up to three previous revisions, with previous revisions retained
for at most 90 days. `history --diffs` marks a missing parent as unavailable. This
is useful for recent repairs, but it is not an unlimited change archive. A longer
retention policy or named checkpoints should be chosen before promising long-term
agent recovery.

Permissive overlap may leave contradictory prose or invalid JSON, as explicitly
chosen. Concurrent YAML scalar edits still produce one effective rendered value;
both values are visible in diagnostics and retained history. Merges canonicalize
YAML quoting. This candidate does not implement character-level live editing,
named checkpoints, permanent history, or a shareable unsaved preview URL.
