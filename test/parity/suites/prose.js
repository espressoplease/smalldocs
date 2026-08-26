'use strict';

const path = require('path');
const tableImageTolerance = { maxRatio: 0.0061, maxAntialiasRatio: 0.0065 };
const quoteImageTolerance = { maxRatio: 0.019, maxAntialiasRatio: 0.017 };

const modes = {
  table: {
    root: '.md-table-scroll',
    probes: {
      toolbar: '.md-table-toolbar',
      csv: '.table-copy-csv-btn',
      png: '.table-copy-png-btn',
      header: 'thead th',
      oddCell: 'tbody tr:nth-child(1) td',
      evenCell: 'tbody tr:nth-child(2) td',
    },
  },
  quote: {
    root: 'blockquote.sdoc-copyable-quote',
    probes: {
      quote: 'blockquote.sdoc-copyable-quote',
      copy: '.quote-copy-btn',
      paragraph: 'blockquote p',
    },
  },
};

const surface = {
  modes,
  scopes: {
    table: '.md-table-scroll',
    quote: 'blockquote.sdoc-copyable-quote',
  },
};

module.exports = {
  name: 'prose',
  fixture: path.resolve(__dirname, '../fixtures/prose.md'),
  viewport: { width: 1440, height: 900 },
  readySelector: '.md-table-scroll',
  surfaces: { production: surface, sdk: surface },
  states: [
    {
      name: 'table-rest',
      label: 'Table and copy toolbar at rest',
      mode: 'table',
      imageTolerance: tableImageTolerance,
      contracts: [
        { selector: '.md-table-toolbar', count: 1, message: 'Canonical table toolbar is present' },
        { role: 'button', name: 'Copy table as CSV', count: 1, message: 'CSV copy action is present' },
        { role: 'button', name: 'Copy table as PNG', count: 1, message: 'PNG copy action is present' },
        { selector: 'th', count: 6, message: 'All table columns render' },
        { selector: 'tbody tr', count: 2, message: 'All table rows render' },
      ],
    },
    {
      name: 'table-copy-hover',
      label: 'Table CSV copy control on hover',
      mode: 'table',
      fresh: true,
      imageTolerance: tableImageTolerance,
      before: [{ action: 'hover', within: 'table', role: 'button', name: 'Copy table as CSV' }],
      probes: { hoveredCopy: '.table-copy-csv-btn:hover' },
      contracts: [
        { role: 'button', name: 'Copy table as CSV', count: 1, hovered: true, message: 'CSV control owns the pointer state' },
      ],
    },
    {
      name: 'table-copy-focus',
      label: 'Table PNG copy control with keyboard focus',
      mode: 'table',
      fresh: true,
      imageTolerance: tableImageTolerance,
      before: [{ action: 'focus', via: 'keyboard', within: 'table', role: 'button', name: 'Copy table as PNG' }],
      probes: { focusedCopy: '.table-copy-png-btn:focus-visible' },
      contracts: [
        { role: 'button', name: 'Copy table as PNG', count: 1, focused: true, focusVisible: true, message: 'Keyboard focus reaches the PNG action' },
      ],
    },
    {
      name: 'table-csv-feedback',
      label: 'Table CSV copy feedback',
      mode: 'table',
      fresh: true,
      imageTolerance: tableImageTolerance,
      before: [
        { action: 'click', within: 'table', role: 'button', name: 'Copy table as CSV' },
        { action: 'waitFor', within: 'table', selector: '.table-copy-csv-btn polyline' },
      ],
      probes: { copied: '.table-copy-csv-btn' },
      contracts: [
        { selector: '.table-copy-csv-btn polyline', count: 1, message: 'CSV copy reports success with the canonical tick' },
        { selector: '.table-copy-csv-btn .table-copy-label', text: 'CSV', message: 'CSV label remains visible during feedback' },
      ],
    },
    {
      name: 'table-png-feedback',
      label: 'Table PNG copy feedback',
      mode: 'table',
      fresh: true,
      imageTolerance: tableImageTolerance,
      before: [
        { action: 'click', within: 'table', role: 'button', name: 'Copy table as PNG' },
        { action: 'waitFor', within: 'table', selector: '.table-copy-png-btn polyline' },
      ],
      probes: { copied: '.table-copy-png-btn' },
      contracts: [
        { selector: '.table-copy-png-btn polyline', count: 1, message: 'PNG copy reports success with the canonical tick' },
        { selector: '.table-copy-png-btn .table-copy-label', text: 'PNG', message: 'PNG label remains visible during feedback' },
      ],
    },
    {
      name: 'table-mobile',
      label: 'Wide table in a narrow reader',
      mode: 'table',
      fresh: true,
      viewport: { width: 390, height: 844 },
      imageTolerance: tableImageTolerance,
      contracts: [
        { selector: '.md-table-scroll', count: 1, insideViewport: true, message: 'The table scroll surface remains inside the mobile viewport' },
        { role: 'button', name: 'Copy table as CSV', count: 1, insideViewport: true, message: 'CSV action remains reachable on mobile' },
        { role: 'button', name: 'Copy table as PNG', count: 1, insideViewport: true, message: 'PNG action remains reachable on mobile' },
      ],
    },
    {
      name: 'quote-rest',
      label: 'Multi-paragraph blockquote at rest',
      mode: 'quote',
      fresh: true,
      imageTolerance: quoteImageTolerance,
      contracts: [
        { selector: 'blockquote.sdoc-copyable-quote', count: 1, message: 'Canonical copyable quote is present' },
        { selector: 'blockquote p', count: 2, message: 'Both quote paragraphs remain separate' },
        { role: 'button', name: 'Copy quote', count: 1, message: 'Quote copy action is present' },
      ],
    },
    {
      name: 'quote-copy-hover',
      label: 'Blockquote copy control on hover',
      mode: 'quote',
      fresh: true,
      imageTolerance: quoteImageTolerance,
      before: [{ action: 'hover', within: 'quote', role: 'button', name: 'Copy quote' }],
      probes: { hoveredCopy: '.quote-copy-btn:hover' },
      contracts: [
        { role: 'button', name: 'Copy quote', count: 1, hovered: true, message: 'Quote copy control owns the pointer state' },
      ],
    },
    {
      name: 'quote-copy-focus',
      label: 'Blockquote copy control with keyboard focus',
      mode: 'quote',
      fresh: true,
      imageTolerance: quoteImageTolerance,
      before: [{ action: 'focus', via: 'keyboard', within: 'quote', role: 'button', name: 'Copy quote' }],
      probes: { focusedCopy: '.quote-copy-btn:focus-visible' },
      contracts: [
        { role: 'button', name: 'Copy quote', count: 1, focused: true, focusVisible: true, message: 'Keyboard focus reaches the quote action' },
      ],
    },
    {
      name: 'quote-copy-feedback',
      label: 'Blockquote copy feedback',
      mode: 'quote',
      fresh: true,
      imageTolerance: quoteImageTolerance,
      before: [
        { action: 'click', within: 'quote', role: 'button', name: 'Copy quote' },
        { action: 'waitFor', within: 'quote', selector: '.quote-copy-btn polyline' },
      ],
      probes: { copied: '.quote-copy-btn' },
      contracts: [
        { selector: '.quote-copy-btn polyline', count: 1, message: 'Quote copy reports success with the canonical tick' },
      ],
    },
  ],
};
