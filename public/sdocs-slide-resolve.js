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
// Consumer slot lines optionally accept a trailing `!` after the id - the
// required marker belongs in the template, but accepting it here means a
// copy-paste from a template definition doesn't silently break.
var SLOT_RE = /^#([A-Za-z][\w-]*)!?\s*:\s?(.*)$/;

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
  var inline = false;  // inline-only slot (body on the directive line)
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i];
    var m = ln.match(SLOT_RE);
    if (m) {
      if (currentId !== null) slots[currentId] = finalizeBuf(buf, inline);
      currentId = m[1];
      // A bare `|` after the colon is YAML-style block-scalar sugar: the
      // user signalled "multi-line body follows", same as an empty inline.
      // Dropping it prevents the literal `|` from leaking into the rendered
      // markdown as a stray paragraph.
      var inlineVal = m[2] === '|' ? '' : m[2];
      inline = inlineVal.length > 0;
      buf = inlineVal ? [inlineVal] : [];
    } else if (currentId !== null) {
      buf.push(ln);
      inline = false;  // as soon as we collect body lines, treat as block
    }
    // Lines before the first #id: are ignored (allows authors to leave
    // notes or blank space between @extends and the first slot).
  }
  if (currentId !== null) slots[currentId] = finalizeBuf(buf, inline);
  return slots;
}

// Inline slots (single-line `#id: value`) round-trip as-is. Block slots get
// trailing blank lines trimmed and common leading indent stripped, so an
// author who wrote:
//
//   #body:
//     - one
//     - two
//
// gets `- one\n- two` in their shape content (not `  - one\n  - two`, which
// markdown may render with an extra indent level or misread as code).
function finalizeBuf(lines, isInline) {
  if (isInline) return lines.join('\n');
  return dedent(trimTrailingBlank(lines)).join('\n');
}

function trimTrailingBlank(lines) {
  var end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end--;
  return lines.slice(0, end);
}

function dedent(lines) {
  var min = Infinity;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    var lead = /^ */.exec(lines[i])[0].length;
    if (lead < min) min = lead;
  }
  if (!isFinite(min) || min === 0) return lines;
  return lines.map(function (l) {
    return l.length >= min ? l.slice(min) : l;
  });
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

function resolveSlides(rawDsls, SDocShapes, opts) {
  if (!SDocShapes) {
    throw new Error('resolveSlides: SDocShapes is required');
  }
  opts = opts || {};
  var stdlib = opts.stdlib || {};

  var templates = {};
  var shadowSlideByName = {};
  var parsed = rawDsls.map(splitDirective);

  // Pass 1: register every user @template. Doing this ahead of pass 2
  // means author ordering in the document is unconstrained - a consumer
  // can appear before its template. A user template shadowing a stdlib
  // name is allowed but flagged on the template's own slide entry, so
  // accidental shadowing is visible at render time.
  for (var i = 0; i < parsed.length; i++) {
    var p = parsed[i];
    if (p.kind === 'template') {
      templates[p.name] = p.body;
      if (Object.prototype.hasOwnProperty.call(stdlib, p.name)) {
        shadowSlideByName[p.name] = i;
      }
    }
  }

  // Pass 2: build a result per slide.
  return parsed.map(function (p, idx) {
    var raw = rawDsls[idx];
    if (p.kind === 'template') {
      var tErrs = [];
      if (shadowSlideByName[p.name] === idx) {
        tErrs.push({
          line: 1,
          message: 'template "' + p.name + '" shadows the stdlib template of the same name',
        });
      }
      return { dsl: p.body, skip: true, errors: tErrs };
    }
    if (p.kind === 'extends') {
      var tplBody = Object.prototype.hasOwnProperty.call(templates, p.name)
        ? templates[p.name]
        : (Object.prototype.hasOwnProperty.call(stdlib, p.name) ? stdlib[p.name] : null);
      if (!tplBody) {
        return {
          dsl: raw,
          skip: false,
          errors: [{ line: 1, message: 'unknown template "' + p.name + '"' }],
        };
      }

      var slots = parseSlots(p.body);
      var errors = [];

      // Parse the template once so we can introspect shape ids + required
      // markers. The same parse work happens inside mergeTemplate; we eat
      // the duplication for clarity (resolver stays pure DSL-string-in,
      // DSL-string-out at the boundary).
      var parsedTpl;
      try {
        parsedTpl = SDocShapes.parse(tplBody);
      } catch (e) {
        return {
          dsl: raw,
          skip: false,
          errors: [{ line: 1, message: 'template parse failed: ' + e.message }],
        };
      }

      var templateIds = {};
      for (var s = 0; s < parsedTpl.shapes.length; s++) {
        var sid = parsedTpl.shapes[s].id;
        if (sid) templateIds[sid] = parsedTpl.shapes[s];
      }

      // Unknown-slot check: consumer named a slot the template doesn't
      // define. Silently no-op was the #1 cause of "template feels
      // broken" confusion - surface it as an error per the DSL-design
      // review.
      for (var slotName in slots) {
        if (!Object.prototype.hasOwnProperty.call(slots, slotName)) continue;
        if (!Object.prototype.hasOwnProperty.call(templateIds, slotName)) {
          errors.push({
            line: 1,
            message: 'unknown slot "#' + slotName + '" (template "' + p.name + '" has no shape with that id)',
          });
        }
      }

      // Required-slot check: template marked the shape with #id! but
      // the consumer didn't pass that slot.
      for (var tid in templateIds) {
        if (!Object.prototype.hasOwnProperty.call(templateIds, tid)) continue;
        var shp = templateIds[tid];
        if (shp.required && !Object.prototype.hasOwnProperty.call(slots, tid)) {
          errors.push({
            line: 1,
            message: 'missing required slot "#' + tid + '" for template "' + p.name + '"',
          });
        }
      }

      var merged;
      try {
        merged = mergeTemplate(tplBody, slots, SDocShapes);
      } catch (e) {
        return {
          dsl: raw,
          skip: false,
          errors: [{ line: 1, message: 'template merge failed: ' + e.message }],
        };
      }
      return { dsl: merged, skip: false, errors: errors };
    }
    // Plain slide - untouched.
    return { dsl: raw, skip: false, errors: [] };
  });
}

exports.resolveSlides = resolveSlides;
exports.splitDirective = splitDirective;
exports.parseSlots = parseSlots;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocSlideResolve = {}));
