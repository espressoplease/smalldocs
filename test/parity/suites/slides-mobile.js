'use strict';

const path = require('path');

function surface() {
  return {
    modes: {
      presentation: {
        root: '.sdoc-present',
        probes: {
          topbar: '.sdoc-present-topbar',
          stage: '.sdoc-present-stage',
          wrap: '.sdoc-present-wrap',
          counter: '.sdoc-present-counter',
          close: '.sdoc-present-close',
          rotate: '.pm-toast',
        },
      },
    },
    scopes: {
      document: '.sdoc-reader',
      presentation: '.sdoc-present',
    },
  };
}

module.exports = {
  name: 'slides-mobile',
  fixture: path.resolve(__dirname, '../../../public/developers/example/briefing.md'),
  viewport: { width: 390, height: 844 },
  pageOptions: { hasTouch: true, isMobile: true },
  readySelector: '.sdoc-slide',
  surfaces: { production: surface(), sdk: surface() },
  states: [
    {
      name: 'portrait-presentation',
      label: 'Touch presentation in portrait',
      mode: 'presentation',
      imageTolerance: { maxRatio: 0.001, maxAntialiasRatio: 0.004 },
      before: [{ action: 'click', within: 'document', role: 'button', name: 'Open slide 1 in presentation mode' }],
      contracts: [
        { selector: '.sdoc-present.pm-portrait', count: 1, insideViewport: true, message: 'Presentation selects the portrait touch layout' },
        { within: 'presentation', selector: '.sdoc-present-topbar', count: 1, insideViewport: true, message: 'Portrait controls stay inside the viewport' },
        { within: 'presentation', selector: '.sdoc-present-counter', text: '1 / 4', message: 'Portrait presentation opens on the requested slide' },
      ],
    },
    {
      name: 'portrait-swipe-next',
      label: 'Touch swipe advances the deck',
      mode: 'presentation',
      imageTolerance: { maxRatio: 0.001, maxAntialiasRatio: 0.004 },
      before: [{ action: 'swipe', within: 'presentation', selector: '.sdoc-present-stage-wrap' }],
      contracts: [
        { within: 'presentation', selector: '.sdoc-present-counter', text: '2 / 4', message: 'A committed left swipe advances one slide' },
        { within: 'presentation', selector: '.sdoc-present-thumb.active', count: 1, message: 'The active thumbnail follows the swiped slide' },
      ],
    },
    {
      name: 'landscape-presentation',
      label: 'Touch presentation in landscape',
      mode: 'presentation',
      fresh: true,
      viewport: { width: 844, height: 390 },
      imageTolerance: { maxRatio: 0.001, maxAntialiasRatio: 0.004 },
      before: [{ action: 'click', within: 'document', role: 'button', name: 'Open slide 1 in presentation mode' }],
      contracts: [
        { selector: '.sdoc-present.pm-landscape', count: 1, insideViewport: true, message: 'Presentation selects the landscape touch layout' },
        { within: 'presentation', role: 'button', name: 'Exit presentation', count: 1, visible: true, message: 'Landscape keeps a reachable touch exit' },
        { within: 'presentation', selector: '.sdoc-present-stage', count: 1, insideViewport: true, message: 'Landscape stage stays inside the viewport' },
      ],
    },
  ],
};
