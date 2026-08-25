'use strict';

const path = require('path');

const productionModes = {
  inline: {
    root: '.sdoc-cells-pane',
    probes: {
      grid: '.sdoc-cells-pane .sdoc-cells-grid',
      toolbar: '.sdoc-cells-pane .sdoc-cells-bar',
      tabs: '.sdoc-cells-pane-tabs',
      cell: '.sdoc-cells-pane .sdoc-cells-cell',
    },
  },
  fullscreen: {
    root: '.sdoc-cells-focus',
    probes: {
      grid: '.sdoc-cells-focus .sdoc-cells-grid',
      toolbar: '.sdoc-cells-focus-topbar',
      formulaBar: '.sdoc-cells-focus-bar',
      tabs: '.sdoc-cells-focus-tabs',
    },
  },
};

const sdkModes = {
  inline: {
    root: '.smalldocs-cells-card',
    probes: {
      grid: '.smalldocs-cells-table',
      toolbar: '.smalldocs-feature-tools',
      tabs: '.smalldocs-cells-tabs',
      cell: '.smalldocs-cells-table td',
    },
  },
  fullscreen: {
    root: '.smalldocs-overlay',
    probes: {
      grid: '.smalldocs-cells-table',
      toolbar: '.smalldocs-overlay-topbar',
      formulaBar: '.smalldocs-cells-bar',
      tabs: '.smalldocs-cells-tabs',
    },
  },
};

