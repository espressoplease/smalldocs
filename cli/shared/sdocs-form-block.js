// sdocs-form-block.js — parse / serialise / hash a fenced ```form block.
//
// Shared by browser (renderer) and Node (bridge + tests). UMD pattern,
// same as the other cli/shared modules.
//
// A form block carries four top-level sections:
//
//   - id          (string, required, [a-z0-9_-]{1,64})
//   - fields[]    (array, agent-owned schema, immutable after author)
//   - buttons[]   (array, agent-owned action surface)
//   - answers     (map, bridge-owned current values)
//   - submissions (array, append-only history)
//
// We only support a strict subset of YAML — enough for the DSL, no more.
// Anything off-spec is a parse error so the agent gets immediate
// feedback rather than a silently-mangled document.

(function (exports) {
'use strict';

// ─── Constants ────────────────────────────────────────────────

var MAX_BLOCK_BYTES   = 64 * 1024;          // hard cap per form block
var NAME_RE           = /^[a-z0-9_-]{1,64}$/;
var ALLOWED_TYPES     = { text: 1, textarea: 1, radio: 1,
                          checkbox: 1, select: 1, number: 1, date: 1 };
var FIELD_KEYS        = ['name','type','label','help','required',
                         'default','placeholder','options','rows',
                         'maxlength','min','max','step'];
var BUTTON_KEYS       = ['name','label','scope','final','after'];

// ─── Scalar parsing (string in, JS in) ────────────────────────

function parseScalar(v) {
  if (v == null) return v;
  v = String(v);
  var t = v.trim();
  if (t === '') return '';
  // Quoted
  if (t.charAt(0) === '"' && t.charAt(t.length-1) === '"') {
    return JSON.parse(t);
  }
  if (t.charAt(0) === "'" && t.charAt(t.length-1) === "'") {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  // Booleans
  if (t === 'true')  return true;
  if (t === 'false') return false;
  if (t === 'null')  return null;
  // Number — only if the whole string parses
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t);
  // Plain scalar
  return t;
}

// ─── Tokeniser: convert text → flat list of (indent, content) ──

function tokenise(text) {
  // Normalise line endings, strip trailing whitespace per line.
  var raw = String(text).replace(/\r\n/g, '\n').split('\n');
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var line = raw[i].replace(/\s+$/, '');
    var indent = 0;
    while (indent < line.length && line.charAt(indent) === ' ') indent++;
    out.push({ indent: indent, text: line.slice(indent), raw: line, lineNo: i + 1 });
  }
  return out;
}

// ─── Block-scalar (`|` style) capture ─────────────────────────
//
// `key: |` followed by indented lines collects those lines verbatim.
// Common indent is stripped. Trailing newline kept (chomp +).

function captureBlockScalar(tokens, startIdx, baseIndent) {
  // We treat the next non-empty indented line as defining the block
  // indent. All subsequent lines with at least that indent are part
  // of the scalar. The first less-indented (or fence) line ends it.
  var i = startIdx;
  // Skip leading empty lines (still inside the scalar).
  while (i < tokens.length && tokens[i].text === '' && tokens[i].indent === 0) i++;
  if (i >= tokens.length) return { value: '', nextIdx: i };
  var blockIndent = tokens[i].indent;
  if (blockIndent <= baseIndent) return { value: '', nextIdx: startIdx };
  var lines = [];
  while (i < tokens.length) {
    var t = tokens[i];
    if (t.text === '' && t.indent === 0) { lines.push(''); i++; continue; }
    if (t.indent < blockIndent) break;
    lines.push(' '.repeat(t.indent - blockIndent) + t.text);
    i++;
  }
  // Trim trailing empty lines but keep one.
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return { value: lines.join('\n') + '\n', nextIdx: i };
}

// ─── Mapping parser ───────────────────────────────────────────
//
// Recursive on indent. Returns { obj, nextIdx, error? } at the first
// fence line or first line less-indented than `baseIndent`.

function parseMapping(tokens, startIdx, baseIndent) {
  var obj = {};
  var i = startIdx;
  var keyOrder = [];
  while (i < tokens.length) {
    var t = tokens[i];
    if (t.text === '') { i++; continue; }
    if (t.indent < baseIndent) break;
    if (t.indent > baseIndent) {
      return { error: 'unexpected indent on line ' + t.lineNo };
    }
    var m = t.text.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) return { error: 'expected `key:` on line ' + t.lineNo + ' got: ' + t.text };
    var key = m[1];
    var rest = m[2];
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return { error: 'reserved key on line ' + t.lineNo };
    }
    keyOrder.push(key);
    // Inline value
    if (rest !== '') {
      if (rest === '|') {
        var bs = captureBlockScalar(tokens, i + 1, baseIndent);
        obj[key] = bs.value;
        i = bs.nextIdx;
        continue;
      }
      // Inline array  [a, b, c]
      if (rest.charAt(0) === '[' && rest.charAt(rest.length - 1) === ']') {
        var inner = rest.slice(1, -1);
        if (inner.trim() === '') {
          obj[key] = [];
        } else {
          // Split on commas, but respect quoted segments.
          var items = splitInlineList(inner);
          obj[key] = items.map(parseScalar);
        }
        i++;
        continue;
      }
      // Inline scalar
      obj[key] = parseScalar(rest);
      i++;
      continue;
    }
    // Block value follows
    // Look ahead: next non-empty line at deeper indent starting `- ` → array.
    // Or block mapping at deeper indent.
    var lookI = i + 1;
    while (lookI < tokens.length && tokens[lookI].text === '') lookI++;
    if (lookI >= tokens.length || tokens[lookI].indent <= baseIndent) {
      obj[key] = null;
      i = lookI;
      continue;
    }
    var deeper = tokens[lookI].indent;
    if (tokens[lookI].text.charAt(0) === '-' && (tokens[lookI].text.charAt(1) === ' ' || tokens[lookI].text.length === 1)) {
      // Array
      var ar = parseArray(tokens, lookI, deeper);
      if (ar.error) return { error: ar.error };
      obj[key] = ar.arr;
      i = ar.nextIdx;
      continue;
    }
    // Nested map
    var sub = parseMapping(tokens, lookI, deeper);
    if (sub.error) return { error: sub.error };
    obj[key] = sub.obj;
    i = sub.nextIdx;
  }
  return { obj: obj, nextIdx: i };
}

