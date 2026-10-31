# Staging CLI installation

## Hosted install

Staging deployments build `/cli/sdocs-dev.tgz` from the same immutable release as the server. `https://cloud-staging.smalldocs.org/install` installs that package, including its staging channel metadata. Windows uses `npm i -g https://cloud-staging.smalldocs.org/cli/sdocs-dev.tgz`. Production `/install` continues to use npm latest. No npm publication is needed to test a staging release.

Install settings uses the current origin before login and skill setup, selects the displayed library, and verifies Cloud status. Hosted staging packages keep automatic production upgrades disabled; their manual reinstall command uses the hosted staging installer.

## Source install

The maintainer installer copies the current source CLI runtime into an explicit installation directory. It includes uncommitted CLI changes, records a SHA-256 fingerprint of the copied runtime, and writes `cli/channel.json` inside the installed copy. It does not change the source package, authenticate, install agent skills, or edit shell startup files.

Build into a temporary directory first:

```sh
node scripts/install-staging-cli.js --sdocs-home /tmp/smalldocs-staging-install
```

The returned JSON identifies the version, destination, source fingerprint, staging origin, and any previous CLI runtime backup. Re-running against the same destination moves the previous runtime into `cli.previous-TIMESTAMP-ID`; existing state beside `cli/` stays intact.

## Replacement on a developer machine

Before replacing an existing global install:

1. Record `command -v sdoc`, its real target, CLI version, current skill edition, and discoverable SmallDocs skill paths.
2. Stop and disable the old local library agent with the old CLI's `sdoc library autostart disable` before archiving its installation. Check that the `dev.sdocs.library` LaunchAgent and its listening process have stopped.
3. Move the existing `~/.sdocs` directory into a dated archive outside agent skill discovery. Preserve its local documents, styles, credentials and bindings there. Do not copy production credentials or bindings into the fresh staging directory.
4. Move the canonical `~/.agents/skills/smalldocs` directory and any independent old SmallDocs skill copies into that archive. Remove or replace SmallDocs symlinks in agent-specific skill directories so agents do not discover two editions. Keep unrelated skills and agent configuration intact.
5. Install the current source with `node scripts/install-staging-cli.js --sdocs-home "$HOME/.sdocs"`.
6. Ensure `~/.sdocs/bin` precedes any old npm global binary on PATH, then run `hash -r` in existing shells. Check the command again in a new shell.
7. Run `~/.sdocs/bin/sdoc setup --cloud --yes`, then inspect the generated canonical skill and agent symlinks.
8. Run `sdoc cloud status --json`. A fresh staging installation is logged out. Authenticate with `sdoc cloud login`; it uses the staging service and stores a staging-scoped credential.

The archive is a recovery copy, not another active installation. Agent configuration files may also contain old always-on SmallDocs blocks. Setup removes recognized managed blocks while preserving surrounding instructions.

## Channel behavior

Installed `channel.json` has this shape:

```json
{
  "schema_version": 1,
  "channel": "staging",
  "origin": "https://cloud-staging.smalldocs.org",
  "update_policy": "manual",
  "source_sha256": "runtime fingerprint",
  "reinstall_command": ["node", "/path/to/smalldocs/scripts/install-staging-cli.js", "--sdocs-home", "/path/to/.sdocs"]
}
```

The origin lives in the installed package and survives new shells. Browser links, Cloud APIs, help examples, and setup/refresh skill links use it. Conflicting production `--url`, `SDOCS_URL`, or `SDOCS_CLOUD_URL` values are rejected. Cloud HTTP redirects are not followed, and local bridge/library browser connections are scoped to the installed staging origin.

Automatic binary updates and npm update checks are disabled regardless of old setup preferences or cached npm versions. `sdoc upgrade` exits with status 1 and prints the source reinstall command. It does not run that command, a hosted `/install` script, or npm. `NO_UPDATE_NOTIFIER` is not the mechanism enforcing this behavior.

Login/logout skill guidance uses the installed `sdoc setup --cloud --yes` or `--standard --yes` command. It does not suggest a hosted installer that could select npm production releases.

`setup` and `refresh` use the current bundled skill version and preserve the installed origin. Refresh also replaces a production-bound skill with the staging edition when both have the same skill version. Skill auto-refresh remains available; it updates guidance from the already installed CLI and does not install another binary.

A package without `channel.json` retains the standard production defaults and existing npm/URL upgrade behavior. Invalid metadata stops the CLI instead of silently falling back to production. Installation-specific metadata is ignored by Git and generated only in the installed copy.

## Verification

Run the channel suite with a temporary home:

```sh
node -e 'const h=require("./test/runner"); require("./test/test-install-channel")(h)().then(()=>h.report())'
```

The suite tests default origin selection, production override rejection, same-version skill replacement, refresh, manual upgrade, cached auto-update preferences, local origin checks, and preservation of installation state during reinstall. It does not change the current user's installation.
