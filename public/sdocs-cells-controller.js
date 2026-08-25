// sdocs-cells-controller.js - pure workbook planning and instance state.
//
// This module owns no DOM. It receives the cells model and formula APIs at
// construction time, plans parsed blocks into isolated workbooks, and keeps
// the resulting registry inside one controller instance. Production and the
// browser SDK can therefore share workbook rules without sharing application
// globals, listeners, observers, overlays, or mutable document state.
(function (exports) {
  'use strict';

  var DEFAULT_LIMITS = {
    sourceCharacters: 256 * 1024,
    blocks: 50,
  };

  function requireApi(api, method, label) {
    if (!api || typeof api[method] !== 'function') {
      throw new Error(label + ' must provide ' + method + '()');
    }
  }

  function normaliseLimits(limits) {
    limits = limits || {};
    return {
      sourceCharacters: limits.sourceCharacters == null
        ? DEFAULT_LIMITS.sourceCharacters : Number(limits.sourceCharacters),
      blocks: limits.blocks == null ? DEFAULT_LIMITS.blocks : Number(limits.blocks),
    };
  }

  function workbookSheets(entries, effectiveModelFor) {
    return entries.map(function (entry) {
      var model = effectiveModelFor ? effectiveModelFor(entry) : null;
      return { name: entry.name, model: model || entry.model };
    });
  }

  // Convert source blocks into workbook groups without reading the DOM. Each
  // input is { source, context?, skip? }. Context is opaque data returned on
  // the corresponding item so an adapter may associate a plan with its view.
  function planWorkbooks(inputs, cells, formula, limits) {
    requireApi(cells, 'parseCells', 'cells');
    requireApi(formula, 'recalcWorkbook', 'formula');
    limits = normaliseLimits(limits);
    inputs = Array.isArray(inputs) ? inputs : [];

    var selected = inputs.slice(0, Math.max(0, limits.blocks));
    var items = [];
    var order = [];
    var byWorkbook = Object.create(null);

    for (var i = 0; i < selected.length; i++) {
      var input = selected[i] || {};
      var source = String(input.source == null ? '' : input.source);
      var item = { index: i, source: source, context: input.context };
      items.push(item);

      if (input.skip) {
        item.kind = 'skipped';
        continue;
      }
      if (source.length > limits.sourceCharacters) {
        item.kind = 'error';
        item.message = 'Cells source exceeds ' + (limits.sourceCharacters / 1024) + ' KB cap';
        continue;
      }

      var model;
      try {
        model = cells.parseCells(source);
      } catch (error) {
        item.kind = 'error';
        item.message = (error && error.message) || 'Parse error';
        continue;
      }
      item.model = model;
      if (model.unresolved) {
        item.kind = 'reference';
        item.reference = model.unresolved;
        continue;
      }
      if (model.error) {
        item.kind = 'error';
        item.message = model.error;
        continue;
      }
      if (model.empty) {
        item.kind = 'error';
        item.message = 'Empty cells block';
        continue;
      }

      item.kind = 'sheet';
      item.workbook = model.workbook != null ? String(model.workbook) : '';
      if (!byWorkbook[item.workbook]) {
        byWorkbook[item.workbook] = [];
        order.push(item.workbook);
      }
      byWorkbook[item.workbook].push(item);
    }

    var entries = [];
    var groups = [];
    for (var o = 0; o < order.length; o++) {
      var id = order[o];
      var groupEntries = byWorkbook[id];
      var autoIndex = 0;
      var seenNames = Object.create(null);
      for (var e = 0; e < groupEntries.length; e++) {
        var entry = groupEntries[e];
        var explicit = entry.model.name && String(entry.model.name).trim();
        entry.name = explicit ? String(entry.model.name).trim() : 'Sheet' + (++autoIndex);
        var key = entry.name.toLowerCase();
        entry.duplicate = !!seenNames[key];
        seenNames[key] = true;
        entries.push(entry);
      }
      groups.push({
        id: id,
        entries: groupEntries,
        fx: formula.recalcWorkbook(workbookSheets(groupEntries)),
      });
    }

    return {
      items: items,
      entries: entries,
      groups: groups,
      processedCount: selected.length,
      omittedCount: Math.max(0, inputs.length - selected.length),
      limits: limits,
    };
  }

  function createController(options) {
    options = options || {};
    var cells = options.cells;
    var formula = options.formula;
    requireApi(cells, 'parseCells', 'cells');
    requireApi(formula, 'recalcWorkbook', 'formula');
    var limits = normaliseLimits(options.limits);
    var current = planWorkbooks([], cells, formula, limits);
    var destroyed = false;

    function ensureActive() {
      if (destroyed) throw new Error('Cells controller has been destroyed');
    }

    function find(model) {
      for (var i = 0; i < current.entries.length; i++) {
        if (current.entries[i].model === model) return current.entries[i];
      }
      return null;
    }

    function entriesFor(entry) {
      return current.entries.filter(function (candidate) {
        return candidate.workbook === entry.workbook;
      });
    }

    function plan(inputs) {
      ensureActive();
      current = planWorkbooks(inputs, cells, formula, limits);
      return current;
    }

    function recalculateFor(model, effectiveModelFor) {
      ensureActive();
      var entry = find(model);
      if (!entry) return null;
      var entries = entriesFor(entry);
      var index = entries.indexOf(entry);
      return formula.recalcWorkbook(workbookSheets(entries, effectiveModelFor))[index] || null;
    }

    function groupFor(model, effectiveModelFor) {
      ensureActive();
      var entry = find(model);
      if (!entry) return null;
      return { id: entry.workbook, sheets: workbookSheets(entriesFor(entry), effectiveModelFor) };
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      current = { items: [], entries: [], groups: [], processedCount: 0, omittedCount: 0, limits: limits };
    }

    return {
      plan: plan,
      recalculateFor: recalculateFor,
      groupFor: groupFor,
      getPlan: function () { return current; },
      destroy: destroy,
    };
  }

  exports.DEFAULT_LIMITS = DEFAULT_LIMITS;
  exports.planWorkbooks = planWorkbooks;
  exports.createController = createController;
})(typeof module !== 'undefined' && module.exports
  ? module.exports : (window.SDocCellsController = {}));
