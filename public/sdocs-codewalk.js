// sdocs-codewalk.js — pure model for a multi-file code walkthrough (UMD).
//
// A code walkthrough is several source files shown as tabs, plus an ordered
// list of annotations that step across those tabs ("start in file1, jump to
// file2, back to file1"). The CLI writes the data into front matter:
//
//   codewalk: true
//   files: [app.py, util.py]            # tab order (unique, first-seen)
//   annotations:                        # walkthrough order (the array order)
//     - file: app.py
//       line: 4
//       endLine: 4
//       text: "we start here"
//     - file: util.py
//       line: 13
//       text: "then X"
//
// This module turns that parsed front matter into a render-ready model. It is
// pure (no DOM): the browser UI and the Node tests both consume it, mirroring
// the sdocs-comments.js (model) / sdocs-comments-ui.js (view) split.
(function (exports) {
'use strict';

// Caps mirror the viewer's annotation guard (ANN_MAX) and a sane tab limit, so
// an adversarial / runaway document can't spawn unbounded DOM downstream.
var MAX_STEPS = 300;
var MAX_FILES = 50;

function str(v) { return typeof v === 'string' ? v : ''; }

// Tab list: strings, trimmed, de-duplicated, first-seen order.
function normalizeFiles(raw) {
  var out = [];
  var seen = Object.create(null);
  if (!Array.isArray(raw)) return out;
  for (var i = 0; i < raw.length && out.length < MAX_FILES; i++) {
    var f = str(raw[i]).trim();
    if (!f || seen[f]) continue;
    seen[f] = true;
    out.push(f);
  }
  return out;
}

// Build the walkthrough model from parsed front matter (`meta`).
// Returns:
//   files  - tab labels in display order
//   steps  - [{ file, line, endLine, text, index }] in walkthrough order
//   byFile - { file: [step, ...] } so each tab can render its own cards
//   total  - steps.length
//
// Validation mirrors the viewer's getAnnotations: 1-based line required,
// endLine coerced to >= line, empty text dropped, count capped. An annotation
// with no `file` binds to the first tab; one naming an undeclared tab is
// dropped (unless tabs were derived, below).
function build(meta) {
  meta = meta || {};
  var declared = normalizeFiles(meta.files);
  var derived = declared.length === 0; // hand-written doc: infer tabs from steps
  var files = derived ? [] : declared;
  var seen = Object.create(null);
  files.forEach(function (f) { seen[f] = true; });

  var raw = Array.isArray(meta.annotations) ? meta.annotations : [];
  var steps = [];
  var byFile = Object.create(null);

  for (var i = 0; i < raw.length && steps.length < MAX_STEPS; i++) {
    var a = raw[i];
    if (!a) continue;
    var line = parseInt(a.line, 10);
    if (!(line >= 1)) continue;
    var end = parseInt(a.endLine, 10);
    if (!(end >= line)) end = line;
    var text = str(a.text);
    if (!text.trim()) continue;

    var file = str(a.file).trim();
    if (!file) file = files[0] || '';
    if (derived) {
      if (file && !seen[file]) { seen[file] = true; files.push(file); }
    } else if (files.indexOf(file) === -1) {
      continue; // step points at a tab that doesn't exist
    }

    var step = { file: file, line: line, endLine: end, text: text, index: steps.length };
    steps.push(step);
    (byFile[file] || (byFile[file] = [])).push(step);
  }

  return { files: files, steps: steps, byFile: byFile, total: steps.length };
}

// Clamp a step index into range (a guided tour clamps at the ends — it does
// not wrap from last back to first the way the prose comment cursor does).
function clamp(index, total) {
  if (total <= 0) return -1;
  if (index < 0) return 0;
  if (index > total - 1) return total - 1;
  return index;
}

// Truthy test for the front-matter opt-in. The hand-rolled YAML parser turns
// `codewalk: true` into the string "true" (Number("true") is NaN), so accept
// the common truthy spellings, matching the cells `isTabbedDoc` gate.
function isCodewalk(meta) {
  var v = meta && meta.codewalk;
  if (v === true) return true;
  v = str(v).toLowerCase().trim();
  return v === 'true' || v === 'yes' || v === 'on' || v === '1';
}

exports.build = build;
exports.normalizeFiles = normalizeFiles;
exports.clamp = clamp;
exports.isCodewalk = isCodewalk;
exports.MAX_STEPS = MAX_STEPS;
exports.MAX_FILES = MAX_FILES;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocCodewalk = {}));
