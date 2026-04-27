// sdocs-yaml.js — YAML front matter parse/serialize (UMD)
// Shared by browser (app) and Node (CLI + tests).
// Supports a subset of YAML: nested maps, inline `{...}` leaf maps, and
// arrays of scalars or objects serialized as `- item` blocks.
(function (exports) {
'use strict';

function parseScalar(v) {
  v = v.trim();
  if (v === '') return v;
  // Quoted string: strip quotes and handle minimal escapes.
  if ((v[0] === '"' && v[v.length - 1] === '"') ||
      (v[0] === "'" && v[v.length - 1] === "'")) {
    var quoted = v.slice(1, -1);
    if (v[0] === '"') {
      quoted = quoted.replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n');
    }
    return quoted;
  }
  const n = Number(v);
  return (!isNaN(n) && v !== '') ? n : v;
}

function parseInlineObject(str) {
  const inner = str.replace(/^\{/, '').replace(/\}$/, '').trim();
  const obj = {};
  inner.split(',').forEach(pair => {
    const m = pair.trim().match(/^(\w[\w-]*):\s*(.*)/);
    if (m) obj[m[1]] = parseScalar(m[2].trim());
  });
  return obj;
}

// Parses an array block starting at lines[startIdx] whose items are
// introduced by `- ` at exactly `indent` columns. An item is either a
// scalar (`- foo`) or an object whose first key appears on the same line
// as the dash (`- key: value`) and whose following keys are indented two
// beyond the dash.
function parseArray(lines, startIdx, indent) {
  var out = [];
  var i = startIdx;
  var dashPrefix = ' '.repeat(indent) + '- ';
  while (i < lines.length && lines[i].startsWith(dashPrefix)) {
    var rest = lines[i].substring(dashPrefix.length);
    var km = rest.match(/^(\w[\w-]*):\s*(.*)/);
    if (km) {
      // Object item. Collect this line's key + any keys indented further.
      var obj = {};
      var key = km[1], val = km[2].trim();
      if (val === '' && i + 1 < lines.length) {
        // Nested object value under the key — not expected in our schema.
        obj[key] = parseScalar(val);
      } else {
        obj[key] = parseScalar(val);
      }
      i++;
      var itemPrefix = ' '.repeat(indent + 2);
      while (i < lines.length && lines[i].startsWith(itemPrefix) && !lines[i].startsWith(dashPrefix)) {
        var line = lines[i].substring(indent + 2);
        var im = line.match(/^(\w[\w-]*):\s*(.*)/);
        if (im) obj[im[1]] = parseScalar(im[2]);
        i++;
      }
      out.push(obj);
    } else {
      out.push(parseScalar(rest));
      i++;
    }
  }
  return { arr: out, nextIdx: i };
}

function parseBlock(lines, startIdx, indent) {
  const result = {};
  let i = startIdx;
  const prefix = new RegExp('^' + ' '.repeat(indent));
  const deeper = new RegExp('^' + ' '.repeat(indent + 2));
  const dashDeeper = new RegExp('^' + ' '.repeat(indent + 2) + '- ');
  const dashSame = new RegExp('^' + ' '.repeat(indent) + '- ');
  while (i < lines.length && prefix.test(lines[i])) {
    const nl = lines[i].substring(indent);
    const nm = nl.match(/^(\w[\w-]*):\s*(.*)/);
    if (!nm) { i++; continue; }
    const key = nm[1], rest = nm[2].trim();
    if (rest.startsWith('{')) {
      result[key] = parseInlineObject(rest); i++;
    } else if (rest === '' && i + 1 < lines.length && dashDeeper.test(lines[i + 1])) {
      // Array child: `key:` followed by `  - ...` lines.
      i++;
      var arr = parseArray(lines, i, indent + 2);
      result[key] = arr.arr;
      i = arr.nextIdx;
    } else if (rest === '' && i + 1 < lines.length && deeper.test(lines[i + 1]) && !dashSame.test(lines[i + 1])) {
      i++;
      var sub = parseBlock(lines, i, indent + 2);
      result[key] = sub.obj;
      i = sub.nextIdx;
    } else {
      result[key] = parseScalar(rest); i++;
    }
  }
  return { obj: result, nextIdx: i };
}

function parseSimpleYaml(str) {
  const lines = str.split('\n');
  return parseBlock(lines, 0, 0).obj;
}

function parseFrontMatter(text) {
  const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const m = text.match(FM_RE);
  if (!m) return { meta: {}, body: text };
  return { meta: parseSimpleYaml(m[1]), body: text.slice(m[0].length) };
}

function hasNestedObjects(obj) {
  for (const v of Object.values(obj)) {
    if (typeof v === 'object' && v !== null) return true;
  }
  return false;
}

function serializeArrayItems(arr, indent) {
  const lines = [];
  const pad = ' '.repeat(indent);
  for (const item of arr) {
    if (item === null || typeof item !== 'object') {
      lines.push(`${pad}- ${JSON.stringify(item)}`);
    } else {
      const entries = Object.entries(item);
      if (entries.length === 0) {
        lines.push(`${pad}- {}`);
        continue;
      }
      const [firstK, firstV] = entries[0];
      lines.push(`${pad}- ${firstK}: ${JSON.stringify(firstV)}`);
      for (let j = 1; j < entries.length; j++) {
        const [k, v] = entries[j];
        lines.push(`${pad}  ${k}: ${JSON.stringify(v)}`);
      }
    }
  }
  return lines;
}

function serializeFrontMatter(meta) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (Array.isArray(v)) {
      // For the comments list, prepend a one-line schema doc so a reader
      // (human or agent) opening this file cold can interpret block ids
      // and the resolved flag without grepping the source.
      if (k === 'comments' && v.length) {
        lines.push('# Comments: block "tag:n" = nth (0-indexed) <tag> in render order.');
        lines.push('# block kind may carry block_text (first ~60 chars) as a survival hint when the index drifts.');
        lines.push('# inline kind anchors via quote (+ optional prefix/suffix). resolved: true marks addressed.');
      }
      lines.push(`${k}:`);
      for (const line of serializeArrayItems(v, 2)) lines.push(line);
    } else if (typeof v === 'object' && v !== null) {
      lines.push(`${k}:`);
      for (const [sk, sv] of Object.entries(v)) {
        if (Array.isArray(sv)) {
          lines.push(`  ${sk}:`);
          for (const line of serializeArrayItems(sv, 4)) lines.push(line);
        } else if (typeof sv === 'object' && sv !== null) {
          // If sub-object contains nested objects (3 levels), serialize as block
          if (hasNestedObjects(sv)) {
            lines.push(`  ${sk}:`);
            for (const [a, b] of Object.entries(sv)) {
              if (typeof b === 'object' && b !== null) {
                const inner = Object.entries(b).map(([c,d]) => `${c}: ${JSON.stringify(d)}`).join(', ');
                lines.push(`    ${a}: { ${inner} }`);
              } else {
                lines.push(`    ${a}: ${JSON.stringify(b)}`);
              }
            }
          } else {
            const inner = Object.entries(sv).map(([a,b]) => `${a}: ${JSON.stringify(b)}`).join(', ');
            lines.push(`  ${sk}: { ${inner} }`);
          }
        } else { lines.push(`  ${sk}: ${JSON.stringify(sv)}`); }
      }
    } else { lines.push(`${k}: ${JSON.stringify(v)}`); }
  }
  lines.push('---');
  return lines.join('\n');
}

exports.parseScalar = parseScalar;
exports.parseInlineObject = parseInlineObject;
exports.parseSimpleYaml = parseSimpleYaml;
exports.parseFrontMatter = parseFrontMatter;
exports.serializeFrontMatter = serializeFrontMatter;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocYaml = {}));
