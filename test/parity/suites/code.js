'use strict';

const path = require('path');

const inlineProbes = {
  wrapper: '.pre-wrapper',
  code: '.pre-wrapper code.language-ruby',
  tools: '.pre-wrapper .pre-tools',
  wrap: '.pre-wrapper .code-wrap-btn',
  copy: '.pre-wrapper .code-copy-btn',
  expand: '.pre-wrapper .code-expand-btn',
};

const focusProbes = {
  viewer: '.sdoc-code-focus',
  topbar: '.sdoc-code-focus-topbar',
  lines: '.sdoc-code-focus-lines',
  gutter: '.sdoc-code-focus-gutter',
  wrap: '.sdoc-code-focus [data-act="wrap"]',
  fold: '.sdoc-code-focus [data-act="foldall"]',
  theme: '.sdoc-code-focus [data-act="theme"]',
  close: '.sdoc-code-focus [data-act="close"]',
};

function surface() {
  return {
    modes: {
      inline: { root: '.pre-wrapper', probes: inlineProbes },
      focus: { root: '.sdoc-code-focus', probes: focusProbes },
    },
    scopes: {
      document: '.sdoc-reader',
      focus: '.sdoc-code-focus',
    },
  };
}

module.exports = {
  name: 'code',
  fixture: path.resolve(__dirname, '../fixtures/highlight.md'),
  viewport: { width: 1440, height: 900 },
  readySelector: '.pre-wrapper code.language-ruby.hljs',
  productionCapabilities: { codeComments: false },
  sdkOptions: { navigation: false, sections: { collapsible: true, defaultOpen: true } },
  surfaces: { production: surface(), sdk: surface() },
  states: [
    {
      name: 'inline-ruby',
      label: 'Inline highlighted code and controls',
      mode: 'inline',
      contracts: [
        { within: 'document', selector: '.pre-wrapper', count: 3, message: 'Every source block has a canonical wrapper' },
        { within: 'document', selector: '.pre-wrapper .wrap-btn', count: 3, message: 'Every source block has wrap control' },
        { within: 'document', role: 'button', name: 'Copy code', count: 3, message: 'Every source block has copy control' },
        { within: 'document', role: 'button', name: 'Open code in fullscreen', count: 3, message: 'Every source block has fullscreen control' },
      ],
    },
    {
      name: 'inline-controls-hover',
      label: 'Inline code controls on pointer hover',
      mode: 'inline',
      before: [{ action: 'hover', within: 'document', selector: '.pre-wrapper' }],
      probes: { hovered: '.pre-wrapper:hover', tools: '.pre-wrapper:hover .pre-tools' },
      contracts: [
        { within: 'document', selector: '.pre-wrapper:hover', count: 1, hovered: true, message: 'The code wrapper owns pointer hover' },
        { within: 'document', selector: '.pre-wrapper:hover .pre-tools', count: 1, visible: true, message: 'Hover reveals the canonical controls' },
      ],
    },
    {
      name: 'fullscreen-default',
      label: 'Canonical fullscreen code viewer',
      mode: 'focus',
      fresh: true,
      before: [{ action: 'click', within: 'document', role: 'button', name: 'Open code in fullscreen' }],
      contracts: [
        { selector: '.sdoc-code-focus', count: 1, visible: true, message: 'Fullscreen viewer opens' },
        { within: 'focus', selector: '.sdoc-code-focus-topbar [data-act]', count: 6, message: 'Rendering-only topbar has the canonical six actions' },
        { within: 'focus', selector: '[data-act="comment"]', count: 0, message: 'Application comments stay outside the SDK reader' },
        { within: 'focus', selector: '.hljs-keyword', minCount: 1, message: 'Fullscreen source keeps syntax colours' },
      ],
    },
    {
      name: 'fullscreen-folded',
      label: 'Fullscreen hierarchical folding',
      mode: 'focus',
      fresh: true,
      before: [
        { action: 'click', within: 'document', role: 'button', name: 'Open code in fullscreen' },
        { action: 'click', within: 'focus', role: 'button', name: 'Collapse all' },
      ],
      contracts: [
        { within: 'focus', selector: '[data-act="foldall"]', attribute: 'aria-label', value: 'Expand all', message: 'Master fold control reflects the folded state' },
        { within: 'focus', selector: '.sdoc-cl-row[style*="display: none"]', minCount: 1, message: 'Non-structural lines collapse' },
      ],
    },
    {
      name: 'fullscreen-dark',
      label: 'Fullscreen viewer-local dark theme',
      mode: 'focus',
      fresh: true,
      before: [
        { action: 'click', within: 'document', role: 'button', name: 'Open code in fullscreen' },
        { action: 'click', within: 'focus', role: 'button', name: 'Switch code viewer to dark' },
      ],
      contracts: [
        { within: 'focus', selector: '[data-act="theme"]', attribute: 'aria-label', value: 'Switch code viewer to light', message: 'Viewer-local theme changes without changing the document' },
        { within: 'focus', selector: '.hljs-keyword', minCount: 1, visible: true, message: 'Syntax colours remain visible in dark mode' },
      ],
    },
    {
      name: 'fullscreen-mobile',
      label: 'Fullscreen code viewer on mobile',
      mode: 'focus',
      fresh: true,
      viewport: { width: 390, height: 844 },
      before: [{ action: 'click', within: 'document', role: 'button', name: 'Open code in fullscreen' }],
      contracts: [
        { selector: '.sdoc-code-focus', count: 1, insideViewport: true, message: 'Fullscreen viewer stays inside the mobile viewport' },
        { within: 'focus', selector: '.sdoc-code-focus-topbar', count: 1, insideViewport: true, message: 'Mobile topbar stays inside the viewport' },
        { within: 'focus', role: 'button', name: 'Close', count: 1, visible: true, message: 'Close remains reachable on mobile' },
      ],
    },
  ],
};
