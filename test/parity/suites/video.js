'use strict';

const path = require('path');

const probes = {
  title: 'h1',
  video: '.sdoc-video',
  frame: '.sdoc-video-frame',
  iframe: '.sdoc-video iframe',
  caption: '.sdoc-video-caption',
  link: '.sdoc-video-caption a',
};

const diagnosticIgnore = [
  "Unrecognized feature: 'web-share'",
  "Allow attribute will take precedence over 'allowfullscreen'",
  'youtube-nocookie.com/api/stats/',
  'GL Driver Message',
  'No available adapters.',
];

const production = {
  modes: { document: { root: '.sdoc-reader', probes } },
  scopes: { document: '.sdoc-reader' },
  hideForScreenshot: ['#_sd_statusbar', '.sdoc-video iframe'],
  diagnosticIgnore,
  ignoreRootIdentity: true,
};

const sdk = {
  modes: { document: { root: '.sdoc-reader', probes } },
  scopes: { document: '.sdoc-reader' },
  hideForScreenshot: ['.sdoc-video iframe'],
  diagnosticIgnore,
  ignoreRootIdentity: true,
};

module.exports = {
  name: 'video',
  fixture: path.resolve(__dirname, '../fixtures/video.md'),
  viewport: { width: 1440, height: 900 },
  readySelector: '.sdoc-video iframe',
  sdkOptions: { navigation: false, sections: { collapsible: true, defaultOpen: true } },
  ignoreDifferences: ['styles.root.margin'],
  surfaces: { production, sdk },
  states: [
    {
      name: 'embedded-video',
      label: 'Validated video embed and caption',
      mode: 'document',
      contracts: [
        { within: 'document', selector: '.sdoc-video', count: 1, message: 'One canonical video wrapper renders' },
        { within: 'document', selector: 'code.language-video', count: 0, message: 'The source fence is replaced' },
        { within: 'document', selector: '.sdoc-video iframe', count: 1, message: 'One validated iframe renders' },
        { within: 'document', selector: '.sdoc-video iframe', attribute: 'src', value: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&start=75', message: 'The iframe uses the fixed nocookie URL and start time' },
        { within: 'document', selector: '.sdoc-video iframe', attribute: 'title', value: 'Product walkthrough', message: 'The iframe has the documented title' },
        { within: 'document', selector: '.sdoc-video-caption a', attribute: 'href', value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=75s', message: 'The caption links to the canonical watch URL' },
      ],
    },
    {
      name: 'caption-hover',
      label: 'Video caption link on hover',
      mode: 'document',
      fresh: true,
      screenshotSelector: '.sdoc-video-caption a',
      imageTolerance: { maxRatio: 0.2 },
      before: [{ action: 'hover', within: 'document', selector: '.sdoc-video-caption a' }],
      probes: { hoveredLink: '.sdoc-video-caption a:hover' },
      contracts: [
        { within: 'document', selector: '.sdoc-video-caption a', count: 1, hovered: true, message: 'The caption owns the pointer state' },
      ],
    },
    {
      name: 'caption-keyboard-focus',
      label: 'Video caption link with keyboard focus',
      mode: 'document',
      fresh: true,
      screenshotSelector: '.sdoc-video-caption',
      imageTolerance: { maxRatio: 0.01 },
      before: [{ action: 'focus', via: 'keyboard', within: 'document', selector: '.sdoc-video-caption a' }],
      probes: { focusedLink: '.sdoc-video-caption a:focus-visible' },
      contracts: [
        { within: 'document', selector: '.sdoc-video-caption a', count: 1, focused: true, focusVisible: true, message: 'Keyboard focus reaches the caption' },
      ],
    },
    {
      name: 'mobile-video',
      label: 'Responsive video in a narrow reader',
      mode: 'document',
      fresh: true,
      viewport: { width: 390, height: 844 },
      ignoreHover: true,
      contracts: [
        { within: 'document', selector: '.sdoc-video-frame', count: 1, insideViewport: true, message: 'The video frame remains inside the mobile viewport' },
        { within: 'document', selector: '.sdoc-video-caption a', count: 1, insideViewport: true, message: 'The caption remains reachable on mobile' },
      ],
    },
  ],
};
