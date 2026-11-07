# Cloud save-and-open experiment

Implemented 15 October 2026 on `codex/homepage-next-review`. This is an opt-in CLI prototype; it does not change the default installation, publish an npm release or deploy the homepage.

## Try it

Run the branch's CLI from this checkout:

```sh
node cli/bin/sdocs-dev.js report.md --cloud
```

The existing `sdoc cloud login` flow must already have connected the CLI. With multiple accounts, specify a destination:

```sh
node cli/bin/sdocs-dev.js report.md --cloud --account ACCOUNT_ID
```

Use `--json` for one machine-readable result and `--no-open` to save without launching a browser. A Cloud-first setup's preferred account is reused unless `--account` overrides it.

The globally installed `sdoc` does not receive this change until a CLI release. After release, the command would be `sdoc report.md --cloud`.

## Behavior

1. Upload through the authenticated CLI using existing create/push operations and idempotency handling.
2. Bind the local file to the saved document and revision using the existing binding store.
3. Construct the existing production document URL, `/docs?cloud-document=DOCUMENT_ID`, from the same Cloud origin.
4. Open that exact URL and print it in full, or return it as the JSON `url` field.
5. Further runs update the same document. Unchanged files do not create another revision.

The browser uses its own session and existing document permissions. A CLI credential does not sign the browser in automatically. If the browser is signed out, the existing sign-in flow is still needed.

Failed uploads do not open a purported saved document. Local work remains intact, pending idempotency state supports retry, and JSON errors have a nonzero exit status. If the file changes during upload, the result reports `local_changed_after_upload`; a successful upload then describes the saved snapshot, not the newer local content.

This experiment uses the existing Cloud create/push behavior, including revision conflicts and merge handling. It does not introduce an offline queue, file watcher, cloud-backed feedback sessions, emailed onboarding, trial entitlements or a new server route. Existing automatic Cloud-first setup behavior stays as it was; the new canonical-URL path is selected explicitly with `--cloud`. `--standard` keeps a normal open local even if Cloud-first setup is enabled.

## Live test

A small demo was created in the signed-in user's personal Cloud account, then edited and uploaded again. Chrome opened the exact URL returned by the CLI and loaded the second revision. A third unchanged run retained both the document ID and revision ID.

| Operation | Observed CLI elapsed time |
| --- | ---: |
| Initial create, without opening a browser | 306 ms |
| Update and browser launch | 384 ms |
| Unchanged rerun, without browser launch | 311 ms |

These are single observations for a small Markdown document on the current connection. They include process startup and credential access, but do not measure browser rendering, agent document generation or representative large-file performance.

## Validation

Cloud CLI tests cover matching printed/opened URLs, create then update, unchanged files, JSON output with tags, human output, missing sign-in, upload failure and local edits during an upload. Existing Cloud CLI and general CLI suites also pass.

Before expanding this into the default Cloud flow, measure different document sizes and networks, try a signed-out browser and another device, and decide how display options and guided walkthroughs should work with canonical Cloud URLs. Cloud-backed `sdoc feedback` remains a separate next slice.
