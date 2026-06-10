// cells-transclude.js - bake {{path/to/file.csv}} references into ```cells
// blocks at CLI time.
//
// The browser can never read a local file, so a CSV reference only means
// something while the CLI is involved. On open (and on share), every
// ```cells block whose body is a bare {{...}} reference is replaced with the
// file's full contents plus a metadata line the renderer reads:
//
//   ```cells                          ```cells
//   {{data/report.csv}}        ->     sdoc-cells: source=report.csv
//   ```                               Region,Q1,Q2
//                                     North,100,150
//                                     ...
//                                     ```
//
// The whole file is baked in (the user chose "whole CSV always travels"), so
// the resulting doc is self-contained and a share link never errors. Only the
// basename is recorded as `source=` - the full local path would leak the
// author's directory structure into a shared link. A read failure bakes an
// `error=` directive the renderer surfaces instead.

const fs = require('fs');
const path = require('path');

// A ```cells fenced block (captures leading boundary, optional fence name, and
// body). The name (```cells Sales) is preserved on the baked block so a tab
// loaded from a CSV keeps its identity. Tilde fences and inline-data blocks are
// left untouched.
const CELLS_BLOCK = /(^|\n)```cells[ \t]*([^\n]*)\n([\s\S]*?)\n```/g;
const REFERENCE = /^\{\{\s*([^}]+?)\s*\}\}$/;
// A trailing :range suffix like :B5:J32 or :B5 (a view hint; data is baked in
// whole regardless, so we just strip it off the path for now).
const RANGE_SUFFIX = /:([A-Za-z]+\d+(?::[A-Za-z]+\d+)?)$/;

function directiveValue(s) {
  return /\s|"/.test(s) ? JSON.stringify(s) : s;
}

function bakeBlock(boundary, name, ref, baseDir, readFile, preLines) {
  var range = '';
  var filePath = ref;
  var rm = ref.match(RANGE_SUFFIX);
  if (rm) { range = rm[1]; filePath = ref.slice(0, ref.length - rm[0].length); }

  var fence = '```cells' + (name ? ' ' + name : '');
  var base = path.basename(filePath);
  // Author format: lines (e.g. `format: B=$`) sit before the reference and are
  // preserved verbatim above the baked data.
  var head = (preLines && preLines.length ? preLines.join('\n') + '\n' : '');
  var csv;
  try {
    csv = readFile(path.resolve(baseDir, filePath));
  } catch (e) {
    return boundary + fence + '\n' + head + 'sdoc-cells: error=' +
      directiveValue('Could not read ' + base) + '\n```';
  }
  csv = String(csv).replace(/\s+$/, '');
  var directive = 'sdoc-cells: source=' + directiveValue(base) +
    (range ? ' range=' + range : '');
  return boundary + fence + '\n' + head + directive + '\n' + csv + '\n```';
}

// Replace every {{file.csv}} cells block in `content` with the baked data.
// `readFile` is injectable for tests; defaults to fs.readFileSync(utf-8).
function transcludeCells(content, baseDir, readFile) {
  if (typeof content !== 'string' || content.indexOf('```cells') === -1) return content;
  var read = readFile || function (p) { return fs.readFileSync(p, 'utf-8'); };
  return content.replace(CELLS_BLOCK, function (whole, boundary, name, body) {
    // Peel any leading author `format:` lines, then require a sole {{ref}}.
    var lines = body.split('\n');
    var pre = [];
    var i = 0;
    while (i < lines.length && /^\s*format:\s*/i.test(lines[i])) { pre.push(lines[i].trim()); i++; }
    var rest = lines.slice(i).join('\n').trim();
    var m = rest.match(REFERENCE);
    if (!m) return whole;                    // inline data - leave alone
    return bakeBlock(boundary, (name || '').trim(), m[1], baseDir, read, pre);
  });
}

// Wrap a standalone .csv file's contents in a ```cells block (so `sdoc x.csv`
// opens as a sheet, mirroring the .mmd -> mermaid wrapping).
function wrapCsvFile(csv, filename) {
  var base = path.basename(filename);
  return '```cells\nsdoc-cells: source=' + directiveValue(base) + '\n' +
    String(csv).replace(/\s+$/, '') + '\n```\n';
}

module.exports = {
  transcludeCells: transcludeCells,
  wrapCsvFile: wrapCsvFile,
};