function splitInlineList(s) {
  var out = [];
  var depth = 0;
  var inQuote = null;
  var buf = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (inQuote) {
      buf += c;
      if (c === inQuote && s.charAt(i - 1) !== '\\') inQuote = null;
      continue;
    }
    if (c === '"' || c === "'") { inQuote = c; buf += c; continue; }
    if (c === '[' || c === '{') { depth++; buf += c; continue; }
    if (c === ']' || c === '}') { depth--; buf += c; continue; }
    if (c === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim() !== '') out.push(buf);
  return out.map(function (x) { return x.trim(); });
}

function parseArray(tokens, startIdx, baseIndent) {
  var out = [];
  var i = startIdx;
  while (i < tokens.length) {
    var t = tokens[i];
    if (t.text === '') { i++; continue; }
    if (t.indent < baseIndent) break;
    if (t.indent > baseIndent || t.text.charAt(0) !== '-') {
      return { error: 'malformed array item on line ' + t.lineNo };
    }
    var rest = t.text.slice(1).replace(/^\s+/, '');
    // Item is either a scalar (`- foo`) or a map whose first key is on the same line.
    if (rest === '') {
      // map body follows on next deeper-indented lines
      i++;
      var sub = parseMapping(tokens, i, baseIndent + 2);
      if (sub.error) return { error: sub.error };
      out.push(sub.obj);
      i = sub.nextIdx;
      continue;
    }
    // Same-line key:value start
    var km = rest.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (km) {
      // Build a map for this item: first key inline, additional keys on
      // subsequent lines indented baseIndent + 2.
      var obj = {};
      var key = km[1];
      var val = km[2];
      var inlineToken = { indent: baseIndent + 2, text: key + ': ' + val, lineNo: t.lineNo };
      var synthetic = [inlineToken];
      // Capture continuation lines (mapping body at baseIndent + 2).
      var j = i + 1;
      while (j < tokens.length) {
        if (tokens[j].text === '') { synthetic.push(tokens[j]); j++; continue; }
        if (tokens[j].indent < baseIndent + 2) break;
        synthetic.push(tokens[j]);
        j++;
      }
      var sub2 = parseMapping(synthetic, 0, baseIndent + 2);
      if (sub2.error) return { error: sub2.error };
      out.push(sub2.obj);
      i = j;
      continue;
    }
    // Scalar item
    out.push(parseScalar(rest));
    i++;
  }
  return { arr: out, nextIdx: i };
}

// ─── Public parse ─────────────────────────────────────────────

