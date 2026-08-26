'use strict';

const path = require('path');

const probes = {
  wrapper: '.sdoc-chart',
  canvas: '.sdoc-chart canvas',
  menuButton: '.chart-menu-btn',
  menu: '.chart-menu',
  menuItem: '.chart-menu-item',
  menuToggle: '.chart-menu-toggle',
  menuType: '.chart-type-btn',
  menuInput: '.chart-menu-input',
};

const surface = {
  modes: { inline: { root: '.sdoc-chart', probes } },
  scopes: { inline: '.sdoc-chart' },
};

module.exports = {
  name: 'charts',
  fixture: path.resolve(__dirname, '../fixtures/charts.md'),
  viewport: { width: 1440, height: 900 },
  readySelector: '.sdoc-chart canvas',
  sdkOptions: { navigation: false, sections: { collapsible: false } },
  surfaces: {
    production: Object.assign({ hideForScreenshot: ['#_sd_statusbar'] }, surface),
    sdk: surface,
  },
  states: [
    {
      name: 'inline-chart',
      label: 'Inline chart',
      mode: 'inline',
      imageTolerance: { maxRatio: 0.0042 },
      contracts: [
        { selector: '.sdoc-chart', count: 1, message: 'One canonical chart wrapper renders' },
        { within: 'inline', selector: 'canvas', count: 1, visible: true, message: 'The chart canvas is visible' },
        { within: 'inline', role: 'button', name: 'Chart options', count: 1, message: 'The canonical options control is present' },
      ],
    },
    {
      name: 'options-hover',
      label: 'Chart options hover',
      mode: 'inline',
      fresh: true,
      imageTolerance: { maxRatio: 0.0042 },
      before: [{ action: 'hover', within: 'inline', role: 'button', name: 'Chart options' }],
      contracts: [
        { within: 'inline', role: 'button', name: 'Chart options', count: 1, hovered: true, visible: true, message: 'The options control exposes its hover state' },
      ],
    },
    {
      name: 'options-focus',
      label: 'Chart options keyboard focus',
      mode: 'inline',
      fresh: true,
      imageTolerance: { maxRatio: 0.0042 },
      before: [{ action: 'focus', via: 'keyboard', within: 'inline', role: 'button', name: 'Chart options' }],
      contracts: [
        { within: 'inline', role: 'button', name: 'Chart options', count: 1, focused: true, focusVisible: true, visible: true, message: 'Keyboard focus reaches the options control' },
      ],
    },
    {
      name: 'options-open',
      label: 'Chart options menu',
      mode: 'inline',
      fresh: true,
      imageTolerance: { maxRatio: 0.0042 },
      before: [{ action: 'click', within: 'inline', role: 'button', name: 'Chart options' }],
      contracts: [
        { within: 'inline', selector: '.chart-menu.open', count: 1, visible: true, message: 'The canonical chart menu opens' },
        { within: 'inline', role: 'button', name: 'Copy as image', count: 1, message: 'Image copy is available' },
        { within: 'inline', role: 'button', name: 'Download as PNG', count: 1, message: 'PNG download is available' },
        { within: 'inline', selector: '.chart-menu-toggle', count: 2, message: 'Data label and legend toggles are available' },
        { within: 'inline', selector: '.chart-type-btn', count: 3, message: 'The chart type family is available' },
        { within: 'inline', selector: '.chart-menu-input', count: 2, message: 'Title and subtitle controls are available' },
      ],
    },
    {
      name: 'options-mobile',
      label: 'Chart options on mobile',
      mode: 'inline',
      fresh: true,
      viewport: { width: 390, height: 844 },
      before: [{ action: 'click', within: 'inline', role: 'button', name: 'Chart options' }],
      ignoreHover: true,
      contracts: [
        { within: 'inline', selector: '.chart-menu.open', count: 1, visible: true, insideViewport: true, message: 'The chart menu remains inside the mobile viewport' },
      ],
    },
  ],
};
