// Optional, opt-in autostart for the library agent.
//
// macOS: writes a LaunchAgent plist to ~/Library/LaunchAgents/ and
// loads it via launchctl. Linux/Windows: not yet implemented; the
// CLI prints "not supported on your platform" and exits.
//
// The plist points at the current Node binary plus the resolved CLI
// script path, so the OS can spawn the agent on login without relying
// on PATH or shell init.

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const LABEL = 'dev.sdocs.library';

function launchAgentsDir() {
  if (process.env.SDOCS_LAUNCHAGENTS_DIR) return process.env.SDOCS_LAUNCHAGENTS_DIR;
  return path.join(os.homedir(), 'Library', 'LaunchAgents');
}

function plistPath() {
  return path.join(launchAgentsDir(), LABEL + '.plist');
}

function logPath() {
  if (process.env.SDOCS_HOME) return path.join(process.env.SDOCS_HOME, 'library-autostart.log');
  return path.join(os.homedir(), '.sdocs', 'library-autostart.log');
}

function isSupported() {
  return process.platform === 'darwin';
}

function isEnabled() {
  if (!isSupported()) return false;
  return fs.existsSync(plistPath());
}

// Pure: builds the plist XML from the given paths. Exported for tests.
function buildPlist({ nodePath, scriptPath, logPath: lp }) {
  const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escape(nodePath)}</string>
    <string>${escape(scriptPath)}</string>
    <string>library</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${escape(lp)}</string>
  <key>StandardErrorPath</key>
  <string>${escape(lp)}</string>
</dict>
</plist>
`;
}

// Resolve the CLI script the OS should run. process.argv[1] is the JS
// entrypoint the user invoked. Falls back to a path relative to this
// module if argv[1] isn't usable (e.g. test runners).
function resolveScriptPath() {
  const candidate = process.argv[1];
  if (candidate && fs.existsSync(candidate)) return path.resolve(candidate);
  return path.resolve(__dirname, '..', 'bin', 'sdocs-dev.js');
}

function writePlist() {
  fs.mkdirSync(launchAgentsDir(), { recursive: true });
  const content = buildPlist({
    nodePath:   process.execPath,
    scriptPath: resolveScriptPath(),
    logPath:    logPath(),
  });
  fs.writeFileSync(plistPath(), content);
  return plistPath();
}

function removePlist() {
  try { fs.unlinkSync(plistPath()); } catch (_) {}
}

function launchctl(verb) {
  if (process.env.SDOCS_AUTOSTART_DRY_RUN === '1') return { ok: true, dryRun: true };
  try {
    execFileSync('launchctl', [verb, plistPath()], { stdio: 'pipe' });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e.stderr ? e.stderr.toString() : e.message).trim() };
  }
}

function enable() {
  if (!isSupported()) {
    return { ok: false, message: 'autostart is only supported on macOS for now.' };
  }
  const wrote = writePlist();
  // Unload any prior copy so reload picks up the fresh plist if node path changed.
  launchctl('unload');
  const r = launchctl('load');
  if (!r.ok) {
    return { ok: false, message: 'wrote plist but launchctl load failed: ' + r.message };
  }
  return { ok: true, path: wrote };
}

function disable() {
  if (!isSupported()) {
    return { ok: false, message: 'autostart is only supported on macOS for now.' };
  }
  if (!isEnabled()) return { ok: true, alreadyDisabled: true };
  launchctl('unload');
  removePlist();
  return { ok: true };
}

function status() {
  return {
    supported: isSupported(),
    enabled:   isEnabled(),
    plistPath: plistPath(),
  };
}

module.exports = {
  LABEL,
  isSupported, isEnabled,
  enable, disable, status,
  buildPlist, plistPath, logPath, resolveScriptPath,
};
