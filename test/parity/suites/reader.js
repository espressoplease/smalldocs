'use strict';

const path = require('path');

const production = {
  modes: {
    document: {
      root: '.sdoc-reader',
      probes: {
        title: 'h1',
        firstSection: '.md-section:first-of-type',
        heading: '.md-section:first-of-type > h2',
        toggle: '.md-section:first-of-type > h2 > .section-toggle',
        copy: '.md-section:first-of-type > h2 > .header-copy-btn',
        list: 'ul:has(> li > a[href="https://example.com/source"])',
        orderedList: 'ol',
        taskList: 'input[type="checkbox"]',
        inlineCode: 'p code',
        deleted: 'del',
        rule: 'hr',
        link: 'a[href="https://example.com/source"]',
      },
    },
  },
  scopes: { document: '.sdoc-reader' },
  hideForScreenshot: ['#_sd_statusbar'],
  ignoreRootIdentity: true,
};

const sdk = {
  modes: {
    document: {
      root: '.sdoc-reader',
      probes: {
        title: 'h1',
        firstSection: '.md-section:first-of-type',
        heading: '.md-section:first-of-type > h2',
        toggle: '.md-section:first-of-type > h2 > .section-toggle',
        copy: '.md-section:first-of-type > h2 > .header-copy-btn',
        list: 'ul:has(> li > a[href="https://example.com/source"])',
        orderedList: 'ol',
        taskList: 'input[type="checkbox"]',
        inlineCode: 'p code',
        deleted: 'del',
        rule: 'hr',
        link: 'a[href="https://example.com/source"]',
      },
    },
  },
  scopes: { document: '.sdoc-reader' },
  ignoreRootIdentity: true,
};

