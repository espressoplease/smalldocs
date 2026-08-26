'use strict';

const fs = require('fs');
const path = require('path');
const { PNG } = require('playwright-core/lib/utilsBundle');

function parseArgs(argv, cwd) {
  const options = {
    suite: 'slides',
    baseline: 'origin/main',
    baselineUrl: null,
    output: null,
    headed: false,
    updateReport: false,
    cwd: cwd || process.cwd(),
  };
  const args = argv.slice();
  if (args[0] && !args[0].startsWith('-')) options.suite = args.shift();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--headed') options.headed = true;
    else if (arg === '--baseline') options.baseline = args[++index];
    else if (arg === '--baseline-url') options.baselineUrl = args[++index];
    else if (arg === '--output') options.output = path.resolve(options.cwd, args[++index]);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error('Unknown argument: ' + arg);
  }
  if (!options.baseline) throw new Error('--baseline needs a Git revision');
  if (options.baselineUrl && !/^https?:\/\//.test(options.baselineUrl)) {
    throw new Error('--baseline-url needs an HTTP or HTTPS origin');
  }
  return options;
}

function safeName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'capture';
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function compareValues(reference, candidate, location, differences) {
  if (reference === candidate) return;
  if (typeof reference !== typeof candidate || reference == null || candidate == null) {
    differences.push({ location, reference, candidate });
    return;
  }
  if (Array.isArray(reference) || Array.isArray(candidate)) {
    if (!Array.isArray(reference) || !Array.isArray(candidate)) {
      differences.push({ location, reference, candidate });
      return;
    }
    const count = Math.max(reference.length, candidate.length);
    for (let index = 0; index < count; index += 1) {
      compareValues(reference[index], candidate[index], location + '[' + index + ']', differences);
    }
    return;
  }
  if (typeof reference === 'object') {
    const keys = Array.from(new Set(Object.keys(reference).concat(Object.keys(candidate)))).sort();
    keys.forEach((key) => compareValues(reference[key], candidate[key], location + '.' + key, differences));
    return;
  }
  differences.push({ location, reference, candidate });
}

function compareCapture(reference, candidate) {
  const differences = [];
  ['semantic', 'controls', 'styles'].forEach((key) => {
    compareValues(reference && reference[key], candidate && candidate[key], key, differences);
  });
  return differences;
}

function diffPng(referencePath, candidatePath, outputPath, threshold) {
  const reference = PNG.sync.read(fs.readFileSync(referencePath));
  const candidate = PNG.sync.read(fs.readFileSync(candidatePath));
  const width = Math.max(reference.width, candidate.width);
  const height = Math.max(reference.height, candidate.height);
  const output = new PNG({ width, height });
  let changed = 0;
  const limit = threshold == null ? 16 : threshold;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const outIndex = (y * width + x) * 4;
      const inReference = x < reference.width && y < reference.height;
      const inCandidate = x < candidate.width && y < candidate.height;
      const referenceIndex = inReference ? (y * reference.width + x) * 4 : -1;
      const candidateIndex = inCandidate ? (y * candidate.width + x) * 4 : -1;
      let pixelChanged = !inReference || !inCandidate;
      if (!pixelChanged) {
        for (let channel = 0; channel < 4; channel += 1) {
          if (Math.abs(reference.data[referenceIndex + channel] - candidate.data[candidateIndex + channel]) > limit) {
            pixelChanged = true;
            break;
          }
        }
      }
      if (pixelChanged) changed += 1;
      if (pixelChanged) {
        output.data[outIndex] = 224;
        output.data[outIndex + 1] = 38;
        output.data[outIndex + 2] = 80;
        output.data[outIndex + 3] = 220;
      } else {
        const gray = Math.round((reference.data[referenceIndex] + reference.data[referenceIndex + 1] + reference.data[referenceIndex + 2]) / 3);
        output.data[outIndex] = gray;
        output.data[outIndex + 1] = gray;
        output.data[outIndex + 2] = gray;
        output.data[outIndex + 3] = 70;
      }
    }
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, PNG.sync.write(output));
  return {
    changed,
    pixels: width * height,
    ratio: width && height ? changed / (width * height) : 0,
    sameSize: reference.width === candidate.width && reference.height === candidate.height,
    referenceSize: { width: reference.width, height: reference.height },
    candidateSize: { width: candidate.width, height: candidate.height },
  };
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function reportHtml(report) {
  const sections = report.comparisons.map((comparison) => {
    const rows = comparison.states.map((state) => {
      const status = state.pass ? 'pass' : 'fail';
      const details = state.differences.slice(0, 40).map((difference) =>
        '<li><code>' + escapeHtml(difference.location) + '</code><br>reference: ' +
        escapeHtml(JSON.stringify(difference.reference)) + '<br>candidate: ' +
        escapeHtml(JSON.stringify(difference.candidate)) + '</li>').join('');
      return '<article class="state ' + status + '">' +
        '<h3>' + escapeHtml(state.label) + ' <span>' + status.toUpperCase() + '</span></h3>' +
        '<div class="images"><figure><figcaption>Reference</figcaption><img src="' + escapeHtml(state.referenceImage) + '"></figure>' +
        '<figure><figcaption>Candidate</figcaption><img src="' + escapeHtml(state.candidateImage) + '"></figure>' +
        '<figure><figcaption>Pixel diff (' + (state.image.ratio * 100).toFixed(2) + '%)</figcaption><img src="' + escapeHtml(state.diffImage) + '"></figure></div>' +
        '<details' + (state.pass ? '' : ' open') + '><summary>' + state.differences.length + ' structural/style differences, ' + state.contractFailures.length + ' contract failures</summary>' +
        (state.contractFailures.length ? '<h4>Contract</h4><ul>' + state.contractFailures.map((entry) => '<li>' + escapeHtml(entry) + '</li>').join('') + '</ul>' : '') +
        (details ? '<h4>DOM, controls, and styles</h4><ul>' + details + '</ul>' : '') + '</details></article>';
    }).join('');
    return '<section><h2>' + escapeHtml(comparison.label) + '</h2>' + rows + '</section>';
  }).join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>SmallDocs parity report</title><style>body{font:14px/1.5 system-ui;margin:0;background:#f6f5f2;color:#242321}main{max-width:1500px;margin:auto;padding:28px}h1{margin-bottom:4px}.summary{color:#625f59}.state{background:white;border:1px solid #d9d5cf;border-left:5px solid #16a34a;border-radius:10px;padding:18px;margin:18px 0}.state.fail{border-left-color:#dc2626}.state h3{display:flex;justify-content:space-between}.state h3 span{font-size:12px}.images{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.images img{display:block;width:100%;border:1px solid #ddd;background:#111}.images figure{margin:0}.images figcaption{font-weight:600;margin-bottom:5px}details{margin-top:15px}code{font-size:12px}li{margin:8px 0;overflow-wrap:anywhere}@media(max-width:850px){.images{grid-template-columns:1fr}}</style></head><body><main>' +
    '<h1>SmallDocs parity report</h1><p class="summary">Suite: ' + escapeHtml(report.suite) + ' | baseline: ' + escapeHtml(report.baseline) + ' | ' + escapeHtml(report.createdAt) + ' | ' + (report.pass ? 'PASS' : 'DRIFT FOUND') + '</p>' +
    sections + '</main></body></html>';
}

module.exports = {
  compareCapture,
  diffPng,
  escapeHtml,
  normalizeText,
  parseArgs,
  reportHtml,
  safeName,
};