function parseFormBlock(text) {
  if (typeof text !== 'string') {
    return { error: 'form block must be a string' };
  }
  if (text.length > MAX_BLOCK_BYTES) {
    return { error: 'form block exceeds ' + MAX_BLOCK_BYTES + ' bytes' };
  }
  var tokens = tokenise(text);
  var top = parseMapping(tokens, 0, 0);
  if (top.error) return { error: top.error };

  var raw = top.obj || {};
  var out = {
    id: raw.id,
    fields: Array.isArray(raw.fields) ? raw.fields : [],
    buttons: Array.isArray(raw.buttons) ? raw.buttons : [],
    answers: (raw.answers && typeof raw.answers === 'object' && !Array.isArray(raw.answers)) ? raw.answers : {},
    submissions: Array.isArray(raw.submissions) ? raw.submissions : [],
  };

  var v = validate(out);
  if (v.error) return { error: v.error };
  return { value: out };
}

function validate(block) {
  if (!block.id || typeof block.id !== 'string' || !NAME_RE.test(block.id)) {
    return { error: 'form id must match [a-z0-9_-]{1,64}' };
  }
  if (!block.fields.length) return { error: 'form must have at least one field' };
  var seen = {};
  for (var i = 0; i < block.fields.length; i++) {
    var f = block.fields[i];
    if (!f || typeof f !== 'object') return { error: 'field ' + i + ' is not an object' };
    if (!f.name || !NAME_RE.test(f.name)) return { error: 'field ' + i + ' name must match [a-z0-9_-]{1,64}' };
    if (seen[f.name]) return { error: 'duplicate field name: ' + f.name };
    seen[f.name] = true;
    if (!ALLOWED_TYPES[f.type]) return { error: 'field "' + f.name + '" has unknown type: ' + f.type };
    if ((f.type === 'radio' || f.type === 'checkbox' || f.type === 'select') &&
        (!Array.isArray(f.options) || f.options.length === 0)) {
      return { error: f.type + ' field "' + f.name + '" requires options[]' };
    }
    if (f.type === 'checkbox' && f.default !== undefined && f.default !== null &&
        !Array.isArray(f.default)) {
      return { error: 'checkbox field "' + f.name + '" default must be an array of option strings' };
    }
    if (f.type === 'number' && f.default !== undefined && f.default !== null &&
        typeof f.default !== 'number') {
      return { error: 'number field "' + f.name + '" default must be a number' };
    }
  }
  // Buttons: at least one required, names unique.
  if (!block.buttons.length) return { error: 'form must have at least one button' };
  var bseen = {};
  for (var j = 0; j < block.buttons.length; j++) {
    var b = block.buttons[j];
    if (!b || typeof b !== 'object') return { error: 'button ' + j + ' is not an object' };
    if (!b.name || !NAME_RE.test(b.name)) return { error: 'button ' + j + ' name invalid' };
    if (bseen[b.name]) return { error: 'duplicate button name: ' + b.name };
    bseen[b.name] = true;
    if (!b.label || typeof b.label !== 'string') return { error: 'button "' + b.name + '" missing label' };
    if (b.scope !== undefined && !Array.isArray(b.scope)) {
      return { error: 'button "' + b.name + '" scope must be an array' };
    }
    if (Array.isArray(b.scope)) {
      for (var k = 0; k < b.scope.length; k++) {
        if (!seen[b.scope[k]]) return { error: 'button "' + b.name + '" scope refers to unknown field: ' + b.scope[k] };
      }
    }
    if (b.after !== undefined && b.after !== null) {
      if (typeof b.after !== 'string' || !seen[b.after]) {
        return { error: 'button "' + b.name + '" after refers to unknown field: ' + b.after };
      }
    }
  }
  return { ok: true };
}

// ─── Serialise ────────────────────────────────────────────────
//
// Deterministic output. Strings that contain newlines or fence markers
// are emitted as block scalars. Strings that contain a triple-backtick
// are forbidden in user input — we reject at submit time.

function serializeFormBlock(block) {
  var lines = [];
  lines.push('id: ' + scalarOut(block.id));
  if (block.fields && block.fields.length) {
    lines.push('fields:');
    block.fields.forEach(function (f) { emitObjectItem(lines, f, FIELD_KEYS, 2); });
  }
  if (block.buttons && block.buttons.length) {
    lines.push('buttons:');
    block.buttons.forEach(function (b) { emitObjectItem(lines, b, BUTTON_KEYS, 2); });
  }
  if (block.answers && Object.keys(block.answers).length) {
    lines.push('answers:');
    var akeys = Object.keys(block.answers);
    akeys.forEach(function (k) {
      emitKeyValue(lines, k, block.answers[k], 2);
    });
  }
  if (block.submissions && block.submissions.length) {
    lines.push('submissions:');
    block.submissions.forEach(function (s) {
      var keys = ['by', 'at', 'scope', 'values'];
      emitObjectItem(lines, s, keys, 2);
    });
  }
  return lines.join('\n');
}

