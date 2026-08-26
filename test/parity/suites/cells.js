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

const openSummaryFullscreen = [
  { action: 'click', within: 'inline', role: 'tab', name: 'Summary' },
  { action: 'waitFor', within: 'inline', selector: '.sdoc-cells[data-cells-name="Summary"]' },
  { action: 'click', within: 'inline', selector: '.sdoc-cells[data-cells-name="Summary"] .sdoc-cells-expand' },
  { action: 'waitFor', within: 'fullscreen', selector: '.sdoc-cells-grid' },
];

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
        inline: '.sdoc-cells-pane',
        fullscreen: '.sdoc-cells-focus',
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
        sdk: [{ action: 'hover', within: 'inline', selector: '.sdoc-cells:not([style*="display: none"]) .sdoc-cells-colhead[data-c="1"]' }],
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
        sdk: [{ action: 'focus', via: 'keyboard', within: 'inline', selector: '.sdoc-cells:not([style*="display: none"]) .sdoc-cells-grid' }],
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
        sdk: [{ action: 'click', within: 'inline', selector: '.sdoc-cells:not([style*="display: none"]) .sdoc-cells-cell[data-r="1"][data-c="1"]' }],
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
        sdk: [{
          action: 'drag', within: 'inline',
          selector: '.sdoc-cells:not([style*="display: none"]) .sdoc-cells-cell[data-r="1"][data-c="0"]',
          to: { selector: '.sdoc-cells:not([style*="display: none"]) .sdoc-cells-cell[data-r="3"][data-c="1"]' },
        }],
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
        sdk: [{ action: 'download', within: 'inline', role: 'button', name: 'Download workbook (.xlsx)' }],
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
      fresh: true,
      before: openSummaryFullscreen,
      contracts: [
        { selector: '.sdoc-cells-focus', count: 1, message: 'Canonical fullscreen root is present' },
        { selector: '.sdoc-cells-focus-topbar', count: 1, message: 'Canonical sheet topbar is present' },
        { selector: '.sdoc-cells-focus-tab', count: 2, message: 'Fullscreen retains both workbook tabs' },
        { selector: '.sdoc-cells-focus-tab[aria-selected="true"]', text: 'Summary', message: 'Fullscreen opens the selected workbook sheet' },
        { role: 'button', name: 'Close', count: 1, message: 'Canonical close control is present' },
        { role: 'button', name: 'Show formulas', count: 1, message: 'Formula source toggle is present' },
      ],
    },
    {
      name: 'fullscreen-range-selection',
      label: 'Fullscreen range statistics survive chrome focus',
      mode: 'fullscreen',
      fresh: true,
      before: openSummaryFullscreen.concat([
        { action: 'click', within: 'fullscreen', selector: '.sdoc-cells-cell[data-r="1"][data-c="1"]' },
        { action: 'click', within: 'fullscreen', selector: '.sdoc-cells-cell[data-r="3"][data-c="1"]', modifiers: ['Shift'] },
        { action: 'click', within: 'fullscreen', selector: '.sdoc-cells-focus-brand' },
      ]),
      probes: {
        range: '.sdoc-cells-focus .sdoc-cells-cell.in-range',
        name: '.sdoc-cells-focus-name',
        stats: '.sdoc-cells-focus-stats',
      },
      contracts: [
        { selector: '.sdoc-cells-cell.in-range', count: 3, message: 'The fullscreen range remains selected after using its chrome' },
        { selector: '.sdoc-cells-focus-name', text: 'B2:B4', message: 'The fullscreen name box identifies the range' },
        { selector: '.sdoc-cells-focus-stats', nonEmpty: true, visible: true, message: 'The fullscreen range exposes canonical statistics' },
      ],
    },
    {
      name: 'fullscreen-formulas',
      label: 'Fullscreen formula source view',
      mode: 'fullscreen',
      fresh: true,
      before: openSummaryFullscreen.concat([
        { action: 'click', within: 'fullscreen', role: 'button', name: 'Show formulas' },
      ]),
      probes: {
        formulaToggle: '.sdoc-cells-fx-toggle.is-on',
        formulaSource: '.sdoc-cells-cell.is-formula-src',
      },
      contracts: [
        { selector: '.sdoc-cells-fx-toggle.is-on', count: 1, message: 'Formula source view exposes its active control state' },
        { selector: '.sdoc-cells-cell.is-formula-src', minCount: 3, message: 'Formula cells show their source strings' },
      ],
    },
    {
      name: 'fullscreen-editor-cancel',
      label: 'Fullscreen editor cancels without changing the cell',
      mode: 'fullscreen',
      fresh: true,
      before: openSummaryFullscreen.concat([
        { action: 'doubleClick', within: 'fullscreen', selector: '.sdoc-cells-cell[data-r="1"][data-c="1"]' },
        { action: 'fill', selector: '.sdoc-cells-editor', value: '999' },
        { action: 'press', key: 'Escape' },
      ]),
      probes: {
        editedCell: '.sdoc-cells-focus .sdoc-cells-cell[data-r="1"][data-c="1"]',
      },
      contracts: [
        { selector: '.sdoc-cells-editor', count: 0, message: 'Escape removes the portaled editor' },
        { within: 'fullscreen', selector: '.sdoc-cells-cell[data-r="1"][data-c="1"]', text: '$3,000.00', message: 'Escape restores the original computed value' },
      ],
    },
    {
      name: 'fullscreen-editor-commit',
      label: 'Fullscreen editor commits and advances selection',
      mode: 'fullscreen',
      fresh: true,
      before: openSummaryFullscreen.concat([
        { action: 'doubleClick', within: 'fullscreen', selector: '.sdoc-cells-cell[data-r="1"][data-c="1"]' },
        { action: 'fill', selector: '.sdoc-cells-editor', value: '999' },
        { action: 'press', key: 'Enter' },
      ]),
      probes: {
        editedCell: '.sdoc-cells-focus .sdoc-cells-cell[data-r="1"][data-c="1"]',
        activeCell: '.sdoc-cells-focus .sdoc-cells-cell.is-active',
      },
      contracts: [
        { selector: '.sdoc-cells-editor', count: 0, message: 'Enter removes the portaled editor' },
        { within: 'fullscreen', selector: '.sdoc-cells-cell[data-r="1"][data-c="1"]', text: '$999.00', message: 'Enter commits the formatted cell value' },
        { within: 'fullscreen', selector: '.sdoc-cells-cell.is-active[data-r="2"][data-c="1"]', count: 1, message: 'Enter advances the active cell by one row' },
      ],
    },
    {
      name: 'fullscreen-formula-bar',
      label: 'Fullscreen formula bar commits and recalculates',
      mode: 'fullscreen',
      fresh: true,
      before: openSummaryFullscreen.concat([
        { action: 'click', within: 'fullscreen', selector: '.sdoc-cells-cell[data-r="3"][data-c="1"]' },
        { action: 'fill', within: 'fullscreen', selector: '.sdoc-cells-focus-value', value: '=B2-B3+1' },
        { action: 'press', key: 'Enter' },
      ]),
      probes: {
        formulaBar: '.sdoc-cells-focus-value',
        recalculatedCell: '.sdoc-cells-focus .sdoc-cells-cell[data-r="3"][data-c="1"]',
      },
      contracts: [
        { within: 'fullscreen', selector: '.sdoc-cells-cell[data-r="3"][data-c="1"]', text: '$2,551.00', message: 'The committed formula recalculates the selected cell' },
        { within: 'fullscreen', selector: '.sdoc-cells-grid', focused: true, message: 'Formula commit returns focus to the canonical grid' },
      ],
    },
    {
      name: 'fullscreen-point-mode',
      label: 'Fullscreen editor points at a formula range',
      mode: 'fullscreen',
      fresh: true,
      before: openSummaryFullscreen.concat([
        { action: 'doubleClick', within: 'fullscreen', selector: '.sdoc-cells-cell[data-r="4"][data-c="1"]' },
        { action: 'type', selector: '.sdoc-cells-editor', text: '=SUM(' },
        { action: 'press', key: 'ArrowUp' },
        { action: 'press', key: 'Shift+ArrowUp' },
      ]),
      probes: {
        editor: '.sdoc-cells-editor',
        pointedCells: '.sdoc-cells-focus .sdoc-cells-cell.is-ref-point',
      },
      contracts: [
        { selector: '.sdoc-cells-editor', count: 1, inputValue: '=SUM(B3:B4', visible: true, message: 'The portaled editor contains the pointed range' },
        { within: 'fullscreen', selector: '.sdoc-cells-cell.is-ref-point', count: 2, message: 'The pointed range is highlighted in the grid' },
      ],
    },
    {
      name: 'fullscreen-close-commit',
      label: 'Closing fullscreen repaints the inline edited sheet',
      mode: 'inline',
      fresh: true,
      before: openSummaryFullscreen.concat([
        { action: 'doubleClick', within: 'fullscreen', selector: '.sdoc-cells-cell[data-r="1"][data-c="1"]' },
        { action: 'fill', selector: '.sdoc-cells-editor', value: '777' },
        { action: 'click', within: 'fullscreen', role: 'button', name: 'Close' },
      ]),
      probes: {
        editedCell: '.sdoc-cells:not([style*="display: none"]) .sdoc-cells-cell[data-r="1"][data-c="1"]',
        editedPill: '.sdoc-cells:not([style*="display: none"]) .sdoc-cells-edit-pill',
      },
      contracts: [
        { selector: '.sdoc-cells-focus', count: 0, message: 'The fullscreen surface closes' },
        { selector: '.sdoc-cells:not([style*="display: none"]) .sdoc-cells-cell[data-r="1"][data-c="1"]', text: '$777.00', message: 'The inline sheet repaints the committed value' },
        { selector: '.sdoc-cells:not([style*="display: none"]) .sdoc-cells-edit-pill', text: 'showing edited', visible: true, message: 'The inline sheet identifies its scratch edit state' },
      ],
    },
    {
      name: 'fullscreen-workbook-download',
      label: 'Fullscreen workbook Excel download',
      mode: 'fullscreen',
      fresh: true,
      before: openSummaryFullscreen.concat([
        { action: 'download', within: 'fullscreen', role: 'button', name: 'Download workbook (.xlsx)' },
      ]),
      contracts: [
        { selector: 'body', attribute: 'data-parity-download', value: 'capacity.xlsx', message: 'The fullscreen workbook download uses the canonical filename' },
      ],
    },
    {
      name: 'fullscreen-mobile',
      label: 'Fullscreen spreadsheet controls fit a narrow viewport',
      mode: 'fullscreen',
      fresh: true,
      viewport: { width: 390, height: 844 },
      before: openSummaryFullscreen,
      probes: {
        brand: '.sdoc-cells-focus-brand',
        close: '.sdoc-cells-focus-close',
      },
      contracts: [
        { selector: '.sdoc-cells-focus-brand-full', visible: false, message: 'The full brand is hidden on a narrow viewport' },
        { selector: '.sdoc-cells-focus-brand-tiny', visible: true, message: 'The compact brand is visible on a narrow viewport' },
        { role: 'button', name: 'Close', insideViewport: true, message: 'The close control remains inside the viewport' },
      ],
    },
  ],
};
