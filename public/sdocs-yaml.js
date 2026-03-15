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

function parseSimpleYaml(str) {
  const result = {};
  const lines = str.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const km = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (!km) { i++; continue; }
    const key = km[1], rest = km[2].trim();
    if (rest.startsWith('{')) {
      result[key] = parseInlineObject(rest); i++;
    } else if (rest === '') {
      const nested = {}; i++;
      while (i < lines.length && /^  /.test(lines[i])) {
        const nl = lines[i].trim();
        const nm = nl.match(/^(\w[\w-]*):\s*(.*)/);
        if (nm) nested[nm[1]] = nm[2].trim().startsWith('{')
          ? parseInlineObject(nm[2].trim()) : parseScalar(nm[2].trim());
        i++;
      }
      result[key] = nested;
    } else { result[key] = parseScalar(rest); i++; }
  }
  return result;
}

function parseFrontMatter(text) {
  const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const m = text.match(FM_RE);
  if (!m) return { meta: {}, body: text };
  return { meta: parseSimpleYaml(m[1]), body: text.slice(m[0].length) };
}

function serializeFrontMatter(meta) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === 'object' && v !== null) {
      lines.push(`${k}:`);
      for (const [sk, sv] of Object.entries(v)) {
        if (typeof sv === 'object' && sv !== null) {
          const inner = Object.entries(sv).map(([a,b]) => `${a}: ${JSON.stringify(b)}`).join(', ');
          lines.push(`  ${sk}: { ${inner} }`);
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
