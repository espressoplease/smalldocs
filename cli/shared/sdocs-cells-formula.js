// sdocs-cells-formula.js - a small spreadsheet formula engine.
//
// Pure, dependency-free, shared between the browser (window.SDocCellsFormula)
// and Node tests (module.exports) via the UMD pattern used by the other cells
// modules. It evaluates a single cell's formula string (anything whose raw
// text starts with "=") against a grid of other cells, and recalc() resolves
// a whole model at once with cycle detection.
//
// Supported core syntax:
//   numbers            12, 3.5, -2, 1e3
//   text / booleans    "text", TRUE, FALSE, concatenation with &
//   operators          + - * / ^ % and comparisons, with parentheses
//   cell references    A1, $A1, A$1, $A$1 and quoted sheet names
//   ranges             A1:B3    (only inside a function's arguments)
//   functions          aggregates, math, logic, text, conditional aggregates,
//                      lookup, date, and common finance functions
//
// Values: a referenced empty cell is 0 in arithmetic. Text, booleans, and
// errors stay typed through calculation and Excel export.
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

  // A formula is safe to export as live Excel code only when every node in
  // its fully parsed tree is part of this computational grammar. Evaluation
  // is not proof: IF is lazy, so an unchosen branch may contain a function
  // that never ran locally but would run later in Excel.
  var SAFE_FUNCTIONS = {
    SUM: 1, PRODUCT: 1, MIN: 1, MAX: 1, AVERAGE: 1, AVG: 1,
    COUNT: 1, COUNTA: 1, ROUND: 1, ROUNDUP: 1, ROUNDDOWN: 1,
    ABS: 1, INT: 1, MOD: 1, POWER: 1, SQRT: 1, SIGN: 1,
    CEILING: 1, FLOOR: 1, IF: 1, IFERROR: 1, IFNA: 1,
    AND: 1, OR: 1, NOT: 1,
    CONCAT: 1, CONCATENATE: 1, LEFT: 1, RIGHT: 1, MID: 1,
    LEN: 1, LOWER: 1, UPPER: 1, TRIM: 1, VALUE: 1,
    COUNTIF: 1, SUMIF: 1, AVERAGEIF: 1,
    INDEX: 1, MATCH: 1, VLOOKUP: 1, XLOOKUP: 1,
    DATE: 1, YEAR: 1, MONTH: 1, DAY: 1, TODAY: 1,
    NPV: 1, PMT: 1,
  };

  function isSafeAst(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.k === 'num' || node.k === 'str' || node.k === 'bool' || node.k === 'ref' || node.k === 'range' || node.k === 'err') return true;
    if (node.k === 'unary' || node.k === 'percent') return isSafeAst(node.a);
    if (node.k === 'bin' || node.k === 'cmp' || node.k === 'concat') return isSafeAst(node.a) && isSafeAst(node.b);
    if (node.k === 'call') {
      if (!SAFE_FUNCTIONS[node.name]) return false;
      for (var i = 0; i < node.args.length; i++) if (!isSafeAst(node.args[i])) return false;
      return true;
    }
    return false;
  }

  // ── Tokenizer ────────────────────────────────────────────
  function tokenize(src) {
    var toks = [];
    var i = 0, n = src.length;
    // Excel stores at most 8,192 characters in one formula. Matching that
    // limit also bounds tokenizer and parser work for untrusted documents.
    if (n > 8192) throw mkErr('#VALUE!');
    function isDigit(c) { return c >= '0' && c <= '9'; }
    function isAlpha(c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'); }
    function isNameStart(c) { return isAlpha(c) || c === '_'; }
    function isNamePart(c) { return isAlpha(c) || isDigit(c) || c === '_' || c === '.'; }
    function readRef(at) {
      var j = at, absCol = false, absRow = false, letters = '', digits = '';
      if (src[j] === '$') { absCol = true; j++; }
      while (j < n && isAlpha(src[j])) letters += src[j++];
      if (!letters) return null;
      if (src[j] === '$') { absRow = true; j++; }
      while (j < n && isDigit(src[j])) digits += src[j++];
      if (!digits) return null;
      var col = colIndex(letters.toUpperCase()), row = parseInt(digits, 10) - 1;
      // Excel's grid ends at XFD1048576. Reject invalid addresses before a
      // range can turn into unbounded work.
      if (col < 0 || col > 16383 || row < 0 || row > 1048575) throw mkErr('#REF!');
      return { end: j, col: col, row: row, absCol: absCol, absRow: absRow };
    }
    while (i < n) {
      var c = src[i];
      if (c === ' ' || c === '\t') { i++; continue; }
      if (c === '"') {
        var str = ''; i++;
        var closed = false;
        while (i < n) {
          if (src[i] === '"') {
            if (src[i + 1] === '"') { str += '"'; i += 2; continue; }
            i++; closed = true; break;
          }
          str += src[i++];
        }
        if (!closed) throw mkErr('#VALUE!');
        toks.push({ t: 'str', v: str });
        continue;
      }
      if (c === "'") {
        var quoted = ''; i++;
        var qclosed = false;
        while (i < n) {
          if (src[i] === "'") {
            if (src[i + 1] === "'") { quoted += "'"; i += 2; continue; }
            i++; qclosed = true; break;
          }
          quoted += src[i++];
        }
        if (!qclosed || src[i] !== '!') throw mkErr('#REF!');
        i++;
        var qref = readRef(i);
        if (!qref) throw mkErr('#REF!');
        toks.push({ t: 'ref', sheet: quoted, col: qref.col, row: qref.row,
          absCol: qref.absCol, absRow: qref.absRow });
        i = qref.end;
        continue;
      }
      if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
        var nm = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
        if (!nm) throw mkErr('#VALUE!');
        toks.push({ t: 'num', v: Number(nm[0]) });
        i += nm[0].length;
        continue;
      }
      if (c === '$') {
        var dollarRef = readRef(i);
        if (!dollarRef) throw mkErr('#REF!');
        toks.push({ t: 'ref', col: dollarRef.col, row: dollarRef.row,
          absCol: dollarRef.absCol, absRow: dollarRef.absRow });
        i = dollarRef.end;
        continue;
      }
      if (isNameStart(c)) {
        var leadingRef = readRef(i);
        if (leadingRef && src[leadingRef.end] !== '!') {
          toks.push({ t: 'ref', col: leadingRef.col, row: leadingRef.row,
            absCol: leadingRef.absCol, absRow: leadingRef.absRow });
          i = leadingRef.end;
          continue;
        }
        var word = '';
        while (i < n && isNamePart(src[i])) word += src[i++];
        // A sheet-qualified reference: Sheet!A1. The word before '!' is the
        // sheet name (any letters/digits run - Sales, Summary, Sheet1, Q1);
        // the part after '!' must be a plain cell ref. Emitted as ONE ref
        // token carrying `sheet`, so the parser's range branch (the next ':'
        // check) keeps the sheet on the qualified endpoint.
        if (src[i] === '!') {
          var sheet = word;
          i++; // consume '!'
          var sheetRef = readRef(i);
          if (!sheetRef) throw mkErr('#REF!');
          toks.push({ t: 'ref', sheet: sheet, col: sheetRef.col, row: sheetRef.row,
            absCol: sheetRef.absCol, absRow: sheetRef.absRow });
          i = sheetRef.end;
          continue;
        }
        var m = /^([A-Za-z]+)([0-9]+)$/.exec(word);
        if (m && src[i] !== '(') {
          var plainCol = colIndex(m[1].toUpperCase()), plainRow = parseInt(m[2], 10) - 1;
          if (plainCol > 16383 || plainRow < 0 || plainRow > 1048575) throw mkErr('#REF!');
          toks.push({ t: 'ref', col: plainCol, row: plainRow, absCol: false, absRow: false });
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
      if ('+-*/^%(),:=&'.indexOf(c) !== -1) { toks.push({ t: 'op', v: c }); i++; continue; }
      // Error literals are tokens, not early throws. The parser must consume
      // the complete formula so export vetting sees every later branch.
      if (c === '#') {
        var em = /^(#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A|#NUM!|#NULL!|#CIRC!)/i.exec(src.slice(i));
        if (!em) throw mkErr('#NAME?');
        toks.push({ t: 'err', v: em[1].toUpperCase() });
        i += em[1].length;
        continue;
      }
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
      var left = parseConcat();
      var t = peek();
      if (t && t.t === 'op' && ['=', '<>', '<', '<=', '>', '>='].indexOf(t.v) !== -1) {
        next();
        return { k: 'cmp', op: t.v, a: left, b: parseConcat() };
      }
      return left;
    }
    function parseConcat() {
      var node = parseAdd();
      while (peek() && peek().t === 'op' && peek().v === '&') {
        next(); node = { k: 'concat', a: node, b: parseAdd() };
      }
      return node;
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
      if (t.t === 'str') return { k: 'str', v: t.v };
      if (t.t === 'err') return { k: 'err', code: t.v };
      if (t.t === 'ref') {
        if (peek() && peek().t === 'op' && peek().v === ':') {
          next(); var end = next();
          if (!end || end.t !== 'ref') throw mkErr('#REF!');
          // A range stays within one sheet. A qualified start (Sales!A1:B3)
          // applies its sheet to both ends; a range that names two different
          // sheets (Sheet1!A1:Sheet2!B2) has no coherent rectangle -> #REF!.
          var startKey = (t.sheet || '').toLowerCase();
          var endKey = (end.sheet || '').toLowerCase();
          if (end.sheet != null && endKey !== startKey) throw mkErr('#REF!');
          return { k: 'range', sheet: t.sheet, c0: t.col, r0: t.row, c1: end.col, r1: end.row };
        }
        return { k: 'ref', col: t.col, row: t.row, sheet: t.sheet };
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
        if (t.v === 'TRUE') return { k: 'bool', v: true };
        if (t.v === 'FALSE') return { k: 'bool', v: false };
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
      case 'str': return node.v;
      case 'bool': return node.v;
      case 'err': throw mkErr(node.code);
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
      case 'concat': return toText(evalAst(node.a, ctx)) + toText(evalAst(node.b, ctx));
      case 'cmp': {
        var x = evalAst(node.a, ctx), y = evalAst(node.b, ctx), r;
        if (typeof x === 'string' && typeof y === 'string') {
          x = x.toLowerCase(); y = y.toLowerCase();
        } else if (typeof x !== typeof y) {
          x = num(x); y = num(y);
        }
        switch (node.op) {
          case '=': r = x === y; break;
          case '<>': r = x !== y; break;
          case '<': r = x < y; break;
          case '<=': r = x <= y; break;
          case '>': r = x > y; break;
          case '>=': r = x >= y; break;
          default: throw mkErr('#VALUE!');
        }
        return r;
      }
      case 'ref': return refValue(ctx.cell(node.col, node.row, node.sheet));
      case 'range': throw mkErr('#VALUE!');
      case 'call': return callFn(node, ctx);
    }
    throw mkErr('#VALUE!');
  }

  function refValue(cell) {
    if (!cell || cell.kind === 'empty') return 0;
    if (cell.kind === 'number') return cell.value;
    if (cell.kind === 'text') return cell.value;
    if (cell.kind === 'boolean') return cell.value;
    if (cell.kind === 'error') throw mkErr(cell.code || '#VALUE!');
    throw mkErr('#VALUE!');
  }

  function num(v) {
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
    if (typeof v !== 'number' || !isFinite(v)) throw mkErr('#VALUE!');
    return v;
  }

  function toText(v) {
    if (v == null) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return String(v);
  }

  function truthy(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v !== '' && v.toUpperCase() !== 'FALSE';
    return false;
  }

  function argCells(arg, ctx) {
    if (arg.k === 'range') {
      if (ctx.range) return ctx.range(arg.c0, arg.r0, arg.c1, arg.r1, arg.sheet);
      var out = [];
      var r0 = Math.min(arg.r0, arg.r1), r1 = Math.max(arg.r0, arg.r1);
      var c0 = Math.min(arg.c0, arg.c1), c1 = Math.max(arg.c0, arg.c1);
      for (var r = r0; r <= r1; r++) {
        for (var c = c0; c <= c1; c++) out.push(ctx.cell(c, r, arg.sheet));
      }
      return out;
    }
    var value = evalAst(arg, ctx);
    if (typeof value === 'number') return [{ kind: 'number', value: value }];
    if (typeof value === 'boolean') return [{ kind: 'boolean', value: value }];
    return [{ kind: 'text', value: toText(value) }];
  }

  function cellValue(cell) {
    if (!cell || cell.kind === 'empty') return '';
    if (cell.kind === 'error') throw mkErr(cell.code || '#VALUE!');
    return cell.value;
  }

  function argMatrix(arg, ctx) {
    if (arg.k !== 'range') return [[cellValue(argCells(arg, ctx)[0])]];
    if (ctx.rangeMatrix) return ctx.rangeMatrix(arg.c0, arg.r0, arg.c1, arg.r1, arg.sheet);
    var rows = [], r0 = Math.min(arg.r0, arg.r1), r1 = Math.max(arg.r0, arg.r1);
    var c0 = Math.min(arg.c0, arg.c1), c1 = Math.max(arg.c0, arg.c1);
    for (var r = r0; r <= r1; r++) {
      var row = [];
      for (var c = c0; c <= c1; c++) row.push(cellValue(ctx.cell(c, r, arg.sheet)));
      rows.push(row);
    }
    return rows;
  }

  function flattenMatrix(matrix) {
    var out = [];
    for (var r = 0; r < matrix.length; r++) {
      for (var c = 0; c < matrix[r].length; c++) out.push(matrix[r][c]);
    }
    return out;
  }

  function criterionMatches(value, criterion) {
    if (typeof criterion === 'number' || typeof criterion === 'boolean') return value === criterion;
    var s = String(criterion), m = /^(<=|>=|<>|=|<|>)(.*)$/.exec(s);
    var op = m ? m[1] : '=', rhs = m ? m[2] : s;
    var left = value, right = rhs;
    if (rhs.trim() !== '' && isFinite(Number(rhs))) { left = Number(value); right = Number(rhs); }
    if (op === '=' && typeof right === 'string' && /[?*]/.test(right)) {
      var pattern = right.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\?/g, '.').replace(/\*/g, '.*');
      return new RegExp('^' + pattern + '$', 'i').test(String(value));
    }
    if (typeof left === 'string' && typeof right === 'string') {
      left = left.toLowerCase(); right = right.toLowerCase();
    }
    if (op === '=') return left === right;
    if (op === '<>') return left !== right;
    if (op === '<') return left < right;
    if (op === '<=') return left <= right;
    if (op === '>') return left > right;
    return left >= right;
  }

  function valuesEqual(a, b) {
    if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
    return a === b;
  }

  function excelRound(value, digits, mode) {
    var factor = Math.pow(10, digits), scaled = (Math.abs(value) + Number.EPSILON) * factor;
    var rounded;
    if (mode === 'up') rounded = Math.ceil(scaled - Number.EPSILON);
    else if (mode === 'down') rounded = Math.floor(scaled + Number.EPSILON);
    else rounded = Math.round(scaled + Number.EPSILON);
    return (value < 0 ? -1 : 1) * rounded / factor;
  }

  var DAY_MS = 86400000;
  var EXCEL_EPOCH = Date.UTC(1899, 11, 31);
  function dateSerial(year, month, day) {
    var utc = Date.UTC(year, month - 1, day);
    var serial = (utc - EXCEL_EPOCH) / DAY_MS;
    if (utc >= Date.UTC(1900, 2, 1)) serial++;
    return serial;
  }
  function serialDate(serial) {
    var n = num(serial);
    if (n >= 60) n--;
    return new Date(EXCEL_EPOCH + n * DAY_MS);
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
            if (cl.kind === 'error') { errored = cl.code || '#VALUE!'; counted++; }
            else if (cl.kind === 'number') { nums.push(cl.value); counted++; }
            else if (cl.kind === 'text' || cl.kind === 'boolean') { counted++; }
          }
        }
        if (errored && name !== 'COUNTA' && name !== 'COUNT') throw mkErr(errored);
        if (name === 'COUNT') return nums.length;
        if (name === 'COUNTA') return counted;
        if (!nums.length) {
          if (name === 'SUM') return 0;
          if (name === 'PRODUCT') return 0;
          if (name === 'MIN' || name === 'MAX') return 0;
          throw mkErr('#DIV/0!');
        }
        if (name === 'SUM') return nums.reduce(function (a, b) { return a + b; }, 0);
        if (name === 'PRODUCT') return nums.reduce(function (a, b) { return a * b; }, 1);
        if (name === 'MIN') return Math.min.apply(null, nums);
        if (name === 'MAX') return Math.max.apply(null, nums);
        return nums.reduce(function (a, b) { return a + b; }, 0) / nums.length; // AVERAGE
      }
      case 'ROUND': case 'ROUNDUP': case 'ROUNDDOWN': {
        if (args.length < 1) throw mkErr('#VALUE!');
        var x = num(evalAst(args[0], ctx));
        var d = args.length > 1 ? num(evalAst(args[1], ctx)) : 0;
        return excelRound(x, d, name === 'ROUNDUP' ? 'up' : (name === 'ROUNDDOWN' ? 'down' : 'round'));
      }
      case 'ABS':
        if (args.length !== 1) throw mkErr('#VALUE!');
        return Math.abs(num(evalAst(args[0], ctx)));
      case 'INT': return Math.floor(num(evalAst(args[0], ctx)));
      case 'MOD': {
        var modDivisor = num(evalAst(args[1], ctx));
        if (modDivisor === 0) throw mkErr('#DIV/0!');
        return num(evalAst(args[0], ctx)) - modDivisor * Math.floor(num(evalAst(args[0], ctx)) / modDivisor);
      }
      case 'POWER': return Math.pow(num(evalAst(args[0], ctx)), num(evalAst(args[1], ctx)));
      case 'SQRT': {
        var root = num(evalAst(args[0], ctx));
        if (root < 0) throw mkErr('#NUM!');
        return Math.sqrt(root);
      }
      case 'SIGN': { var sign = num(evalAst(args[0], ctx)); return sign === 0 ? 0 : (sign < 0 ? -1 : 1); }
      case 'CEILING': case 'FLOOR': {
        var cv = num(evalAst(args[0], ctx));
        var significance = args.length > 1 ? Math.abs(num(evalAst(args[1], ctx))) : 1;
        if (!significance) return 0;
        return (name === 'CEILING' ? Math.ceil(cv / significance) : Math.floor(cv / significance)) * significance;
      }
      case 'IF': {
        if (args.length < 2) throw mkErr('#VALUE!');
        var cond = truthy(evalAst(args[0], ctx));
        return cond ? evalAst(args[1], ctx)
          : (args.length > 2 ? evalAst(args[2], ctx) : 0);
      }
      case 'IFERROR': case 'IFNA': {
        if (args.length < 2) throw mkErr('#VALUE!');
        try { return evalAst(args[0], ctx); }
        catch (e) {
          if (name === 'IFNA' && (!e || e.code !== '#N/A')) throw e;
          return evalAst(args[1], ctx);
        }
      }
      case 'AND': case 'OR': {
        var bool = name === 'AND';
        var boolError = null;
        for (var ai = 0; ai < args.length; ai++) {
          try {
            var av = truthy(evalAst(args[ai], ctx));
            if (name === 'AND') bool = bool && av;
            else bool = bool || av;
          } catch (e) {
            if (!boolError) boolError = e;
          }
        }
        if (boolError) throw boolError;
        return bool;
      }
      case 'NOT': return !truthy(evalAst(args[0], ctx));
      case 'CONCAT': case 'CONCATENATE': {
        var joined = '';
        for (var ci = 0; ci < args.length; ci++) {
          var concatCells = argCells(args[ci], ctx);
          for (var cj = 0; cj < concatCells.length; cj++) joined += toText(cellValue(concatCells[cj]));
        }
        return joined;
      }
      case 'LEFT': {
        var leftText = toText(evalAst(args[0], ctx));
        var leftCount = args.length > 1 ? num(evalAst(args[1], ctx)) : 1;
        if (leftCount < 0) throw mkErr('#VALUE!');
        return leftText.slice(0, leftCount);
      }
      case 'RIGHT': {
        var rightText = toText(evalAst(args[0], ctx));
        var rightCount = args.length > 1 ? num(evalAst(args[1], ctx)) : 1;
        if (rightCount < 0) throw mkErr('#VALUE!');
        return rightText.slice(Math.max(0, rightText.length - rightCount));
      }
      case 'MID': {
        var midStart = num(evalAst(args[1], ctx)), midCount = num(evalAst(args[2], ctx));
        if (midStart < 1 || midCount < 0) throw mkErr('#VALUE!');
        return toText(evalAst(args[0], ctx)).substr(midStart - 1, midCount);
      }
      case 'LEN': return toText(evalAst(args[0], ctx)).length;
      case 'LOWER': return toText(evalAst(args[0], ctx)).toLowerCase();
      case 'UPPER': return toText(evalAst(args[0], ctx)).toUpperCase();
      case 'TRIM': return toText(evalAst(args[0], ctx)).trim().replace(/\s+/g, ' ');
      case 'VALUE': return num(evalAst(args[0], ctx));
      case 'COUNTIF': case 'SUMIF': case 'AVERAGEIF': {
        if (args.length < 2) throw mkErr('#VALUE!');
        var testValues = flattenMatrix(argMatrix(args[0], ctx));
        var criterion = evalAst(args[1], ctx);
        var sumValues = args.length > 2 ? flattenMatrix(argMatrix(args[2], ctx)) : testValues;
        var matched = 0, numericMatched = 0, total = 0;
        for (var ti = 0; ti < testValues.length; ti++) {
          if (!criterionMatches(testValues[ti], criterion)) continue;
          matched++;
          if (ti < sumValues.length && typeof sumValues[ti] === 'number') {
            total += sumValues[ti]; numericMatched++;
          }
        }
        if (name === 'COUNTIF') return matched;
        if (name === 'AVERAGEIF') {
          if (!numericMatched) throw mkErr('#DIV/0!');
          return total / numericMatched;
        }
        return total;
      }
      case 'INDEX': {
        var indexMatrix = argMatrix(args[0], ctx);
        var indexRow = num(evalAst(args[1], ctx)) - 1;
        var indexCol = args.length > 2 ? num(evalAst(args[2], ctx)) - 1 : 0;
        if (!indexMatrix[indexRow] || indexMatrix[indexRow][indexCol] === undefined) throw mkErr('#REF!');
        return indexMatrix[indexRow][indexCol];
      }
      case 'MATCH': {
        var needle = evalAst(args[0], ctx), matchValues = flattenMatrix(argMatrix(args[1], ctx));
        var matchMode = args.length > 2 ? num(evalAst(args[2], ctx)) : 1;
        var found = -1;
        for (var mi = 0; mi < matchValues.length; mi++) {
          if (valuesEqual(matchValues[mi], needle)) { found = mi; break; }
          if (matchMode === 1 && matchValues[mi] <= needle) found = mi;
          if (matchMode === -1 && found < 0 && matchValues[mi] >= needle) found = mi;
        }
        if (found < 0) throw mkErr('#N/A');
        return found + 1;
      }
      case 'VLOOKUP': {
        var lookup = evalAst(args[0], ctx), table = argMatrix(args[1], ctx);
        var returnCol = num(evalAst(args[2], ctx)) - 1;
        var approximate = args.length < 4 || truthy(evalAst(args[3], ctx));
        var candidate = -1;
        for (var vr = 0; vr < table.length; vr++) {
          if (valuesEqual(table[vr][0], lookup)) { candidate = vr; break; }
          if (approximate && table[vr][0] <= lookup) candidate = vr;
        }
        if (candidate < 0 || !table[candidate] || table[candidate][returnCol] === undefined) throw mkErr('#N/A');
        return table[candidate][returnCol];
      }
      case 'XLOOKUP': {
        var xneedle = evalAst(args[0], ctx);
        var search = flattenMatrix(argMatrix(args[1], ctx));
        var returns = flattenMatrix(argMatrix(args[2], ctx));
        for (var xi = 0; xi < search.length; xi++) if (valuesEqual(search[xi], xneedle)) return returns[xi];
        if (args.length > 3) return evalAst(args[3], ctx);
        throw mkErr('#N/A');
      }
      case 'DATE': return dateSerial(num(evalAst(args[0], ctx)), num(evalAst(args[1], ctx)), num(evalAst(args[2], ctx)));
      case 'YEAR': return serialDate(evalAst(args[0], ctx)).getUTCFullYear();
      case 'MONTH': return serialDate(evalAst(args[0], ctx)).getUTCMonth() + 1;
      case 'DAY': return serialDate(evalAst(args[0], ctx)).getUTCDate();
      case 'TODAY': {
        var now = new Date();
        return dateSerial(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
      }
      case 'NPV': {
        var rate = num(evalAst(args[0], ctx)), cash = [];
        for (var ni = 1; ni < args.length; ni++) {
          var nc = argCells(args[ni], ctx);
          for (var nj = 0; nj < nc.length; nj++) if (nc[nj].kind === 'number') cash.push(nc[nj].value);
        }
        return cash.reduce(function (sum, value, index) { return sum + value / Math.pow(1 + rate, index + 1); }, 0);
      }
      case 'PMT': {
        var pr = num(evalAst(args[0], ctx)), periods = num(evalAst(args[1], ctx));
        var present = num(evalAst(args[2], ctx));
        var future = args.length > 3 ? num(evalAst(args[3], ctx)) : 0;
        var timing = args.length > 4 ? num(evalAst(args[4], ctx)) : 0;
        if (pr === 0) return -(present + future) / periods;
        var pow = Math.pow(1 + pr, periods);
        return -(pr * (future + pow * present)) / ((1 + pr * timing) * (pow - 1));
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
    function isNameStart(ch) { return isAlpha(ch) || ch === '_'; }
    function isNamePart(ch) { return isAlpha(ch) || isDigit(ch) || ch === '_' || ch === '.'; }
    function readRef(at) {
      var j = at, absCol = false, absRow = false, letters = '', digits = '';
      if (src[j] === '$') { absCol = true; j++; }
      while (j < n && isAlpha(src[j])) letters += src[j++];
      if (!letters) return null;
      if (src[j] === '$') { absRow = true; j++; }
      while (j < n && isDigit(src[j])) digits += src[j++];
      if (!digits) return null;
      return { end: j, letters: letters, row: parseInt(digits, 10) - 1,
        col: colIndex(letters.toUpperCase()), absCol: absCol, absRow: absRow };
    }
    while (i < n) {
      var c = src[i];
      if (c === '"') {
        var ds = i++;
        while (i < n) {
          if (src[i] === '"') {
            i++;
            if (src[i] === '"') { i++; continue; }
            break;
          }
          i++;
        }
        out += src.slice(ds, i);
        continue;
      }
      if (c === "'") {
        var qs = i++;
        while (i < n) {
          if (src[i] === "'") {
            i++;
            if (src[i] === "'") { i++; continue; }
            break;
          }
          i++;
        }
        if (src[i] === '!') i++;
        out += src.slice(qs, i);
        continue;
      }
      if (isNameStart(c)) {
        var nameEnd = i + 1;
        while (nameEnd < n && isNamePart(src[nameEnd])) nameEnd++;
        if (src[nameEnd] === '!') {
          out += src.slice(i, nameEnd + 1);
          i = nameEnd + 1;
          continue;
        }
      }
      var ref = (c === '$' || isAlpha(c)) ? readRef(i) : null;
      if (ref && src[ref.end] !== '(') {
        var col = ref.col + (ref.absCol ? 0 : dc);
        var row = ref.row + (ref.absRow ? 0 : dr);
        if (col < 0 || row < 0 || col > 16383 || row > 1048575) out += '#REF!';
        else out += (ref.absCol ? '$' : '') + colName(col) + (ref.absRow ? '$' : '') + (row + 1);
        i = ref.end;
        continue;
      }
      out += c;
      i++;
    }
    return '=' + out;
  }

  // Evaluate one formula string against ctx. Returns { value } or { error }.
  function evaluate(formula, ctx) {
    var ast;
    try {
      var src = formula.charAt(0) === '=' ? formula.slice(1) : formula;
      ast = parse(tokenize(src));
      var safe = isSafeAst(ast);
      var v = evalAst(ast, ctx);
      if (typeof v === 'number' && !isFinite(v)) return { error: '#NUM!', safe: safe };
      if (typeof v !== 'number' && typeof v !== 'string' && typeof v !== 'boolean') {
        return { error: '#VALUE!', safe: safe };
      }
      return { value: v, kind: typeof v === 'number' ? 'number'
        : (typeof v === 'boolean' ? 'boolean' : 'text'), safe: safe };
    } catch (e) {
      return { error: e && e.isFormulaError ? e.code : '#VALUE!', safe: ast ? isSafeAst(ast) : false };
    }
  }

  // ── Whole-workbook recalc with cross-sheet cycle detection ──
  //
  // recalcWorkbook resolves a list of sheets at once so a formula in one
  // sheet can read a cell in another via a qualified reference (Sheet!A1).
  // One shared memo (`results`/`state`) is keyed by (sheetIndex, r, c): the
  // in-progress guard that catches A1->A1 within a sheet then also catches a
  // cycle that spans sheets. The cycle detector never learns about sheets,
  // it just gets a wider address space.
  //
  //   sheets: [{ name, model }, ...]   name optional; '' for an anonymous
  //                                    single sheet (see recalc below).
  //
  // Returns one results grid per sheet, same shape and order as the input:
  //   [ results0, results1, ... ]   resultsN[r][c] = {kind, value/code}
  //
  // Sheet names resolve to a stable index up front (case-insensitive; on a
  // name collision the FIRST sheet with that name wins). A qualified ref to a
  // name that does not exist is reported as #REF! by the ctx and never enters
  // resolve - so a missing sheet can neither hang nor bypass the cycle guard.
  function recalcWorkbook(sheets) {
    var n = sheets.length;
    var results = [];   // results[s][r][c]
    var state = [];     // state[s][r][c]: 1 = in progress, 2 = done
    var nameToIndex = {};
    for (var s = 0; s < n; s++) {
      var sres = [], sstate = [];
      var model0 = sheets[s].model;
      var srows = model0 && model0.cells ? model0.cells.length : 0;
      for (var r0 = 0; r0 < srows; r0++) { sres.push([]); sstate.push([]); }
      results.push(sres); state.push(sstate);
      var nm = sheets[s].name;
      if (nm) {
        var nkey = String(nm).toLowerCase();
        if (!(nkey in nameToIndex)) nameToIndex[nkey] = s; // first wins
      }
    }

    function rowsOf(si) {
      var model = sheets[si].model;
      return model && model.cells ? model.cells.length : 0;
    }
    function rawAt(si, c, r) {
      var line = sheets[si].model.cells[r];
      var cell = line && line[c];
      return cell ? cell.raw : '';
    }
    function baseKind(si, c, r) {
      var line = sheets[si].model.cells[r];
      var cell = line && line[c];
      if (!cell || cell.type === 'empty') return { kind: 'empty' };
      if (cell.type === 'number') return { kind: 'number', value: cell.value };
      return { kind: 'text', value: cell.raw };
    }

    // Resolve cell (c, r) within sheet index `si`. Bounds are checked against
    // THIS sheet's row count (rowsOf(si)), not any caller's - a cross-sheet
    // ref to a short sheet reads empty, not the wrong row.
    function resolve(si, c, r) {
      if (r < 0 || r >= rowsOf(si)) return { kind: 'empty' };
      var rRes = results[si][r], rState = state[si][r];
      if (rRes[c]) return rRes[c];
      if (rState && rState[c] === 1) {
        return (rRes[c] = { kind: 'error', code: '#CIRC!' });
      }
      var raw = rawAt(si, c, r);
      if (!isFormula(raw)) return (rRes[c] = baseKind(si, c, r));
      rState[c] = 1;
      var dependenciesSafe = true;
      function trackDependency(cell) {
        if (cell && cell.safe === false) dependenciesSafe = false;
        return cell;
      }
      // ctx.cell(col, row, sheet): an undefined `sheet` means the formula's
      // own sheet (si); a named sheet is looked up in nameToIndex; a name with
      // no matching sheet is #REF! and never enters resolve.
      var ctx = {
        cell: function (cc, rr, sheetName) {
          if (sheetName == null) return trackDependency(resolve(si, cc, rr));
          var key = String(sheetName).toLowerCase();
          if (!(key in nameToIndex)) return { kind: 'error', code: '#REF!' };
          return trackDependency(resolve(nameToIndex[key], cc, rr));
        },
        // Aggregate functions only need populated cells. Clamp a range to the
        // target model before walking it, so a huge sparse reference does not
        // expand billions of empty coordinates in the browser.
        range: function (c0, r0, c1, r1, sheetName) {
          var target = si;
          if (sheetName != null) {
            var key = String(sheetName).toLowerCase();
            if (!(key in nameToIndex)) throw mkErr('#REF!');
            target = nameToIndex[key];
          }
          var model = sheets[target].model;
          var maxRows = model && model.cells ? model.cells.length : 0;
          var maxCols = model && model.cols ? model.cols : 0;
          if (!maxCols && model && model.cells) {
            for (var mr = 0; mr < model.cells.length; mr++) {
              maxCols = Math.max(maxCols, (model.cells[mr] || []).length);
            }
          }
          var ra = Math.max(0, Math.min(r0, r1));
          var rb = Math.min(maxRows - 1, Math.max(r0, r1));
          var ca = Math.max(0, Math.min(c0, c1));
          var cb = Math.min(maxCols - 1, Math.max(c0, c1));
          var out = [];
          for (var r3 = ra; r3 <= rb; r3++) {
            for (var c3 = ca; c3 <= cb; c3++) out.push(trackDependency(resolve(target, c3, r3)));
          }
          return out;
        },
        rangeMatrix: function (c0, r0, c1, r1, sheetName) {
          var target = si;
          if (sheetName != null) {
            var key = String(sheetName).toLowerCase();
            if (!(key in nameToIndex)) throw mkErr('#REF!');
            target = nameToIndex[key];
          }
          var ra = Math.max(0, Math.min(r0, r1));
          var rb = Math.max(r0, r1);
          var ca = Math.max(0, Math.min(c0, c1));
          var cb = Math.max(c0, c1);
          if ((rb - ra + 1) * (cb - ca + 1) > 100000) throw mkErr('#VALUE!');
          var matrix = [];
          for (var r4 = ra; r4 <= rb; r4++) {
            var matrixRow = [];
            for (var c4 = ca; c4 <= cb; c4++) matrixRow.push(trackDependency(resolve(target, c4, r4)));
            matrix.push(matrixRow);
          }
          return matrix.map(function (row) { return row.map(cellValue); });
        },
      };
      var out = evaluate(raw, ctx);
      out.safe = out.safe === true && dependenciesSafe;
      rState[c] = 2;
      if (out.error) return (rRes[c] = { kind: 'error', code: out.error, safe: out.safe });
      var kind = out.kind || (typeof out.value === 'number' ? 'number'
        : (typeof out.value === 'boolean' ? 'boolean' : 'text'));
      return (rRes[c] = { kind: kind, value: out.value, safe: out.safe });
    }

    for (var si2 = 0; si2 < n; si2++) {
      var rows = rowsOf(si2);
      for (var rr = 0; rr < rows; rr++) {
        var line = sheets[si2].model.cells[rr];
        var cols = line ? line.length : 0;
        for (var cc = 0; cc < cols; cc++) resolve(si2, cc, rr);
      }
    }
    return results;
  }

  // Whole-model recalc for a single sheet. A thin adapter over
  // recalcWorkbook so every existing caller (renderer, editor, xlsx exporter,
  // tests) keeps the same `recalc(model) -> results[r][c]` contract. With one
  // anonymous sheet there are no qualified references to resolve, so the
  // output is identical to the pre-workbook recalc.
  function recalc(model) {
    return recalcWorkbook([{ name: '', model: model }])[0];
  }

  exports.colIndex = colIndex;
  exports.colName = colName;
  exports.isFormula = isFormula;
  exports.tokenize = tokenize;
  exports.parse = parse;
  exports.isSafeAst = isSafeAst;
  exports.supportedFunctions = Object.keys(SAFE_FUNCTIONS);
  exports.evaluate = evaluate;
  exports.recalc = recalc;
  exports.recalcWorkbook = recalcWorkbook;
  exports.shiftFormula = shiftFormula;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocCellsFormula = {}));
