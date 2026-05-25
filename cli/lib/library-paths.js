// Canonical paths the library subsystem uses. One module so tests can
// rebind for sandboxing (set SDOCS_HOME to redirect everything into a
// temp directory).

const path = require('path');
const os   = require('os');

function root() {
  if (process.env.SDOCS_HOME) return process.env.SDOCS_HOME;
  return path.join(os.homedir(), '.sdocs');
}

module.exports = {
  root,
  libraryDir:    () => path.join(root(), 'library'),
  rescuedDir:    () => path.join(root(), 'library', 'rescued'),
  indexFile:     () => path.join(root(), 'library-index.json'),
  stateFile:     () => path.join(root(), 'library-state.json'),
  configFile:    () => path.join(root(), 'library.yaml'),
};