// indent = column where each item's `-` will be written.
// Keys after `- ` therefore start at column indent + 2.
function emitObjectItem(lines, obj, keyOrder, indent) {
  var pad = ' '.repeat(indent);
  var firstWritten = false;
  keyOrder.forEach(function (k) {
    if (!(k in obj)) return;
    var val = obj[k];
    var prefix = firstWritten ? pad + '  ' : pad + '- ';
    firstWritten = true;
    emitKeyValue(lines, k, val, indent + 2, prefix);
  });
  // Trailing unknown keys are dropped on purpose (schema strip).
}

// indent = column where the key starts when no prefix is given.
// prefix (optional) overrides the leading whitespace with something
// like "  - " (array-item marker). Block-scalar continuation lines
// land at column indent + 2.
function emitKeyValue(lines, key, val, indent, prefix) {
  var pad = prefix !== undefined ? prefix : ' '.repeat(indent);
  if (val == null) {
    lines.push(pad + key + ': null');
    return;
  }
  if (typeof val === 'string') {
    if (val.indexOf('\n') >= 0) {
      lines.push(pad + key + ': |');
      var ipad = ' '.repeat(indent + 2);
      var parts = val.split('\n');
      if (parts[parts.length - 1] === '') parts.pop();
      parts.forEach(function (p) { lines.push(ipad + p); });
      return;
    }
    lines.push(pad + key + ': ' + scalarOut(val));
    return;
  }
  if (typeof val === 'boolean' || typeof val === 'number') {
    lines.push(pad + key + ': ' + String(val));
    return;
  }
  if (Array.isArray(val)) {
    var allSimple = val.every(function (v) {
      return (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') &&
             (typeof v !== 'string' || (v.indexOf(',') < 0 && v.indexOf('\n') < 0));
    });
    if (allSimple && val.length <= 8) {
      lines.push(pad + key + ': [' + val.map(scalarOut).join(', ') + ']');
      return;
    }
    lines.push(pad + key + ':');
    var apad = ' '.repeat(indent + 2);
    val.forEach(function (item) {
      if (item != null && typeof item === 'object' && !Array.isArray(item)) {
        var ks = Object.keys(item);
        var first = true;
        ks.forEach(function (kk) {
          var p = first ? apad + '- ' : apad + '  ';
          first = false;
          emitKeyValue(lines, kk, item[kk], indent + 4, p);
        });
      } else {
        lines.push(apad + '- ' + scalarOut(item));
      }
    });
    return;
  }
  if (typeof val === 'object') {
    lines.push(pad + key + ':');
    Object.keys(val).forEach(function (kk) {
      emitKeyValue(lines, kk, val[kk], indent + 2);
    });
    return;
  }
  lines.push(pad + key + ': ' + scalarOut(val));
}

function scalarOut(v) {
  if (v === null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  var s = String(v);
  // Force double-quote any string that could ambiguate or contain a fence.
  if (s === '' || /^(true|false|null|~)$/i.test(s) || /^-?\d/.test(s) ||
      /[:#\[\]\{\},&*!|>'"%@`?-]/.test(s.charAt(0)) || /\s$/.test(s) ||
      s.indexOf('\n') >= 0 || s.indexOf('```') >= 0) {
    return JSON.stringify(s);
  }
  return s;
}

// ─── Token (canonical JSON over fields + buttons) ─────────────

function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  if (typeof value === 'object') {
    var keys = Object.keys(value).sort();
    return '{' + keys.map(function (k) {
      return JSON.stringify(k) + ':' + canonicalJson(value[k]);
    }).join(',') + '}';
  }
  return 'null';
}

function canonicalFormSignature(fields, buttons) {
  // Strip schema to allowed keys before hashing so cosmetic unknown
  // keys can't shift the token under our feet.
  var f = (fields || []).map(function (x) { return stripToKeys(x, FIELD_KEYS); });
  var b = (buttons || []).map(function (x) { return stripToKeys(x, BUTTON_KEYS); });
  return canonicalJson({ fields: f, buttons: b });
}

function stripToKeys(obj, keys) {
  if (!obj || typeof obj !== 'object') return obj;
  var out = {};
  keys.forEach(function (k) { if (k in obj) out[k] = obj[k]; });
  return out;
}

// Tiny non-cryptographic hash. Adequate for revision tokens — we only
// need to detect schema changes, not resist preimage attacks. SHA-1
// would be cleaner but introduces a Web Crypto async surface across
// browser + node + sync code paths. We pick FNV-1a 32 bit, doubled to
// 64 bits via a second pass with a different basis, to get a short
// hex token with low collision risk for the schema shapes we expect.
function fnv1a64Hex(s) {
  var h1 = 0x811c9dc5 >>> 0;
  var h2 = 0xcbf29ce4 >>> 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 ^ (c + 0x100)) >>> 0;
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  var hex1 = ('00000000' + h1.toString(16)).slice(-8);
  var hex2 = ('00000000' + h2.toString(16)).slice(-8);
  return hex1 + hex2;
}

function formRevisionToken(fields, buttons) {
  return fnv1a64Hex(canonicalFormSignature(fields, buttons));
}

// ─── Locate form blocks in a markdown document ────────────────
//
// Returns an array of { id, startByte, endByte, innerText, error? }
// for every fenced ```form block in the document. Used by the bridge
// to splice updates back in without touching surrounding bytes.

function findFormBlocks(doc) {
  var out = [];
  if (typeof doc !== 'string') return out;
  // Match ```form fences. Opening fence must be on its own line.
  var lines = doc.split('\n');
  // Pre-compute byte offsets of each line start.
  var offsets = [0];
  for (var i = 0; i < lines.length; i++) {
    offsets.push(offsets[i] + lines[i].length + 1); // +1 for \n
  }
  var i2 = 0;
  while (i2 < lines.length) {
    var line = lines[i2];
    if (/^```form\s*$/.test(line)) {
      var startByte = offsets[i2];
      var bodyStart = i2 + 1;
      var j = bodyStart;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) j++;
      var bodyEnd = j;
      var endByte = (j < lines.length) ? offsets[j + 1] : offsets[j];
      var innerText = lines.slice(bodyStart, bodyEnd).join('\n');
      var parsed = parseFormBlock(innerText);
      var entry = {
        startByte: startByte,
        endByte: endByte,
        innerText: innerText,
        lineStart: i2 + 1, // 1-based
        lineEnd: j + 1,
      };
      if (parsed.error) {
        entry.error = parsed.error;
      } else {
        entry.id = parsed.value.id;
        entry.parsed = parsed.value;
      }
      out.push(entry);
      i2 = j + 1;
      continue;
    }
    i2++;
  }
  return out;
}

// ─── Splice a form block back into the document ───────────────
//
// Pre-condition: `block` was loaded from `doc`, its `startByte` and
// `endByte` reference the existing fenced region. We replace the body
// (between the fences) with a freshly serialised form block.
//
// Returns { doc, startByte, endByte } where startByte is unchanged
// from input and endByte is the new closing-fence-and-newline boundary.
// The caller is expected to call findFormBlocks() on the returned doc
// and verify the byte slice [0, startByte] and [endByte..] are
// identical to the original — that's the boundary-stability check
// the bridge enforces.

function spliceFormBlock(doc, block, newParsed) {
  if (!block || typeof doc !== 'string') {
    return { error: 'spliceFormBlock: bad arguments' };
  }
  if (typeof block.startByte !== 'number' || typeof block.endByte !== 'number') {
    return { error: 'spliceFormBlock: missing offsets' };
  }
  var serialized = serializeFormBlock(newParsed);
  var replacement = '```form\n' + serialized + '\n```\n';
  var newDoc = doc.slice(0, block.startByte) + replacement + doc.slice(block.endByte);
  return {
    doc: newDoc,
    startByte: block.startByte,
    endByte: block.startByte + replacement.length,
  };
}

// ─── Public exports ───────────────────────────────────────────

exports.MAX_BLOCK_BYTES        = MAX_BLOCK_BYTES;
exports.NAME_RE                = NAME_RE;
exports.ALLOWED_TYPES          = ALLOWED_TYPES;
exports.parseFormBlock         = parseFormBlock;
exports.serializeFormBlock     = serializeFormBlock;
exports.canonicalFormSignature = canonicalFormSignature;
exports.formRevisionToken      = formRevisionToken;
exports.findFormBlocks         = findFormBlocks;
exports.spliceFormBlock        = spliceFormBlock;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocFormBlock = {}));
