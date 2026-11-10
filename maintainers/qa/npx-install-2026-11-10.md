# Global NPX Cloud skill installation

10 November 2026. CLI 1.20.2, Cloud skill v54.

The Cloud Install page, its copied prompt, CLI login/help and `/docs` now lead with:

```sh
npx --yes skills@latest add https://smalldocs.org/agent-skills/cloud --global --yes
```

The old production homepage used the same global installer with the standard skill URL. The Cloud edition replaces that same named skill. The outer `--yes` accepts the npm download and the inner `--yes` installs for detected supported agents without another selection prompt. `--all` is deliberately absent because it targets every known agent, rather than detected installations.

The CLI now recognises the installed canonical skill's edition even if an older `setup.json` says standard or declined. This keeps ordinary `sdoc FILE.md` saves Cloud-first after NPX installation. It does not change automatic-update consent. Explicit computer-default changes also update a legacy local default so it cannot shadow the server's selected library.

Hosted skills use their own service origin. Production exports retain the exact v54 body. A staging export links to staging without claiming that an ordinary production CLI binary has staging-only restrictions.

## Executed clean-context agent trials

The previous evaluator supplied a generated skill and asked for command plans. The new opt-in [runner](../../scripts/npx-skill-agent-lab.js) performs real installation and executed work:

```sh
node scripts/npx-skill-agent-lab.js --run --output /tmp/smalldocs-npx-eval
```

Each case gets a new temporary home, Codex home and project outside this repository. The only copied host file is Codex authentication, with mode 0600, deleted with the fixture. Host configuration, plugins, rules, prior sessions, project instructions and other skills are absent. Bundled Codex skills are disabled in the disposable configuration. No production SmallDocs credential or data is used.

The actual `npx skills@latest` installer fetches the skill from the isolated HTTP server. The runner verifies its bytes against the hosted resource, then asks Codex's `skills/list` API for the inventory. Every tested agent saw exactly one enabled user skill: `smalldocs`. The runner does not write the skill body or insert SmallDocs instructions into the task prompt.

Thirteen independent fresh-context cases passed, plus a library-choice follow-up:

| Task | Observed result |
| --- | --- |
| Ordinary operations report, twice | Chose SmallDocs without a tool name, inspected existing tags, saved and linked the tagged document. Correctly calculated 2% impact and 24 minutes. |
| Generic artifact request | Chose SmallDocs without its name and reused relevant existing tags. |
| Adjustable hiring budget | Created a live formula workbook and interactive chart. Independently recomputed closing cash of 165,000, 138,000 and 111,000. |
| Five-slide briefing | Consulted the slide reference, validated five slides and invoked presentation mode. |
| Staffing calculator | Created a runnable component, inspected tags and saved it. |
| Feedback and historical repair | Found the earlier approved launch date, retained the newer timeout and tags, recorded edit reasons, deleted the addressed note and preserved the unrelated open and resolved discussions. |
| Folder library | Used the `.sdocs.json` destination and its tag vocabulary. |
| Two libraries without a default, twice | Asked which library to use and made no premature upload. After the follow-up "Use Engineering", saved there and returned its real link. |
| Explicit CSV request | Created the requested CSV and made no Cloud upload. |
| Signed-out report, twice | Observed the actual authentication error, requested authorization and made no false save or link claim. |

Independent headless browser checks verified the calculator at 390px and 1440px in light and dark themes. It calculated 180 initially, 240 after changing staffing, preserved state through fullscreen and return, and had no horizontal overflow. The budget chart changed with its assumptions and showed the expected cash values. These checks validate behavior and geometry, not a complete visual review of every generated artifact.

The real installer was also tested with Claude Code, Codex and Gemini CLI detected in a disposable home. Codex and Gemini used the universal canonical directory; Claude received its agent-specific link. Behavioral model trials used Codex only.

An independent review of the traces confirmed the outcomes. The authoring agents did not perform their own browser inspections: structural validation and invoking `sdoc present` do not establish that an agent observed the render. The independent checks above establish the calculator and budget behavior. One slide used an unsupported template slot; the validator explained it and the agent fixed it before saving. One ambiguity run made a redundant tags request after status had already reported the unresolved library choice.

Evidence: [structured results](../evaluations/cloud-npx-agent-install-2026-11-10.json). Additional validation: 2,331 Node checks and 16 onboarding browser tests passed.

Release commit `344005c61db268e0b1321885d41e8f1494eee293` was deployed to staging and production. npm 1.20.2 was published with provenance by the tag workflow. All 60 downloaded package files matched the CLI source; the tarball integrity and source commit matched. A real NPX install using that published CLI also verified that stale standard setup state cannot override the new Cloud skill. The local staging installation was updated without replacing its credentials or origin. [Release receipt](release/2026-11-10-npx-install.json).

## Related production checks

- Google sign-in with the existing production account reached `/cloud/admin?panel=install`. Separate browser fixtures covered fresh email and Google signup through profile, Personal library, trial and Install. No new live Google account was created.
- Production uses Resend SMTP at `smtp.resend.com:587`, with STARTTLS and a systemd-supplied credential. A live connection validated the certificate and authenticated successfully. No email was sent, so this does not establish inbox delivery.
- The local-library preference is available to everyone. It defaults on for migrated preexisting accounts and off for new accounts.
- Storage accounting currently measures retained revision payloads and encrypted revision metadata, not the entire physical database. A production read measured approximately 1.5 MB of counted revisions, 166 MB of database files and 157 MB of search structures, with approximately 31 GB free. Physical storage monitoring and search cleanup remain operational follow-ups; changing customer quotas is a separate decision.
