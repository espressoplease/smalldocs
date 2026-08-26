'use strict';

const path = require('path');

const probes = {
  title: 'h1',
  inline: '.sdocs-math-inline',
  inlineKatex: '.sdocs-math-inline .katex',
  display: '.sdocs-math-display',
  displayKatex: '.sdocs-math-display .katex-display',
  fraction: '.sdocs-math-display .mfrac',
};

const production = {
  modes: { document: { root: '.sdoc-reader', probes } },
  scopes: { document: '.sdoc-reader' },
  hideForScreenshot: ['#_sd_statusbar'],
  ignoreRootIdentity: true,
};

const sdk = {
  modes: { document: { root: '.sdoc-reader', probes } },
  scopes: { document: '.sdoc-reader' },
  ignoreRootIdentity: true,
};

module.exports = {
  name: 'math',
  fixture: path.resolve(__dirname, '../fixtures/math.md'),
  viewport: { width: 1440, height: 900 },
  readySelector: '.sdocs-math-display .katex-display',
  sdkOptions: { navigation: false, sections: { collapsible: true, defaultOpen: true } },
  ignoreDifferences: ['styles.root.margin'],
  surfaces: { production, sdk },
  states: [
    {
      name: 'rendered-math',
      label: 'Inline and display math rendered by KaTeX',
      mode: 'document',
      contracts: [
        { within: 'document', selector: '.sdocs-math-inline', count: 1, message: 'One inline expression renders' },
        { within: 'document', selector: '.sdocs-math-inline .katex', count: 1, message: 'The inline expression is processed by KaTeX' },
        { within: 'document', selector: '.sdocs-math-display', count: 1, message: 'One display expression renders' },
        { within: 'document', selector: '.sdocs-math-display .katex-display', count: 1, message: 'The display expression uses canonical KaTeX display markup' },
        { within: 'document', selector: '.sdocs-math-display .mfrac', count: 1, message: 'Fraction layout survives rendering and sanitisation' },
        { within: 'document', selector: '.sdocs-math-inline, .sdocs-math-display', count: 2, message: 'Currency text does not create extra math placeholders' },
      ],
    },
    {
      name: 'inline-expression',
      label: 'Inline math in surrounding prose',
      mode: 'document',
      fresh: true,
      screenshotSelector: '.sdocs-math-inline',
      contracts: [
        { within: 'document', selector: '.sdocs-math-inline', attribute: 'data-tex', value: 'a_1 + b_2 = c_3', message: 'The original inline source remains available' },
      ],
    },
    {
      name: 'display-expression',
      label: 'Display fraction geometry and styling',
      mode: 'document',
      fresh: true,
      screenshotSelector: '.sdocs-math-display',
      imageTolerance: { maxRatio: 0.004 },
      contracts: [
        { within: 'document', selector: '.sdocs-math-display .mfrac', count: 1, visible: true, message: 'The display fraction is visible' },
      ],
    },
    {
      name: 'mobile-math',
      label: 'Math inside a narrow reader',
      mode: 'document',
      fresh: true,
      viewport: { width: 390, height: 844 },
      ignoreHover: true,
      contracts: [
        { within: 'document', selector: '.sdocs-math-inline', count: 1, insideViewport: true, message: 'Inline math remains inside the mobile viewport' },
        { within: 'document', selector: '.sdocs-math-display', count: 1, insideViewport: true, message: 'Display math remains inside the mobile viewport' },
      ],
    },
  ],
};
