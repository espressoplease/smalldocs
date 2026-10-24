# Release staging and production from main

Merge product PRs into main before releasing. Use a clean checkout of the current origin/main commit. Keep unrelated local work in its existing checkout.

```sh
git fetch origin main
git switch --detach origin/main
./ops/deploy-staging.sh smalldocs-prod
```

Verify the changed behaviour on https://cloud-staging.smalldocs.org. Record the release commit and checks. With founder production approval, deploy the same checkout:

```sh
./ops/deploy-production.sh smalldocs-prod \
  /path/to/Secretive/public-key.pub \
  /path/to/pinned-known-hosts
```

The machine-specific key and host configuration are in AGENTS.local.md. SSH may request fingerprint authentication. Verify the production endpoints and confirm /opt/smalldocs/current and /opt/smalldocs/staging-current resolve to the intended release. The scripts retain the preceding release pointers for recovery.

For an isolated candidate before merging to main, pass its published branch explicitly:

```sh
./ops/deploy-staging.sh smalldocs-prod codex/homepage-next-review
```

This updates staging only. The candidate must be committed and HEAD must match the exact published branch tip. Production promotion still follows the main release procedure above.

The staging script defaults to checking that HEAD is the published main tip. The production script archives HEAD; it does not select a branch for you. Keep the same checkout between stages. If main advances during a release, finish or reassess that release explicitly rather than switching commits unnoticed.

## Reconciliation on 10 October 2026

Production history through bdfa137c was merged into main, preserving Cloud invitations, Cloud-first CLI uploads, Library analytics and the agent discovery index. Before changing the staging branch reference and adding this note, the reconciled Git tree matched the deployed production tree exactly. Subsequent releases should use main so production work remains in the shared history.
