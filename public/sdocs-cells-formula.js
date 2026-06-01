// sdocs-cells-formula.js - a small spreadsheet formula engine.
//
// Pure, dependency-free, shared between the browser (window.SDocCellsFormula)
// and Node tests (module.exports) via the UMD pattern used by the other cells
// modules. It evaluates a single cell's formula string (anything whose raw
// text starts with "=") against a grid of other cells, and recalc() resolves
// a whole model at once with cycle detection.
//
// Supported, deliberately small but useful:
//   numbers            12, 3.5, -2, 1e3
//   operators          + - * / ^ %  and unary minus, with parentheses
//   cell references    A1, B12  (column letters + 1-based row, like the UI)
//   ranges             A1:B3    (only inside a function's arguments)
//   functions          SUM AVERAGE/AVG MIN MAX COUNT COUNTA PRODUCT
//                      ROUND ABS IF
//   comparisons        = <> < <= > >=   (mainly for IF)
//
// Values: a referenced empty cell is 0 in arithmetic; referenced text is an
// error (#VALUE!) in arithmetic but is counted by COUNTA and ignored by SUM.
// Anything that goes wrong yields an error string (#VALUE!, #DIV/0!, #NAME?,
// #REF!, #CIRC!) which the renderer shows in the cell, just like a real sheet.
(function (exports) {
  'use strict';

  // Column letters -> 0-based index (mirror sdocs-cells.js so refs line up).
  function colIndex(letters) {
    var n = 0;
    for (var i = 0; i < letters.length; i++) {
      n = n * 26 + (letters.charCodeAt(i) - 64); // 'A' = 65 -> 1
    }
    return n - 1;
  }

  // 0-based index -> column letters (inverse of colIndex): 0 -> A, 26 -> AA.
  function colName(index) {
    var name = '';
    var n = index + 1;
    while (n > 0) {
      var rem = (n - 1) % 26;
      name = String.fromCharCode(65 + rem) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function isFormula(raw) {
    return typeof raw === 'string' && raw.charAt(0) === '=' && raw.length > 1;
  }

  function mkErr(code) { var e = new Error(code); e.isFormulaError = true; e.code = code; return e; }

  // ── Tokenizer ────────────────────────────────────────────
  function tokenize(src) {
    var toks = [];
    var i = 0, n = src.length;
    function isDigit(c) { return c >= '0' && c <= '9'; }
    function isAlpha(c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'); }
    while (i < n) {
      var c = src[i];
      if (c === ' ' || c === '\t') { i++; continue; }
      if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
        var num = '';
        while (i < n && (isDigit(src[i]) || src[i] === '.')) num += src[i++];
        if (i < n && (src[i] === 'e' || src[i] === 'E')) {
          num += src[i++];
          if (src[i] === '+' || src[i] === '-') num += src[i++];
          while (i < n && isDigit(src[i])) num += src[i++];
        }
        toks.push({ t: 'num', v: parseFloat(num) });
        continue;
      }
      if (isAlpha(c)) {
        var word = '';
        while (i < n && (isAlpha(src[i]) || isDigit(src[i]))) word += src[i++];
        var m = /^([A-Za-z]+)([0-9]+)$/.exec(word);
        if (m && src[i] !== '(') {
          toks.push({ t: 'ref', col: colIndex(m[1].toUpperCase()), row: parseInt(m[2], 10) - 1 });
        } else {
          toks.push({ t: 'name', v: word.toUpperCase() });
        }
        continue;
      }
      if (c === '<' || c === '>') {
        var op = c; i++;
        if (src[i] === '=' || (c === '<' && src[i] === '>')) op += src[i++];
        toks.push({ t: 'op', v: op });
        continue;
      }
      if ('+-*/^%(),:='.indexOf(c) !== -1) { toks.push({ t: 'op', v: c }); i++; continue; }
      // A literal #REF! (left behind by shiftFormula when a reference was
      // pushed off the sheet) evaluates to that error.
      if (c === '#') throw mkErr(src.slice(i, i + 5).toUpperCase() === '#REF!' ? '#REF!' : '#NAME?');
      throw mkErr('#NAME?');
    }
    return toks;
  }

  // ── Recursive-descent parser -> AST ──────────────────────
  function parse(toks) {
    var pos = 0;
    function peek() { return toks[pos]; }
    function next() { return toks[pos++]; }
    function expectOp(v) { var t = next(); if (!t || t.t !== 'op' || t.v !== v) throw mkErr('#VALUE!'); }

    function parseCompare() {
      var left = parseAdd();
      var t = peek();
      if (t && t.t === 'op' && ['=', '<>', '<', '<=', '>', '>='].indexOf(t.v) !== -1) {
        next();
        return { k: 'cmp', op: t.v, a: left, b: parseAdd() };
      }
      return left;
    }
    function parseAdd() {
      var node = parseMul();
      while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
        var op = next().v; node = { k: 'bin', op: op, a: node, b: parseMul() };
      }
      return node;
    }
    function parseMul() {
      var node = parsePow();
      while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/')) {
        var op = next().v; node = { k: 'bin', op: op, a: node, b: parsePow() };
      }
      return node;
    }
    function parsePow() {
      var node = parseUnary();
      if (peek() && peek().t === 'op' && peek().v === '^') {
        next(); return { k: 'bin', op: '^', a: node, b: parsePow() };
      }
      return node;
    }
    function parseUnary() {
      var t = peek();
      if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) {
        next(); return { k: 'unary', op: t.v, a: parseUnary() };
      }
      return parsePostfix();
    }
    function parsePostfix() {
      var node = parsePrimary();
      if (peek() && peek().t === 'op' && peek().v === '%') { next(); node = { k: 'percent', a: node }; }
      return node;
    }
    function parsePrimary() {
      var t = next();
      if (!t) throw mkErr('#VALUE!');
      if (t.t === 'num') return { k: 'num', v: t.v };
      if (t.t === 'ref') {
        if (peek() && peek().t === 'op' && peek().v === ':') {
          next(); var end = next();
          if (!end || end.t !== 'ref') throw mkErr('#REF!');
          return { k: 'range', c0: t.col, r0: t.row, c1: end.col, r1: end.row };
        }
        return { k: 'ref', col: t.col, row: t.row };
      }
      if (t.t === 'name') {
        if (peek() && peek().t === 'op' && peek().v === '(') {
          next();
          var args = [];
          if (!(peek() && peek().t === 'op' && peek().v === ')')) {
            args.push(parseCompare());
            while (peek() && peek().t === 'op' && peek().v === ',') { next(); args.push(parseCompare()); }
          }
          expectOp(')');
          return { k: 'call', name: t.v, args: args };
        }
        if (t.v === 'TRUE') return { k: 'num', v: 1 };
        if (t.v === 'FALSE') return { k: 'num', v: 0 };
        throw mkErr('#NAME?');
      }
      if (t.t === 'op' && t.v === '(') { var e = parseCompare(); expectOp(')'); return e; }
      throw mkErr('#VALUE!');
    }

    var ast = parseCompare();
    if (pos !== toks.length) throw mkErr('#VALUE!');
    return ast;
  }

  // ── Evaluator ────────────────────────────────────────────
  function evalAst(node, ctx) {
    switch (node.k) {
      case 'num': return node.v;
      case 'unary': { var v = num(evalAst(node.a, ctx)); return node.op === '-' ? -v : v; }
      case 'percent': return num(evalAst(node.a, ctx)) / 100;
      case 'bin': {
        var a = num(evalAst(node.a, ctx)), b = num(evalAst(node.b, ctx));
        switch (node.op) {
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/': if (b === 0) throw mkErr('#DIV/0!'); return a / b;
          case '^': return Math.pow(a, b);
        }
        throw mkErr('#VALUE!');
      }
      case 'cmp': {
        var x = num(evalAst(node.a, ctx)), y = num(evalAst(node.b, ctx)), r;
        switch (node.op) {
          case '=': r = x === y; break;
          case '<>': r = x !== y; break;
          case '<': r = x < y; break;
          case '<=': r = x <= y; break;
          case '>': r = x > y; break;
          case '>=': r = x >= y; break;
          default: throw mkErr('#VALUE!');
        }
        return r ? 1 : 0;
      }
      case 'ref': return refValue(ctx.cell(node.col, node.row));
      case 'range': throw mkErr('#VALUE!');
      case 'call': return callFn(node, ctx);
    }
    throw mkErr('#VALUE!');
  }

  function refValue(cell) {
    if (!cell || cell.kind === 'empty') return 0;
    if (cell.kind === 'number') return cell.value;
    if (cell.kind === 'error') throw mkErr(cell.code || '#VALUE!');
    throw mkErr('#VALUE!');
  }

  function num(v) { if (typeof v !== 'number' || !isFinite(v)) throw mkErr('#VALUE!'); return v; }

  function argCells(arg, ctx) {
    if (arg.k === 'range') {
      var out = [];
      var r0 = Math.min(arg.r0, arg.r1), r1 = Math.max(arg.r0, arg.r1);
      var c0 = Math.min(arg.c0, arg.c1), c1 = Math.max(arg.c0, arg.c1);
      for (var r = r0; r <= r1; r++) {
        for (var c = c0; c <= c1; c++) out.push(ctx.cell(c, r));
      }
      return out;
    }
    return [{ kind: 'number', value: num(evalAst(arg, ctx)) }];
  }

  function callFn(node, ctx) {
    var name = node.name, args = node.args;
    switch (name) {
      case 'SUM': case 'PRODUCT': case 'MIN': case 'MAX':
      case 'AVERAGE': case 'AVG': case 'COUNT': case 'COUNTA': {
        var nums = [], counted = 0, errored = null;
        for (var i = 0; i < args.length; i++) {
          var cells = argCells(args[i], ctx);
          for (var j = 0; j < cells.length; j++) {
            var cl = cells[j];
            if (cl.kind === 'error') { errored = cl.code || '#VALUE!'; }
            else if (cl.kind === 'number') { nums.push(cl.value); counted++; }
            else if (cl.kind === 'text') { counted++; }
          }
        }
        if (errored && name !== 'COUNTA') throw mkErr(errored);
        if (name === 'COUNT') return nums.length;
        if (name === 'COUNTA') return counted;
        if (!nums.length) {
          if (name === 'SUM') return 0;
          if (name === 'PRODUCT') return 0;
          throw mkErr('#DIV/0!');
        }
        if (name === 'SUM') return nums.reduce(function (a, b) { return a + b; }, 0);
        if (name === 'PRODUCT') return nums.reduce(function (a, b) { return a * b; }, 1);
        if (name === 'MIN') return Math.min.apply(null, nums);
        if (name === 'MAX') return Math.max.apply(null, nums);
        return nums.reduce(function (a, b) { return a + b; }, 0) / nums.length; // AVERAGE
      }
      case 'ROUND': {
        if (args.length < 1) throw mkErr('#VALUE!');
        var x = num(evalAst(args[0], ctx));
        var d = args.length > 1 ? num(evalAst(args[1], ctx)) : 0;
        var f = Math.pow(10, d);
        return Math.round(x * f) / f;
      }
      case 'ABS':
        if (args.length !== 1) throw mkErr('#VALUE!');
        return Math.abs(num(evalAst(args[0], ctx)));
      case 'IF': {
        if (args.length < 2) throw mkErr('#VALUE!');
        var cond = num(evalAst(args[0], ctx));
        return cond !== 0 ? evalAst(args[1], ctx)
          : (args.length > 2 ? evalAst(args[2], ctx) : 0);
      }
    }
    throw mkErr('#NAME?');
  }

  // ── Relative reference shifting (fill handle / copy-paste) ──
  // Rewrite every cell reference in a formula by (dr, dc) rows/columns:
  // shiftFormula('=B2*C2', 1, 0) -> '=B3*C3'. Function names (SUM, IF...) are
  // left alone - a word is only a reference when it is letters+digits and not
  // followed by '('. A reference pushed past row 1 / column A becomes the
  // literal #REF!, which evaluates to a #REF! error. Non-formula strings pass
  // through unchanged.
  function shiftFormula(formula, dr, dc) {
    if (!isFormula(formula)) return formula;
    var src = formula.slice(1);
    var out = '';
    var i = 0, n = src.length;
    function isAlpha(ch) { return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z'); }
    function isDigit(ch) { return ch >= '0' && ch <= '9'; }
    while (i < n) {
      var c = src[i];
      if (isAlpha(c)) {
        var j = i;
        while (j < n && (isAlpha(src[j]) || isDigit(src[j]))) j++;
        var word = src.slice(i, j);
        var m = /^([A-Za-z]+)([0-9]+)$/.exec(word);
        if (m && src[j] !== '(') {
          var col = colIndex(m[1].toUpperCase()) + dc;
          var row = parseInt(m[2], 10) - 1 + dr;
          out += (col < 0 || row < 0) ? '#REF!' : colName(col) + (row + 1);
        } else {
          out += word;
        }
        i = j;
        continue;
      }
      out += c;
      i++;
    }
    return '=' + out;
  }

  // Evaluate one formula string against ctx. Returns { value } or { error }.
  function evaluate(formula, ctx) {
    try {
      var src = formula.charAt(0) === '=' ? formula.slice(1) : formula;
      var ast = parse(tokenize(src));
      var v = evalAst(ast, ctx);
      if (typeof v !== 'number' || !isFinite(v)) return { error: '#VALUE!' };
      return { value: v };
    } catch (e) {
      return { error: e && e.isFormulaError ? e.code : '#VALUE!' };
    }
  }

  // ── Whole-model recalc with cycle detection ──────────────
  function recalc(model) {
    var rows = model.cells.length;
    var results = [];
    var state = [];
    for (var r = 0; r < rows; r++) { results.push([]); state.push([]); }

    function rawAt(c, r) {
      var line = model.cells[r];
      var cell = line && line[c];
      return cell ? cell.raw : '';
    }
    function baseKind(c, r) {
      var line = model.cells[r];
      var cell = line && line[c];
      if (!cell || cell.type === 'empty') return { kind: 'empty' };
      if (cell.type === 'number') return { kind: 'number', value: cell.value };
      return { kind: 'text', value: cell.raw };
    }
    function resolve(c, r) {
      if (r < 0 || r >= rows) return { kind: 'empty' };
      if (results[r][c]) return results[r][c];
      if (state[r] && state[r][c] === 1) {
        return (results[r][c] = { kind: 'error', code: '#CIRC!' });
      }
      var raw = rawAt(c, r);
      if (!isFormula(raw)) return (results[r][c] = baseKind(c, r));
      if (!state[r]) state[r] = [];
      state[r][c] = 1;
      var ctx = { cell: function (cc, rr) { return resolve(cc, rr); } };
      var out = evaluate(raw, ctx);
      state[r][c] = 2;
      return (results[r][c] = out.error
        ? { kind: 'error', code: out.error }
        : { kind: 'number', value: out.value });
    }

    for (var rr = 0; rr < rows; rr++) {
      var line = model.cells[rr];
      var cols = line ? line.length : 0;
      for (var cc = 0; cc < cols; cc++) resolve(cc, rr);
    }
    return results;
  }

  exports.colIndex = colIndex;
  exports.colName = colName;
  exports.isFormula = isFormula;
  exports.tokenize = tokenize;
  exports.parse = parse;
  exports.evaluate = evaluate;
  exports.recalc = recalc;
  exports.shiftFormula = shiftFormula;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocCellsFormula = {}));
