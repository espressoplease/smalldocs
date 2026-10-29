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
    var setup = 'sdoc setup --cloud' + scope + ' --yes';
    var status = 'sdoc cloud status' + scope + ' --json';
    var commands = [install];
    if (!options.windows) commands.push('export PATH="$HOME/.sdocs/bin:$PATH"');
    if (environment) commands.push(environment);
    commands.push('sdoc cloud login', setup);
    if (account) commands.push('sdoc cloud library-default ' + account + ' --json');
    commands.push(status);
    var steps = [
      'Install or update the SmallDocs CLI:\n   `' + install + '`',
    ];
    if (!options.windows) steps.push('Make sdoc available in this terminal:\n   `export PATH="$HOME/.sdocs/bin:$PATH"`');
    if (environment) steps.push('Before running any sdoc command, set the Cloud server:\n   `' + environment + '`');
    steps.push('Run `sdoc cloud login`. Let me approve this computer in my browser.',
      'Install the SmallDocs skill' + (account ? ' and select this library for new documents' : '') + ':\n   `' + setup + '`',
      'Read the installed `~/.agents/skills/smalldocs/SKILL.md` now so you can use it in this chat.');
    if (account) steps.push('Save this library as the default for this computer:\n   `sdoc cloud library-default ' + account + ' --json`');
    steps.push('Confirm the selected library and that `can_create_document` is true:\n   `' + status + '`',
      'Create one short getting-started document in my Cloud library. Read `sdoc cloud tags --help`, then check existing tags and reuse relevant ones. Give the document meaningful tags, such as `getting-started` and `smalldocs` if they fit. Save it with the CLI and verify `ok`, the saved tags and the returned Cloud URL. Open that URL for me.');
    return {
      commands: commands.join('\n'),
      prompt: 'Set up SmallDocs Cloud for me and show me how to use it with one document.' +
        (libraryName ? '\n\nMy library is ' + JSON.stringify(libraryName) + '.' : '') + '\n\n' +
        steps.map(function (step, index) { return (index + 1) + '. ' + step; }).join('\n') +
        '\n\nPut this short guide in the document:\n' +
        '- My library holds Cloud documents I can open from other computers. Tags are labels, such as `launch` or `research`, that help us find related documents again.\n' +
        '- I can ask for a document without naming a tool: "Write a document about our launch plan." I can also say "Make a SmallDoc" or "Use SmallDocs". Use SmallDocs by default unless I request another format or tool.\n' +
        '- I can ask you to find documents by tags, author or words, read comments and update the same document. Edits keep its Cloud URL, and the open browser page picks up saved changes.\n' +
        '- I can ask you to manage my library and account through chat. You can invite or remove members when my role allows it, check my trial and billing, and open account settings. "Subscribe to SmallDocs" opens the subscription page, where I complete payment. "Cancel my subscription" opens billing settings, where I complete cancellation. Inviting someone does not share existing private documents.\n' +
        'Use CLI help and the installed skill for these workflows. For this tour, demonstrate document creation only. In chat, confirm setup worked, link to the document and give three example requests I can try next. Keep command names, account IDs and setup details out of the tour.\n\n' +
        'For future documents and artifacts, use SmallDocs by default unless I request another format or tool. Save every new document with meaningful tags. Example: `sdoc report.md --cloud' + scope + ' --json +subject +project`. Replace the example tags with tags relevant to the document. Verify the save and tags, then link to the returned Cloud URL. When updating a document, save it back to its current library.',
    };
  }

  exports.SETUP_PROMPT = SETUP_PROMPT;
  exports.isWindows = isWindows;
  exports.installCommand = installCommand;
  exports.upgradeCommand = upgradeCommand;
  exports.reinstallCommand = reinstallCommand;
  exports.cloudInstructions = cloudInstructions;
})(typeof module !== "undefined" && module.exports ? module.exports : (window.SDocCliSetup = {}));
