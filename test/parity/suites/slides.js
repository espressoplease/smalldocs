'use strict';

const path = require('path');

module.exports = {
  name: 'slides',
  fixture: path.resolve(__dirname, '../../../public/developers/example/briefing.md'),
  viewport: { width: 1440, height: 900 },
  readySelector: '.sdoc-slide',
  surfaces: {
    production: {
      inlineRoot: '.sdoc-slide',
      presentationRoot: '.sdoc-present',
      stage: '.sdoc-present-stage',
      rail: '.sdoc-present-rail',
      scopes: {
        inline: '.sdoc-slide',
        presentation: '.sdoc-present',
      },
    },
    sdk: {
      inlineRoot: '.sdoc-slide',
      presentationRoot: '.sdoc-present',
      stage: '.sdoc-present-stage',
      rail: '.sdoc-present-rail',
      scopes: {
        inline: '.sdoc-slide',
        presentation: '.sdoc-present',
      },
    },
  },
  states: [
    {
      name: 'inline-first-slide',
      label: 'Inline first slide',
      mode: 'inline',
      contracts: [
        { selector: '.sdoc-slide', count: 4, message: 'All four inline slides render' },
        { selector: '.sdoc-slide-present', count: 4, message: 'Every slide has the canonical presentation control' },
      ],
    },
    {
      name: 'inline-shape-copy-hover',
      label: 'Inline shape copy control on hover',
      mode: 'inline',
      before: [{ action: 'hover', within: 'inline', selector: '.shape-rect' }],
      probes: {
        hoveredShape: '.sdoc-slide .shape-rect:hover',
        revealedCopy: '.sdoc-slide .shape-rect:hover > .sd-shape-copy-btn',
      },
      contracts: [
        { selector: '.sdoc-slide .shape-rect:hover', count: 1, hovered: true, message: 'One shape owns the pointer state' },
        { selector: '.sdoc-slide .shape-rect:hover > .sd-shape-copy-btn', count: 1, visible: true, message: 'Hover reveals the shape copy control' },
      ],
    },
    {
      name: 'inline-present-keyboard-focus',
      label: 'Inline presentation control with keyboard focus',
      mode: 'inline',
      before: [{ action: 'focus', via: 'keyboard', within: 'inline', role: 'button', name: 'Open slide 1 in presentation mode' }],
      probes: {
        focusedPresentButton: '.sdoc-slide-present:focus-visible',
      },
      contracts: [
        { within: 'inline', role: 'button', name: 'Open slide 1 in presentation mode', count: 1, focused: true, focusVisible: true, visible: true, message: 'Keyboard focus reaches and reveals the presentation control' },
      ],
    },
    {
      name: 'presentation-first-slide',
      label: 'Presentation first slide',
      mode: 'presentation',
      before: [{ action: 'click', role: 'button', name: 'Open slide 1 in presentation mode' }],
      probes: {
        topbar: '.sdoc-present-topbar',
        counter: '.sdoc-present-counter',
        exportButton: '.sdoc-present-export-btn',
        closeButton: '.sdoc-present-close',
      },
      contracts: [
        { selector: '.sdoc-present', count: 1, message: 'Canonical presentation root is present' },
        { selector: '.sdoc-present-rail', count: 1, message: 'Thumbnail rail is present' },
        { selector: '.sdoc-present-thumb', count: 4, message: 'Thumbnail rail contains every slide' },
        { within: 'presentation', role: 'button', name: 'Copy slide text', count: 1, message: 'The active slide text can be copied' },
        { within: 'presentation', role: 'button', name: 'Copy slide as PNG', count: 1, message: 'The active slide can be copied as PNG' },
        { within: 'presentation', role: 'button', name: 'Export', count: 1, message: 'Canonical export control is present' },
      ],
    },
    {
      name: 'presentation-second-slide',
      label: 'Presentation second slide',
      mode: 'presentation',
      before: [{ action: 'click', within: 'presentation', role: 'button', name: 'Next slide' }],
      contracts: [
        { selector: '.sdoc-present-thumb.active', count: 1, message: 'One thumbnail tracks the active slide' },
        { selector: '.sdoc-present-counter', text: '2 / 4', message: 'Counter advances to slide two' },
      ],
    },
    {
      name: 'presentation-export-panel',
      label: 'Presentation export panel',
      mode: 'presentation',
      before: [{ action: 'click', within: 'presentation', role: 'button', name: 'Export' }],
      probes: {
        exportPanel: '.sdoc-present-exp-panel',
        exportAction: '.sdoc-present-exp-btn',
      },
      contracts: [
        { selector: '.sdoc-present-exp-panel.open', count: 1, message: 'Export panel opens' },
        { selector: '.sdoc-present-exp-btn', count: 2, message: 'PDF and PowerPoint actions are present' },
      ],
    },
  ],
};
