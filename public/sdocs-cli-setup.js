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
  var SETUP_PROMPT = "Please install or update SmallDocs for me, and make sure you (my coding agent) know about its latest features.\n\nSmallDocs is a CLI (`sdoc`) that renders local markdown files as styled, readable documents in the browser. It also supports charts, diagrams, slide decks, and interactive forms inside markdown. Nothing leaves my machine unless I explicitly run `sdoc share`.\n\nOnce it is installed and you know about it, I want to be able to say things like:\n\n- \"sdoc me a bug report on X\"\n- \"sdoc me this service's architecture\"\n- \"sdoc me an analysis of last month's results\"\n\nand you will write the markdown and open it for me as a SmallDoc.\n\nThe way you will \"know about it\" is by having a short SmallDocs section in your global agent config file: the file that is loaded into every chat session you start. For Claude Code that is `~/.claude/CLAUDE.md`. For Codex it is `~/.codex/AGENTS.md`. For Gemini CLI it is `~/.gemini/GEMINI.md`. For opencode it is `~/.config/opencode/AGENTS.md`. This is the same standing-instructions mechanism you already use for project context.\n\nPlease do the following, and ask me before any step that changes my filesystem.\n\n1. Check whether `sdoc` is already installed.\n   Run `which sdoc` (or `where sdoc` on Windows).\n\n2. If it is NOT installed, install it, choosing the command that matches my operating system:\n   - macOS or Linux: `curl -fsSL https://smalldocs.org/install | sh`\n     This puts everything under `~/.sdocs/` (no root needed) and adds `~/.sdocs/bin` to my PATH via my shell's rc file.\n   - Windows: `npm i -g sdocs-dev` (needs Node and npm installed).\n   If it IS already installed, update it to the latest version: run `sdoc upgrade`. If that command is not found, re-run the installer instead (`curl -fsSL https://smalldocs.org/install | sh` on macOS or Linux, `npm i -g sdocs-dev@latest` on Windows).\n\n3. Make sure `sdoc` is on PATH.\n   Run `which sdoc` again (`where sdoc` on Windows). If it is still not found on macOS or Linux:\n   - Run `echo $SHELL` to see which shell I am using.\n   - For zsh, append `export PATH=\"$HOME/.sdocs/bin:$PATH\"` to `~/.zshrc`.\n   - For bash, the same line to `~/.bashrc`.\n   - For fish, run `fish_add_path $HOME/.sdocs/bin` or add it to `~/.config/fish/config.fish`.\n   - Then tell me to open a new terminal, or to run `source ~/.zshrc` (or the matching rc file) in mine.\n\n4. Teach yourself the latest features.\n   First, if my config file already has a SmallDocs section (the block between `<!-- sdocs-agent-block:start v=N -->` and `<!-- sdocs-agent-block:end -->`), copy that whole block aside and note its `v=N` version number. This snapshot is how you will spot exactly what a new release adds. On a fresh install there is no such block yet, which is fine.\n   Then run: `sdoc setup --yes`\n   This non-interactively writes or refreshes that SmallDocs section in every detected coding-agent config file, bumping it to match the CLI version you just installed, so you pick up the newest capabilities. It is the canonical writer; do not hand-roll the section yourself, the wording is kept in sync with the CLI version.\n\n5. Verify it worked.\n   Ask me to start a fresh chat session with you (so the updated config file is loaded). In the new session, ask me to say: \"sdoc me a test file\". A styled document should open in my browser.\n   If it does not open, check that my global config file contains a line beginning with `<!-- sdocs-agent-block:start` and tell me what is missing.\n\n6. Offer me a tour. Ask first, and only show the parts I say yes to - do not run the whole thing unprompted. The point of the tour is for me to learn what I can ask you to generate, so build each example from my own work where you can, and for every output tell me the plain phrase I could say to get it next time. (If you are not sure whether this is a first install or just an update, ask me which.)\n\n   For a first install, offer to walk me through it:\n     a. Privacy: write a short SmallDoc - a few real lines, for instance about this project - and open it (`sdoc path/to/file.md`), then explain in a line or two that the whole document travels in the URL fragment (the part after `#`), which browsers never send to a server, so nothing leaves my machine unless I run `sdoc share`.\n     b. Code: open one of my real source files as a SmallDoc (`sdoc path/to/file`) so I can see the syntax highlighting and the comment lane. Pick an obvious one, or ask me which.\n     c. Rich outputs: build one SmallDoc, drawn from my real work where possible, that shows the block types SmallDocs can render, and for each one tell me the phrase I could say next time:\n        - a diagram, e.g. of this project's structure (\"sdoc me a diagram of this flow\")\n        - a slide deck (\"make me a slide deck and sdoc it\")\n        - a branded slide deck in my own colours - run `sdoc slides` first for the shape and styling syntax, and ask me for a brand colour (or use the document's accent colour)\n        - a chart of some real numbers (\"sdoc me a chart of these numbers\")\n        - a live spreadsheet (\"sdoc me a budget with live totals\"); run `sdoc cells verify path/to/file.md` to confirm the totals compute before you open it\n     Run the matching reference commands (`sdoc diagrams`, `sdoc slides`, `sdoc charts`, `sdoc cells`, `sdoc code`) to get each block's syntax right before you write it.\n\n   For an update, do not re-tour everything. Compare the SmallDocs block in my config now against the snapshot you took aside in step 4. Tour only what actually changed: the bullets that were added or reworded, which the higher `v=N` in the start marker confirms. Walk me through each genuinely new capability the way the first-install tour does - build it from my real work and give me the plain phrase I would say to get it again. If the block is unchanged from before (same `v=N`, same text), this was a maintenance release with no new authoring features: tell me that plainly and skip the tour rather than repeating things I already have.\n\nIf any step fails, stop and tell me what happened before doing more.";

  // Windows has no POSIX shell to run the curl installer, so it uses npm.
  function isWindows(nav) {
    nav = nav || (typeof navigator !== "undefined" ? navigator : {});
    var plat = (nav.userAgentData && nav.userAgentData.platform) || nav.platform || "";
    return /win/i.test(plat) || /windows/i.test(nav.userAgent || "");
  }

  function installCommand(win) {
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

  exports.SETUP_PROMPT = SETUP_PROMPT;
  exports.isWindows = isWindows;
  exports.installCommand = installCommand;
  exports.upgradeCommand = upgradeCommand;
  exports.reinstallCommand = reinstallCommand;
})(typeof module !== "undefined" && module.exports ? module.exports : (window.SDocCliSetup = {}));
