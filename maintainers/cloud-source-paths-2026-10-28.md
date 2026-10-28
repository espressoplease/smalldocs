# Creator-only Cloud source paths

Staging release: `26d66acc02d34ac1ffcefad499ac0f59841076c1`.

## Behaviour

- New CLI Cloud documents preserve the canonical absolute working-file path and the relative argument when one was supplied.
- Browser Add to Cloud preserves paths already supplied by the local CLI.
- The prose file-info card and whole-file code view use the existing copyable path rows, labelled Only you. They omit the redundant filename when paths are available.
- These paths identify a source file. They do not enable a live bridge or prove the file still exists, especially on another computer.
- Paths belong to the document creator. Other members, library owners and admins receive no `source_file` field and cannot update it.
- Existing paths survive collaborator revisions and library moves. Moves reencrypt them with the destination project key.
- Paths stay separate from shared Markdown, revision content, exports, snapshot links, search indexes and tags. They are encrypted at rest in `cloud_document_source_files`. Existing document creation receipts also encrypt their response payloads.
- The read and write paths recheck access after asynchronous cryptographic work.

An older bound file with unchanged content backfills missing paths when its creator opens it through the CLI. This does not create a content revision. Existing source paths are retained rather than overwritten with a collaborator's or downloaded copy's location.

## Validation

- Full Node suite: 2,147 passed, including six source-path API/CLI/privacy cases.
- Browser suite: 19 passed across source paths, Cloud comments, Cloud reader loading and code-comment parity. After refining the filename fixture, both source-path browser cases passed again.
- SDK snapshot and release-manifest verification passed for 0.3.1.
- Diff whitespace check passed.
- Live staging test using a disposable acceptance document: eight checks passed, including installed CLI relative/absolute capture, fresh browser display and reload, no duplicate filename, shared-member API and DOM privacy, rejected collaborator source update, and unchanged-reopen revision stability.
- The live test document was deleted and its temporary CLI credential revoked. The temporary login secret and credential profile were removed.
- The user's currently open document was backfilled from its existing local binding through the creator-only API. Its content revision remained unchanged.

## Deployment and local installation

Before deployment, staging state and configuration were backed up to:

`/var/backups/smalldocs-staging/creator-paths-20261028T164018Z.tar.gz`

Archive SHA-256: `54d125ac30d1bffca120e506bdfdb62322c050baebba3da4a822e66ddcc3abc6`.

Staging version after deployment: `8717b593fa`.

Both local staging CLI installs were updated, with backups retained:

- `/Users/mac/.sdocs/cli`
- `/Users/mac/code/smalldocs-cloud-experiment/.experiment/home/.sdocs/cli`

Runtime fingerprint: `28939e4bbfbcc73f824c21cc067553ae12d135b77ae6e25b24b99089a083312f`.

All 54 packaged runtime files matched the deployed staging tarball, checked-out source and both local installations. All 18 existing Cloud state files were unchanged by the installation. CLI help and public reference documentation describe the path behaviour; the agent workflow and skill v43 are unchanged.

Production release pointer, configuration hash and service-unit hash remained unchanged. No npm package was published.
