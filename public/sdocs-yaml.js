// sdocs-yaml.js — YAML front matter parse/serialize (UMD)
// Shared by browser (app) and Node (CLI + tests)
(function (exports) {
'use strict';

function parseScalar(v) {
  v = v.trim().replace(/^["']|["']$/g, '');
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

function parseBlock(lines, startIdx, indent) {
  const result = {};
  let i = startIdx;
  const prefix = new RegExp('^' + ' '.repeat(indent));
  const deeper = new RegExp('^' + ' '.repeat(indent + 2));
  while (i < lines.length && prefix.test(lines[i])) {
    const nl = lines[i].substring(indent);
    const nm = nl.match(/^(\w[\w-]*):\s*(.*)/);
    if (!nm) { i++; continue; }
    const key = nm[1], rest = nm[2].trim();
    if (rest.startsWith('{')) {
      result[key] = parseInlineObject(rest); i++;
    } else if (rest === '' && i + 1 < lines.length && deeper.test(lines[i + 1])) {
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

function serializeFrontMatter(meta) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === 'object' && v !== null) {
      lines.push(`${k}:`);
      for (const [sk, sv] of Object.entries(v)) {
        if (typeof sv === 'object' && sv !== null) {
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