module.exports = {
  name: 'cells',
  fixture: path.resolve(__dirname, '../fixtures/cells.md'),
  viewport: { width: 1440, height: 900 },
  readySelector: '.sdoc-cells',
  surfaces: {
    production: {
      modes: productionModes,
      scopes: {
        inline: '.sdoc-cells-pane',
        fullscreen: '.sdoc-cells-focus',
      },
    },
    sdk: {
      modes: sdkModes,
      scopes: {
        inline: '.smalldocs-cells-card',
        fullscreen: '.smalldocs-overlay',
      },
    },
  },
  states: [
    {
      name: 'inline-inputs',
      label: 'Inline workbook on the first sheet',
      mode: 'inline',
      contracts: [
        { selector: '[role="tab"]', count: 2, message: 'Both workbook sheets have tabs' },
        { role: 'tab', name: 'Inputs', count: 1, message: 'Inputs tab is present' },
        { role: 'tab', name: 'Summary', count: 1, message: 'Summary tab is present' },
        { selector: '.sdoc-cells-pane .sdoc-cells-grid', count: 2, message: 'Canonical grids are mounted for both sheets' },
        { role: 'button', name: 'Open fullscreen', count: 1, message: 'The canonical fullscreen control is present' },
      ],
    },
    {
      name: 'inline-summary',
      label: 'Inline workbook on the formula sheet',
      mode: 'inline',
      before: [{ action: 'click', within: 'inline', role: 'tab', name: 'Summary' }],
      contracts: [
        { role: 'tab', name: 'Summary', count: 1, message: 'Summary remains the active workbook tab' },
        { selector: '[role="tab"][aria-selected="true"]', text: 'Summary', message: 'Summary tab exposes its active state' },
        { selector: '.sdoc-cells-cell.is-formula', minCount: 3, message: 'Formula results use the canonical formula cells' },
        { selector: '.sdoc-cells-cell.is-number', minCount: 3, message: 'Computed values retain numeric formatting' },
      ],
    },
    {
      name: 'inline-sort-hover',
      label: 'Inline column sort preview on hover',
      mode: 'inline',
      beforeBySurface: {
        production: [{ action: 'hover', within: 'inline', selector: '.sdoc-cells:not([style*="display: none"]) .sdoc-cells-colhead[data-c="1"]' }],
        sdk: [{ action: 'hover', within: 'inline', selector: '.smalldocs-cells-panel:not([hidden]) th:nth-child(3)' }],
      },
      probes: {
        hoveredColumn: '.sdoc-cells-colhead[data-c="1"]:hover',
        sortPreview: '.sdoc-cells-colhead[data-c="1"]:hover .sdoc-cells-sort-next',
      },
      contracts: [
        { selector: '.sdoc-cells-colhead[data-c="1"]:hover', count: 1, hovered: true, message: 'One canonical column header owns the pointer state' },
        { selector: '.sdoc-cells-colhead[data-c="1"]:hover .sdoc-cells-sort-next', count: 1, visible: true, message: 'Hover reveals the next canonical sort action' },
      ],
    },
    {
      name: 'inline-grid-keyboard-focus',
      label: 'Inline grid reached through keyboard navigation',
      mode: 'inline',
      beforeBySurface: {
        production: [{ action: 'focus', via: 'keyboard', within: 'inline', selector: '.sdoc-cells:not([style*="display: none"]) .sdoc-cells-grid' }],
        sdk: [{ action: 'focus', within: 'inline', selector: '.smalldocs-cells-panel:not([hidden]) td[data-address="A1"]' }],
      },
      probes: {
        focusedGrid: '.sdoc-cells-grid:focus-visible',
        activeCell: '.sdoc-cells-cell.is-active',
      },
      contracts: [
        { selector: '.sdoc-cells:not([style*="display: none"]) .sdoc-cells-grid', count: 1, focused: true, focusVisible: true, message: 'The canonical grid is keyboard focusable' },
        { selector: '.sdoc-cells-cell.is-active[data-r="0"][data-c="0"]', count: 1, message: 'Tabbing into a grid selects A1' },
      ],
    },
    {
      name: 'inline-single-selection',
      label: 'Inline selected formula cell',
      mode: 'inline',
      beforeBySurface: {
        production: [{ action: 'click', within: 'inline', selector: '.sdoc-cells:not([style*="display: none"]) .sdoc-cells-cell[data-r="1"][data-c="1"]' }],
        sdk: [{ action: 'focus', within: 'inline', selector: '.smalldocs-cells-panel:not([hidden]) td[data-address="B2"]' }],
      },
      probes: {
        selectedCell: '.sdoc-cells-cell.is-active',
        selectionCopy: '.sdoc-cells-copy-sel',
      },
      contracts: [
        { selector: '.sdoc-cells-cell.is-active', count: 1, message: 'One canonical cell is selected' },
        { selector: '.sdoc-cells:not([style*="display: none"]) .sdoc-cells-copy-sel', count: 1, visible: true, message: 'Selection reveals the canonical copy control' },
        { selector: '.sdoc-cells:not([style*="display: none"]) .sdoc-cells-ref', text: 'B2', message: 'The inline address label identifies the selected cell' },
      ],
    },
    {
      name: 'inline-range-selection',
      label: 'Inline range selection with statistics',
      mode: 'inline',
      beforeBySurface: {
        production: [{
          action: 'drag', within: 'inline',
          selector: '.sdoc-cells:not([style*="display: none"]) .sdoc-cells-cell[data-r="1"][data-c="0"]',
          to: { selector: '.sdoc-cells:not([style*="display: none"]) .sdoc-cells-cell[data-r="3"][data-c="1"]' },
        }],
        sdk: [{ action: 'focus', within: 'inline', selector: '.smalldocs-cells-panel:not([hidden]) td[data-address="B3"]' }],
      },
      probes: {
        range: '.sdoc-cells-cell.in-range',
        stats: '.sdoc-cells-stats.is-open',
      },
      contracts: [
        { selector: '.sdoc-cells-cell.in-range', count: 6, message: 'The dragged rectangle owns six cells' },
        { selector: '.sdoc-cells-stats.is-open', count: 1, visible: true, message: 'A range opens the canonical statistics strip' },
        { selector: '.sdoc-cells:not([style*="display: none"]) .sdoc-cells-ref', text: 'A2:B4', message: 'The address label identifies the selected range' },
      ],
    },
    {
      name: 'workbook-download',
      label: 'Workbook Excel download',
      mode: 'inline',
      beforeBySurface: {
        production: [{ action: 'download', within: 'inline', role: 'button', name: 'Download workbook (.xlsx)' }],
        sdk: [{ action: 'download', role: 'button', name: 'Download spreadsheet XLSX' }],
      },
      contracts: [
        {
          selector: 'body', attribute: 'data-parity-download', value: 'capacity.xlsx',
          message: 'The workbook download uses the canonical filename',
        },
      ],
    },
    {
      name: 'fullscreen-summary',
      label: 'Canonical fullscreen workbook',
      mode: 'fullscreen',
      beforeBySurface: {
        production: [{ action: 'click', within: 'inline', role: 'button', name: 'Open fullscreen' }],
        sdk: [{ action: 'click', role: 'button', name: 'Open spreadsheet in fullscreen' }],
      },
      contracts: [
        { selector: '.sdoc-cells-focus', count: 1, message: 'Canonical fullscreen root is present' },
        { selector: '.sdoc-cells-focus-topbar', count: 1, message: 'Canonical sheet topbar is present' },
        { selector: '.sdoc-cells-focus-tab', count: 2, message: 'Fullscreen retains both workbook tabs' },
        { role: 'button', name: 'Close', count: 1, message: 'Canonical close control is present' },
        { role: 'button', name: 'Show formulas', count: 1, message: 'Formula source toggle is present' },
      ],
    },
    {
      name: 'fullscreen-formulas',
      label: 'Fullscreen formula source view',
      mode: 'fullscreen',
      beforeBySurface: {
        production: [{ action: 'click', within: 'fullscreen', role: 'button', name: 'Show formulas' }],
        sdk: [],
      },
      probes: {
        formulaToggle: '.sdoc-cells-fx-toggle.is-on',
        formulaSource: '.sdoc-cells-cell.is-formula-src',
      },
      contracts: [
        { selector: '.sdoc-cells-fx-toggle.is-on', count: 1, message: 'Formula source view exposes its active control state' },
        { selector: '.sdoc-cells-cell.is-formula-src', minCount: 3, message: 'Formula cells show their source strings' },
      ],
    },
  ],
};
