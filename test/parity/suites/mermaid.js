'use strict';

const path = require('path');

const documentProbes = {
  wrapper: '.sdoc-mermaid',
  stage: '.sdoc-mermaid-stage',
  diagram: '.sdoc-mermaid-svg',
  tools: '.sdoc-mermaid-tools',
  fullscreen: '.sdoc-mermaid-zoom-btn',
};

const focusProbes = {
  topbar: '.sdoc-mermaid-focus-topbar',
  stage: '.sdoc-mermaid-focus-stage',
  diagram: '.sdoc-mermaid-focus-svg-wrap',
  close: '.sdoc-mermaid-focus-close',
};

const production = {
  modes: {
    inline: { root: '.sdoc-mermaid', probes: documentProbes },
    focus: { root: '.sdoc-mermaid-focus', probes: focusProbes },
  },
  scopes: { inline: '.sdoc-mermaid', focus: '.sdoc-mermaid-focus' },
  hideForScreenshot: ['#_sd_statusbar'],
};

const sdk = {
  modes: {
    inline: { root: '.sdoc-mermaid', probes: documentProbes },
    focus: { root: '.sdoc-mermaid-focus', probes: focusProbes },
  },
  scopes: { inline: '.sdoc-mermaid', focus: '.sdoc-mermaid-focus' },
};

module.exports = {
  name: 'mermaid',
  fixture: path.resolve(__dirname, '../fixtures/mermaid.md'),
  viewport: { width: 1440, height: 900 },
  readySelector: '.sdoc-mermaid-stage > svg.sdoc-mermaid-svg',
  sdkOptions: { navigation: false, sections: { collapsible: false } },
  surfaces: { production, sdk },
  states: [
    {
      name: 'inline-diagram',
      label: 'Inline diagram',
      mode: 'inline',
      contracts: [
        { selector: '.sdoc-mermaid', count: 1, message: 'One canonical diagram wrapper renders' },
        { within: 'inline', selector: '.sdoc-mermaid-stage > svg.sdoc-mermaid-svg', count: 1, visible: true, message: 'The rendered SVG is visible' },
        { within: 'inline', selector: '.sdoc-mermaid-tools', count: 1, message: 'Canonical diagram controls are present' },
      ],
    },
    {
      name: 'inline-tools-hover',
      label: 'Inline controls on hover',
      mode: 'inline',
      fresh: true,
      before: [{ action: 'hover', within: 'inline', selector: '.sdoc-mermaid-stage' }],
      probes: {
        hoveredWrapper: '.sdoc-mermaid:hover',
        visibleTools: '.sdoc-mermaid:hover .sdoc-mermaid-tools',
      },
      contracts: [
        { selector: '.sdoc-mermaid:hover', count: 1, hovered: true, message: 'The wrapper owns the pointer state' },
        { within: 'inline', role: 'button', name: 'Open diagram in fullscreen', count: 1, visible: true, message: 'Hover reveals the fullscreen control' },
      ],
    },
    {
      name: 'inline-fullscreen-focus',
      label: 'Fullscreen control with keyboard focus',
      mode: 'inline',
      fresh: true,
      before: [{ action: 'focus', via: 'keyboard', within: 'inline', role: 'button', name: 'Open diagram in fullscreen' }],
      contracts: [
        { within: 'inline', role: 'button', name: 'Open diagram in fullscreen', count: 1, focused: true, focusVisible: true, visible: true, message: 'Keyboard focus reaches and reveals the fullscreen control' },
      ],
    },
    {
      name: 'fullscreen-diagram',
      label: 'Fullscreen diagram',
      mode: 'focus',
      fresh: true,
      before: [{ action: 'click', within: 'inline', role: 'button', name: 'Open diagram in fullscreen' }],
      contracts: [
        { selector: '.sdoc-mermaid-focus', count: 1, message: 'The canonical focus surface opens' },
        { within: 'focus', selector: '.sdoc-mermaid-focus-svg-wrap > svg.sdoc-mermaid-svg', count: 1, visible: true, message: 'The focus surface contains the rendered diagram' },
        { within: 'focus', role: 'button', name: 'Copy Mermaid source', count: 1, message: 'Source copy is available' },
        { within: 'focus', role: 'button', name: 'Copy PNG to clipboard', count: 1, message: 'PNG copy is available' },
        { within: 'focus', role: 'button', name: 'Save as PNG file', count: 1, message: 'PNG download is available' },
      ],
    },
    {
      name: 'fullscreen-zoom-hover',
      label: 'Fullscreen zoom control on hover',
      mode: 'focus',
      before: [{ action: 'hover', within: 'focus', role: 'button', name: 'Zoom in' }],
      contracts: [
        { within: 'focus', role: 'button', name: 'Zoom in', count: 1, hovered: true, visible: true, message: 'Zoom control exposes its hover state' },
      ],
    },
    {
      name: 'fullscreen-close-focus',
      label: 'Fullscreen close control with keyboard focus',
      mode: 'focus',
      fresh: true,
      before: [
        { action: 'click', within: 'inline', role: 'button', name: 'Open diagram in fullscreen' },
        { action: 'focus', via: 'keyboard', within: 'focus', role: 'button', name: 'Close' },
      ],
      contracts: [
        { within: 'focus', role: 'button', name: 'Close', count: 1, focused: true, focusVisible: true, visible: true, message: 'Keyboard focus reaches the close control' },
      ],
    },
    {
      name: 'fullscreen-mobile',
      label: 'Fullscreen diagram on mobile',
      mode: 'focus',
      fresh: true,
      viewport: { width: 390, height: 844 },
      before: [{ action: 'click', within: 'inline', role: 'button', name: 'Open diagram in fullscreen' }],
      ignoreHover: true,
      contracts: [
        { selector: '.sdoc-mermaid-focus', count: 1, insideViewport: true, message: 'The focus surface remains inside the mobile viewport' },
        { within: 'focus', selector: '.sdoc-mermaid-focus-topbar', count: 1, insideViewport: true, message: 'The mobile control bar remains inside the viewport' },
      ],
    },
  ],
};