module.exports = {
  name: 'reader',
  fixture: path.resolve(__dirname, '../fixtures/reader.md'),
  viewport: { width: 1440, height: 900 },
  readySelector: '.md-section',
  sdkOptions: {
    navigation: false,
    sections: { collapsible: true, defaultOpen: true },
  },
  surfaces: { production, sdk },
  states: [
    {
      name: 'expanded-document',
      label: 'Expanded headings, nested sections, lists and links',
      mode: 'document',
      contracts: [
        { within: 'document', selector: 'h1', count: 1, message: 'The document title is present' },
        { within: 'document', selector: '.md-section', count: 3, message: 'All heading sections use the canonical wrappers' },
        { within: 'document', selector: '.md-section-body.open', count: 3, message: 'All sections start expanded for this fixture' },
        { within: 'document', selector: 'h2', count: 2, message: 'Both duplicate H2 headings render' },
        { within: 'document', selector: 'h3', count: 1, message: 'The nested H3 heading renders' },
        { within: 'document', selector: 'ul:has(> li > a[href="https://example.com/source"]) > li', count: 2, message: 'Both unordered list items render' },
        { within: 'document', selector: 'ol > li', count: 2, message: 'Both ordered list items render' },
        { within: 'document', selector: 'ol ul > li', count: 1, message: 'The nested list item renders' },
        { within: 'document', selector: 'input[type="checkbox"]', count: 2, message: 'Both task list controls render' },
        { within: 'document', selector: 'input[type="checkbox"]:checked', count: 1, message: 'The completed task remains checked' },
        { within: 'document', selector: 'p code', count: 1, message: 'Inline code renders' },
        { within: 'document', selector: 'del', count: 1, message: 'Double tildes render as strikethrough' },
        { within: 'document', selector: 'hr', count: 1, message: 'The horizontal rule renders' },
        { within: 'document', selector: '.header-copy-btn', count: 4, message: 'Each heading has the canonical copy action' },
      ],
    },
    {
      name: 'heading-hover',
      label: 'Section heading and descendants on hover',
      mode: 'document',
      fresh: true,
      screenshotSelector: '.md-section:first-of-type > h2',
      before: [{ action: 'hover', within: 'document', selector: '.md-section:first-of-type > h2' }],
      probes: {
        hoveredHeading: '.md-section:first-of-type > h2:hover',
        descendantToggle: '.md-section:first-of-type > .md-section-body .section-toggle',
      },
      contracts: [
        { within: 'document', selector: '.md-section:first-of-type > h2:hover', count: 1, hovered: true, message: 'The first section heading owns the pointer state' },
      ],
    },
    {
      name: 'section-collapsed',
      label: 'One nested section tree collapsed',
      mode: 'document',
      fresh: true,
      before: [{ action: 'click', within: 'document', selector: '.md-section:first-of-type > h2' }],
      contracts: [
        { within: 'document', selector: '.md-section:first-of-type > .md-section-body.open', count: 0, message: 'The selected section body closes' },
        { within: 'document', selector: '.md-section:first-of-type > .md-section-body .md-section-body.open', count: 0, message: 'Nested section bodies close with their parent' },
        { within: 'document', selector: '.md-section:nth-of-type(2) > .md-section-body.open', count: 1, message: 'The sibling section remains open' },
      ],
    },
    {
      name: 'heading-copy-feedback',
      label: 'Heading copy action feedback',
      mode: 'document',
      fresh: true,
      before: [
        { action: 'click', within: 'document', selector: '.md-section:first-of-type > h2 > .header-copy-btn' },
        { action: 'waitFor', within: 'document', selector: '.md-section:first-of-type > h2 > .header-copy-btn polyline' },
      ],
      probes: { copied: '.md-section:first-of-type > h2 > .header-copy-btn' },
      contracts: [
        { within: 'document', selector: '.md-section:first-of-type > h2 > .header-copy-btn polyline', count: 1, message: 'Heading copy reports success with the canonical tick' },
      ],
    },
    {
      name: 'link-hover',
      label: 'Document link on hover',
      mode: 'document',
      fresh: true,
      screenshotSelector: 'a[href="https://example.com/source"]',
      imageTolerance: { maxRatio: 0.2 },
      before: [{ action: 'hover', within: 'document', selector: 'a[href="https://example.com/source"]' }],
      probes: { hoveredLink: 'a[href="https://example.com/source"]:hover' },
      contracts: [
        { within: 'document', selector: 'a[href="https://example.com/source"]:hover', count: 1, hovered: true, message: 'The document link owns the pointer state' },
      ],
    },
    {
      name: 'link-keyboard-focus',
      label: 'Document link with keyboard focus',
      mode: 'document',
      fresh: true,
      imageTolerance: { maxRatio: 0.0032 },
      before: [{ action: 'focus', via: 'keyboard', within: 'document', selector: 'a[href="https://example.com/source"]' }],
      probes: { focusedLink: 'a[href="https://example.com/source"]:focus-visible' },
      contracts: [
        { within: 'document', selector: 'a[href="https://example.com/source"]', count: 1, focused: true, focusVisible: true, message: 'Keyboard focus reaches the document link' },
      ],
    },
    {
      name: 'mobile-document',
      label: 'Headings, list and links in a narrow reader',
      mode: 'document',
      fresh: true,
      viewport: { width: 390, height: 844 },
      ignoreHover: true,
      contracts: [
        { within: 'document', selector: 'h1', count: 1, insideViewport: true, message: 'The title remains inside the mobile viewport' },
        { within: 'document', selector: 'ul:has(> li > a[href="https://example.com/source"])', count: 1, insideViewport: true, message: 'The unordered list remains inside the mobile viewport' },
        { within: 'document', selector: 'ol', count: 1, insideViewport: true, message: 'The ordered list remains inside the mobile viewport' },
        { within: 'document', selector: 'input[type="checkbox"]', count: 2, insideViewport: true, message: 'Task controls remain inside the mobile viewport' },
        { within: 'document', selector: 'p code', count: 1, insideViewport: true, message: 'Inline code remains inside the mobile viewport' },
        { within: 'document', selector: 'a[href="https://example.com/source"]', count: 1, insideViewport: true, message: 'The source link remains reachable on mobile' },
      ],
    },
  ],
};
