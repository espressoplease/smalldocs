// Default styles stored at ~/.sdocs/styles.yaml.
//
// Users tune a document in the browser, click "Save as Default", and
// the resulting YAML lands here. Every subsequent `sdoc <file>` merges
// these defaults under the file's own `styles:` block (file wins on
// conflict). `sdoc defaults` shows or removes the file.

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const SDocYaml = require('../shared/sdocs-yaml.js');

function getDefaultsPath() {
  return path.join(os.homedir(), '.sdocs', 'styles.yaml');
}

function loadDefaultStyles() {
  const configPath = getDefaultsPath();
  if (!fs.existsSync(configPath)) return null;
  try {
    const yaml = fs.readFileSync(configPath, 'utf-8');
    return SDocYaml.parseSimpleYaml(yaml);
  } catch {
    return null;
  }
}

function showDefaults() {
  const configPath = getDefaultsPath();
  if (!fs.existsSync(configPath)) {
    console.log('No default styles set (~/.sdocs/styles.yaml not found).');
    console.log('\nTo set defaults, style a document in SDocs and use');
    console.log('the "Save as Default" panel to generate the command.');
    return;
  }
  console.log(fs.readFileSync(configPath, 'utf-8'));
}

function resetDefaults() {
  const configPath = getDefaultsPath();
  if (!fs.existsSync(configPath)) {
    console.log('No default styles to remove.');
    return;
  }
  fs.unlinkSync(configPath);
  console.log('Removed ' + configPath);
}

// Deep merge: defaults under file styles (file wins on conflict).
// Recurses one level deeper for light:/dark: sub-objects that contain
// nested objects (e.g. h1: { color: ... }).
function mergeStyles(defaults, fileStyles) {
  if (!defaults) return fileStyles || {};
  if (!fileStyles) return { ...defaults };
  const merged = { ...defaults };
  for (const [k, v] of Object.entries(fileStyles)) {
    if (typeof v === 'object' && v !== null && typeof merged[k] === 'object' && merged[k] !== null) {
      const inner = { ...merged[k] };
      for (const [ik, iv] of Object.entries(v)) {
        if (typeof iv === 'object' && iv !== null && typeof inner[ik] === 'object' && inner[ik] !== null) {
          inner[ik] = { ...inner[ik], ...iv };
        } else {
          inner[ik] = iv;
        }
      }
      merged[k] = inner;
    } else {
      merged[k] = v;
    }
  }
  return merged;
}

function applyDefaultStyles(content) {
  const defaults = loadDefaultStyles();
  if (!defaults) return content;

  const { meta, body } = SDocYaml.parseFrontMatter(content);
  const mergedStyles = mergeStyles(defaults, meta.styles);
  const newMeta = { ...meta, styles: mergedStyles };
  return SDocYaml.serializeFrontMatter(newMeta) + '\n' + body;
}

module.exports = {
  getDefaultsPath,
  loadDefaultStyles,
  showDefaults,
  resetDefaults,
  mergeStyles,
  applyDefaultStyles,
};
