// sdocs-cli-setup.js - single source of truth for the CLI install/update
// agent prompt and the platform-aware install / upgrade commands.
//
// Both the in-app footer (index.html) and the marketing homepage
// (homepage.html) read from here so the prompt and commands stay identical
// across the site. UMD so it is requirable in Node tests; in the browser it
// attaches to window.SDocCliSetup.
(function (exports) {
  "use strict";

  // The canonical prompt a user pastes into a coding agent to install OR update
  // SmallDocs and teach the agent its latest features. Kept in one place.
  var SETUP_PROMPT = "Please install or update SmallDocs for me, and make sure you (my coding agent) know about its latest features.\n\nSmallDocs is a CLI (`sdoc`) that renders local markdown files as styled, readable documents in the browser. It also supports charts, diagrams, slide decks, and interactive forms inside markdown. Nothing leaves my machine unless I explicitly run `sdoc share`.\n\nOnce it is installed and you know about it, I want to be able to say things like:\n\n- \"sdoc me a bug report on X\"\n- \"sdoc me this service's architecture\"\n- \"sdoc me an analysis of last month's results\"\n\nand you will write the markdown and open it for me as a SmallDoc.\n\nThe way you will \"know about it\" is through the SmallDocs skill: a SKILL.md whose short description sits in your agent's context and whose full reference loads on demand. `sdoc setup` writes one canonical copy to `~/.agents/skills/smalldocs/SKILL.md`. Agents using that universal location read it directly; other detected agents receive a symlink in their own skills directory (for example, `~/.claude/skills/smalldocs`).\n\nPlease do the following, and ask me before any step that changes my filesystem.\n\n1. Check whether `sdoc` is already installed.\n   Run `which sdoc` (or `where sdoc` on Windows).\n\n2. If it is NOT installed, install it, choosing the command that matches my operating system:\n   - macOS or Linux: `curl -fsSL https://smalldocs.org/install | sh`\n     This puts everything under `~/.sdocs/` (no root needed) and adds `~/.sdocs/bin` to my PATH via my shell's rc file.\n   - Windows: `npm i -g sdocs-dev` (needs Node and npm installed).\n   If it IS already installed, update it to the latest version: run `sdoc upgrade`. If that command is not found, re-run the installer instead (`curl -fsSL https://smalldocs.org/install | sh` on macOS or Linux, `npm i -g sdocs-dev@latest` on Windows).\n\n3. Make sure `sdoc` is on PATH.\n   Run `which sdoc` again (`where sdoc` on Windows). If it is still not found on macOS or Linux:\n   - Run `echo $SHELL` to see which shell I am using.\n   - For zsh, append `export PATH=\"$HOME/.sdocs/bin:$PATH\"` to `~/.zshrc`.\n   - For bash, the same line to `~/.bashrc`.\n   - For fish, run `fish_add_path $HOME/.sdocs/bin` or add it to `~/.config/fish/config.fish`.\n   - Then tell me to open a new terminal, or to run `source ~/.zshrc` (or the matching rc file) in mine.\n\n4. Teach yourself the latest features.\n   First, if `~/.agents/skills/smalldocs/SKILL.md` already exists, copy it aside and note its `v=N` version number (the `<!-- sdocs-skill: v=N -->` line). This snapshot is how you will spot exactly what a new release adds. On a fresh install there is no such file yet, which is fine.\n   Then run: `sdoc setup --yes`\n   This installs (or refreshes) the SmallDocs skill at ~/.agents/skills/smalldocs/SKILL.md. Agents using that universal location read it directly; other detected agents receive a symlink. The skill is bumped to match the CLI version you just installed, so you pick up the newest capabilities. It is the canonical writer; do not hand-roll the skill yourself, the wording is kept in sync with the CLI version.\n\n5. Verify it worked.\n   Ask me to start a fresh chat session with you (so the updated config file is loaded). In the new session, ask me to say: \"sdoc me a test file\". A styled document should open in my browser.\n   If it does not open, check that `~/.agents/skills/smalldocs/SKILL.md` exists and, for an agent with its own skills directory, that a `smalldocs` symlink points to it. Tell me what is missing.\n\n6. Offer me a tour. Ask first, and only show the parts I say yes to - do not run the whole thing unprompted. The point of the tour is for me to learn what I can ask you to generate, so build each example from my own work where you can, and for every output tell me the plain phrase I could say to get it next time. (If you are not sure whether this is a first install or just an update, ask me which.)\n\n   For a first install, offer to walk me through it:\n     a. Privacy: write a short SmallDoc - a few real lines, for instance about this project - and open it (`sdoc path/to/file.md`), then explain in a line or two that the whole document travels in the URL fragment (the part after `#`), which browsers never send to a server, so nothing leaves my machine unless I run `sdoc share`.\n     b. Code: open one of my real source files as a SmallDoc (`sdoc path/to/file`) so I can see the syntax highlighting and the comment lane. Pick an obvious one, or ask me which.\n     c. Rich outputs: build one SmallDoc, drawn from my real work where possible, that shows the block types SmallDocs can render, and for each one tell me the phrase I could say next time:\n        - a diagram, e.g. of this project's structure (\"sdoc me a diagram of this flow\")\n        - a slide deck (\"make me a slide deck and sdoc it\")\n        - a branded slide deck in my own colours - run `sdoc slides` first for the shape and styling syntax, and ask me for a brand colour (or use the document's accent colour)\n        - a chart of some real numbers (\"sdoc me a chart of these numbers\")\n        - a live spreadsheet (\"sdoc me a budget with live totals\"); run `sdoc cells verify path/to/file.md` to confirm the totals compute before you open it\n     Run the matching reference commands (`sdoc diagrams`, `sdoc slides`, `sdoc charts`, `sdoc cells`, `sdoc code`) to get each block's syntax right before you write it.\n\n   For an update, do not re-tour everything. Compare the skill at ~/.agents/skills/smalldocs/SKILL.md now against the snapshot you took aside in step 4. Tour only what actually changed: the bullets that were added or reworded, which the higher `v=N` in the `<!-- sdocs-skill: v=N -->` line confirms. Walk me through each genuinely new capability the way the first-install tour does - build it from my real work and give me the plain phrase I would say to get it again. If the block is unchanged from before (same `v=N`, same text), this was a maintenance release with no new authoring features: tell me that plainly and skip the tour rather than repeating things I already have.\n\nIf any step fails, stop and tell me what happened before doing more.";

  SETUP_PROMPT = SETUP_PROMPT
    .replace(
      "Nothing leaves my machine unless I explicitly run `sdoc share`.",
      "Local viewing keeps document content in my browser. Content leaves that local path only when I explicitly run `sdoc share` or save a document to SmallDocs Cloud."
    )
    .replace(
      "`sdoc setup` writes one canonical copy to `~/.agents/skills/smalldocs/SKILL.md`. Agents using that universal location read it directly; other detected agents receive a symlink in their own skills directory (for example, `~/.claude/skills/smalldocs`).",
      "The cross-agent installer installs the standard skill with `npx skills@latest add https://smalldocs.org/agent-skills/standard --global`. If `npx skills` is unavailable, `sdoc setup` provides a built-in standard-edition fallback and removes configuration written by older SmallDocs releases."
    )
    .replace(
      "First, if `~/.agents/skills/smalldocs/SKILL.md` already exists, copy it aside and note its `v=N` version number (the `<!-- sdocs-skill: v=N -->` line). This snapshot is how you will spot exactly what a new release adds. On a fresh install there is no such file yet, which is fine.",
      "First, locate any existing global `smalldocs/SKILL.md`, copy it aside, and note its `v=N` version number (the `<!-- sdocs-skill: v=N -->` line). This snapshot is how you will spot exactly what a new release adds. On a fresh install there is no such file yet, which is fine."
    )
    .replace(
      "Then run: `sdoc setup --yes`",
      "Then run: `npx skills@latest add https://smalldocs.org/agent-skills/standard --global`"
    )
    .replace(
      "This installs (or refreshes) the SmallDocs skill at ~/.agents/skills/smalldocs/SKILL.md. Agents using that universal location read it directly; other detected agents receive a symlink. The skill is bumped to match the CLI version you just installed, so you pick up the newest capabilities. It is the canonical writer; do not hand-roll the skill yourself, the wording is kept in sync with the CLI version.",
      "This installs or refreshes the standard SmallDocs skill for every supported coding agent it detects. Use `sdoc setup --yes` only when `npx skills` is unavailable; that fallback installs the standard edition at `~/.agents/skills/smalldocs/SKILL.md` and links agent-specific skill directories to it. Do not hand-roll the skill. After a Cloud login, use the Cloud-aware replacement command printed by the CLI."
    )
    .replace(
      "If it does not open, check that `~/.agents/skills/smalldocs/SKILL.md` exists and, for an agent with its own skills directory, that a `smalldocs` symlink points to it. Tell me what is missing.",
      "If it does not open, inspect the install location reported by `npx skills`. If you used the built-in fallback, check that `~/.agents/skills/smalldocs/SKILL.md` exists and that any agent-specific `smalldocs` symlink points to it. Tell me what is missing."
    )
    .replace(
      "nothing leaves my machine unless I run `sdoc share`.",
      "local viewing keeps the document in my browser; `sdoc share` and explicit SmallDocs Cloud saves are the two upload paths."
    )
    .replace(
      "Compare the skill at ~/.agents/skills/smalldocs/SKILL.md now against the snapshot you took aside in step 4.",
      "Compare the installed global `smalldocs/SKILL.md` now against the snapshot you took aside in step 4."
    );

  // Windows has no POSIX shell to run the curl installer, so it uses npm.
  function isWindows(nav) {
    nav = nav || (typeof navigator !== "undefined" ? navigator : {});
    var plat = (nav.userAgentData && nav.userAgentData.platform) || nav.platform || "";
    return /win/i.test(plat) || /windows/i.test(nav.userAgent || "");
  }

  function installCommand(win, origin) {
    if (origin === 'https://cloud-staging.smalldocs.org') {
      return win ? 'npm i -g ' + origin + '/cli/sdocs-dev.tgz' : 'curl -fsSL ' + origin + '/install | sh';
    }
    return win
      ? "npm i -g sdocs-dev"
      : "curl -fsSL https://smalldocs.org/install | sh";
  }

  // The canonical update verb. If sdoc is not on PATH, re-running the installer
  // (reinstallCommand) upgrades in place.
  function upgradeCommand() {
    return "sdoc upgrade";
  }

  function reinstallCommand(win) {
    return win
      ? "npm i -g sdocs-dev@latest"
      : "curl -fsSL https://smalldocs.org/install | sh";
  }

  function cloudInstructions(options) {
    options = options || {};
    var origin = options.origin || 'https://smalldocs.org';
    var account = options.workspaceId || '';
    var libraryName = options.workspaceName || '';
    var install = installCommand(options.windows, origin);
    var environment = origin === 'https://smalldocs.org' ? '' : options.windows
      ? '$env:SDOCS_CLOUD_URL="' + origin + '"' : 'export SDOCS_CLOUD_URL=' + origin;
    var scope = account ? ' --account ' + account : '';
    var setup = 'npx --yes skills@latest add ' + origin + '/agent-skills/cloud --global --yes';
    var status = 'sdoc cloud status' + scope + ' --json';
    var commands = [install];
    if (!options.windows) commands.push('export PATH="$HOME/.sdocs/bin:$PATH"');
    if (environment) commands.push(environment);
    var referral = /^[A-Za-z0-9_-]{24}$/.test(options.referralCode || '') ? options.referralCode : '';
    var login = 'sdoc cloud login' + (referral ? ' --referral-code ' + referral : '');
    commands.push(setup, login);
    if (account) commands.push('sdoc cloud library-default ' + account + ' --json');
    commands.push(status);
    var destination = (libraryName ? 'My library is ' + JSON.stringify(libraryName) + '. ' : '') + (account
      ? 'Use library ID ' + account + ' as the default on this computer.'
      : 'Use my configured library, or my Personal library if this is a new account. Ask me if a library choice is needed.');
    var connect = 'Connect me to ' + origin + ' with `' + login + '`. Let me sign in with Google or an email code and approve the connection in my browser. Keep the login running while I do this.';
    var tour = 'Create one getting-started document from ' + origin + '/public/getting-started.md, following "First setup and tour" in the skill. Verify the spreadsheets and slides, look up and reuse relevant tags, save the document to my Cloud library with meaningful tags, and open it for me.';
    var readSkill = 'Read the installed SmallDocs Cloud skill at `~/.agents/skills/smalldocs/SKILL.md`.';
    return {
      install_command: install,
      skill_command: setup,
      commands: commands.join('\n'),
      connection_prompt: 'I have installed SmallDocs on this computer. ' + readSkill + (environment ? ' Use this Cloud server: `' + environment + '`.' : '') + '\n\nConnect me to ' + origin + '. Let me sign in and approve the connection in my browser when needed. ' + destination + '\n\nFollow "First setup and tour" in the skill to create and open one tagged document from ' + origin + '/public/getting-started.md.',
      prompt: 'Install SmallDocs Cloud for me and show me a tour.\n\n'
        + 'Install or update the CLI: `' + install + '`.'
        + (!options.windows ? ' Make it available in this terminal with `export PATH="$HOME/.sdocs/bin:$PATH"`.' : '') + '\n\n'
        + 'Install the Cloud skill globally: `' + setup + '`. ' + readSkill + '\n\n'
        + (environment ? 'Use this Cloud server: `' + environment + '`.\n\n' : '')
        + connect + '\n\n' + destination + '\n\n' + tour,
    };
  }

  var COPY_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var CHECK_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m20 6-11 11-5-5"/></svg>';

  function cloudInstallMarkup(options) {
    options = options || {};
    var instructions = cloudInstructions(options), accountPage = options.accountPage, onboarding = options.onboarding;
    function escape(value) { return String(value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
    function copyButton(field, label, primary) {
      return '<button class="sdoc-install-copy' + (primary ? ' sdoc-install-copy-primary primary-button' : '') + '" type="button" data-install-copy="' + field + '" aria-label="' + label + '" title="' + label + '">' + COPY_ICON + (primary ? '<span>Copy setup prompt</span>' : '') + '</button>';
    }
    function command(field, label, value) {
      return '<div class="sdoc-install-command"><code data-install-field="' + field + '" data-home-' + field + '>' + escape(value) + '</code>' + copyButton(field, label) + '</div>';
    }
    var prompt = '<div class="sdoc-install-content">'
      + (onboarding ? copyButton('prompt', 'Copy setup prompt', true) : '')
      + '<div class="sdoc-install-prompt">' + (onboarding ? '' : '<div class="sdoc-install-prompt-head"><span>Copy setup prompt</span>' + copyButton('prompt', 'Copy setup prompt') + '</div>')
      + '<pre data-install-field="prompt" data-home-prompt' + (accountPage ? ' id="install-prompt"' : '') + '>' + escape(instructions.prompt) + '</pre></div>'
      + (onboarding ? '' : '<p class="sdoc-install-note">Paste into your coding agent.</p>') + '</div>';
    var manual = '<details class="sdoc-install-method" data-install-method="manual"><summary>Install yourself</summary>'
      + '<div class="sdoc-install-content"' + (accountPage ? ' id="install-command"' : '') + '>'
      + command('cli', 'Copy CLI command', instructions.install_command)
      + command('skill', 'Copy skill command', instructions.skill_command)
      + '<div class="sdoc-install-prompt"><div class="sdoc-install-prompt-head"><span>Then paste this into your agent</span>' + copyButton('connect', 'Copy connection prompt') + '</div><pre data-install-field="connect">' + escape(instructions.connection_prompt) + '</pre></div>'
      + '</div></details>';
    return '<div class="sdoc-install' + (onboarding ? ' sdoc-install-onboarding' : '') + '"' + (accountPage ? '' : ' data-home-install') + '>'
      + (onboarding ? prompt : '<details class="sdoc-install-method" data-install-method="prompt" open><summary>Use install prompt</summary>' + prompt + '</details>')
      + manual
      + '<p class="sdoc-install-status" data-install-copy-status' + (accountPage ? ' id="install-copy-status"' : '') + ' role="status" aria-live="polite"></p></div>';
  }

  // One copy interaction for homepage and account installation. Only show success
  // after the clipboard write completes; keep the control outside scrolling text.
  function bindInstallCopy(root) {
    root.querySelectorAll('[data-install-copy]').forEach(function (button) {
      if (button.dataset.copyBound) return;
      button.dataset.copyBound = 'true';
      var original = button.innerHTML;
      button.addEventListener('click', async function () {
        if (button.dataset.copying) return;
        var field = button.dataset.installCopy;
        var source = root.querySelector('[data-install-field="' + field + '"]');
        var status = root.querySelector('[data-install-copy-status]');
        button.dataset.copying = 'true';
        try {
          await navigator.clipboard.writeText(source.textContent);
          button.innerHTML = CHECK_ICON + (button.classList.contains('sdoc-install-copy-primary') ? '<span>Copied</span>' : '');
          button.classList.add('done');
          button.setAttribute('aria-label', 'Copied');
          button.title = 'Copied';
          status.textContent = field === 'prompt' || field === 'connect' ? 'Prompt copied. Paste it into your coding agent.' : 'Command copied.';
          setTimeout(function () {
            button.innerHTML = original;
            button.classList.remove('done');
            button.setAttribute('aria-label', button.dataset.copyLabel);
            button.title = button.dataset.copyLabel;
          }, 1500);
        } catch (_) {
          status.textContent = 'Select the text and copy it.';
        } finally {
          delete button.dataset.copying;
        }
      });
      button.dataset.copyLabel = button.getAttribute('aria-label');
    });
  }

  exports.SETUP_PROMPT = SETUP_PROMPT;
  exports.isWindows = isWindows;
  exports.installCommand = installCommand;
  exports.upgradeCommand = upgradeCommand;
  exports.reinstallCommand = reinstallCommand;
  exports.cloudInstructions = cloudInstructions;
  exports.cloudInstallMarkup = cloudInstallMarkup;
  exports.bindInstallCopy = bindInstallCopy;
})(typeof module !== "undefined" && module.exports ? module.exports : (window.SDocCliSetup = {}));
