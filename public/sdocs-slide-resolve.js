// sdocs-slide-resolve.js — template resolution for slide blocks (UMD).
// Shared by the browser slide pipeline and Node unit tests.
//
// Input:  an array of raw slide DSL strings (the text between ~~~slide
//         fences), in document order.
// Output: an array of { dsl, skip, errors } in the same order, where:
//           - dsl: the DSL text to render (merged for consumers; unchanged
//             for plain slides; the template body for template slides)
//           - skip: true for @template slides (they register but don't render)
//           - errors: [{ message }] of resolve-time problems (unknown
//             template, malformed directive, etc.). Empty array when clean.
//
// Directives (must be the first non-blank line inside the fence):
//   @template NAME   — register this slide's DSL under NAME; don't render it.
//   @extends  NAME   — replace slot contents in template NAME with the
//                      `#id: value` blocks that follow.
//
// Slot block syntax inside @extends bodies:
//   #id: inline value                 (single-line)
//   #id:                              (multi-line; content on following
//     content line one                 lines, until the next `#id:` or EOF)
//     content line two
//
// The resolver is deliberately pure — it takes strings, returns strings,
// and does not touch the DOM, parse shape geometry, or know anything
// about CSS. All heavy lifting (DSL parsing, rendering) happens downstream
// on the resolved text, so templates re-use every existing code path.

(function (exports) {
'use strict';

var DIRECTIVE_RE = /^\s*@(template|extends)\s+([A-Za-z][\w-]*)\s*$/;
var SLOT_RE = /^#([A-Za-z][\w-]*)\s*:\s?(.*)$/;

function splitDirective(raw) {
  var lines = String(raw == null ? '' : raw).split('\n');
  var i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length) return { kind: null };
  var m = lines[i].match(DIRECTIVE_RE);
  if (!m) return { kind: null };
  return {
    kind: m[1],
    name: m[2],
    body: lines.slice(i + 1).join('\n'),
  };
}

function parseSlots(body) {
  var lines = body.split('\n');
  var slots = {};
  var currentId = null;
  var buf = [];
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i];
    var m = ln.match(SLOT_RE);
    if (m) {
      if (currentId !== null) slots[currentId] = trimTrailingBlank(buf).join('\n');
      currentId = m[1];
      buf = m[2] ? [m[2]] : [];
    } else if (currentId !== null) {
      buf.push(ln);
    }
    // Lines before the first #id: are ignored (allows authors to leave
    // notes or blank space between @extends and the first slot).
  }
  if (currentId !== null) slots[currentId] = trimTrailingBlank(buf).join('\n');
  return slots;
}

function trimTrailingBlank(lines) {
  var end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end--;
  return lines.slice(0, end);
}

// Merge the template's shapes with the consumer's slots by #id match.
// Relies on the SDocShapes parse/serialize pair, so any DSL the parser
// accepts round-trips correctly. Shapes whose id doesn't appear in the
// consumer's slots keep their template-provided content — that's how
// "partial fills render the layout's placeholder" works.
function mergeTemplate(templateDsl, slots, SDocShapes) {
  var parsed = SDocShapes.parse(templateDsl);
  var shapes = parsed.shapes.map(function (s) {
    if (s.id && Object.prototype.hasOwnProperty.call(slots, s.id)) {
      var copy = {};
      for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) copy[k] = s[k];
      copy.content = slots[s.id];
      return copy;
    }
    return s;
  });
  return SDocShapes.serialize(shapes, parsed.grid);
}

function resolveSlides(rawDsls, SDocShapes) {
  if (!SDocShapes) {
    throw new Error('resolveSlides: SDocShapes is required');
  }
  var templates = {};
  var parsed = rawDsls.map(splitDirective);

  // Pass 1: register every @template. Doing this ahead of pass 2 means
  // author ordering in the document is unconstrained — a consumer can
  // appear before its template.
  for (var i = 0; i < parsed.length; i++) {
    var p = parsed[i];
    if (p.kind === 'template') templates[p.name] = p.body;
  }

  // Pass 2: build a result per slide.
  return parsed.map(function (p, idx) {
    var raw = rawDsls[idx];
    if (p.kind === 'template') {
      return { dsl: p.body, skip: true, errors: [] };
    }
    if (p.kind === 'extends') {
      if (!templates[p.name]) {
        return {
          dsl: raw,
          skip: false,
          errors: [{ line: 1, message: 'unknown template "' + p.name + '"' }],
        };
      }
      var slots = parseSlots(p.body);
      var merged;
      try {
        merged = mergeTemplate(templates[p.name], slots, SDocShapes);
      } catch (e) {
        return {
          dsl: raw,
          skip: false,
          errors: [{ line: 1, message: 'template merge failed: ' + e.message }],
        };
      }
      return { dsl: merged, skip: false, errors: [] };
    }
    // Plain slide — untouched.
    return { dsl: raw, skip: false, errors: [] };
  });
}

exports.resolveSlides = resolveSlides;
exports.splitDirective = splitDirective;
exports.parseSlots = parseSlots;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocSlideResolve = {}));
