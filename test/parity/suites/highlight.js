'use strict';

const path = require('path');

const probes = {
  title: 'h1',
  ruby: 'code.language-ruby',
  rubyKeyword: 'code.language-ruby .hljs-keyword',
  rubyString: 'code.language-ruby .hljs-string',
  python: 'code.language-python',
  comment: 'code.language-python .hljs-comment',
  plain: 'pre code:not([class*="language-"])',
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
  name: 'highlight',
  fixture: path.resolve(__dirname, '../fixtures/highlight.md'),
  viewport: { width: 1440, height: 900 },
  readySelector: 'code.language-ruby.hljs .hljs-keyword',
  sdkOptions: { navigation: false, sections: { collapsible: true, defaultOpen: true } },
  ignoreDifferences: ['styles.root.margin'],
  surfaces: { production, sdk },
  states: [
    {
      name: 'highlighted-document',
      label: 'Known languages and plain source in one document',
      mode: 'document',
      contracts: [
        { within: 'document', selector: 'code.language-ruby.hljs', count: 1, message: 'Ruby is highlighted' },
        { within: 'document', selector: 'code.language-ruby .hljs-keyword', minCount: 1, message: 'Ruby keywords receive canonical tokens' },
        { within: 'document', selector: 'code.language-ruby .hljs-string', minCount: 1, message: 'Ruby strings receive canonical tokens' },
        { within: 'document', selector: 'code.language-python.hljs', count: 1, message: 'Python is highlighted' },
        { within: 'document', selector: 'code.language-python .hljs-comment', count: 1, message: 'Python comments receive the explanation token' },
        { within: 'document', selector: 'pre code:not([class*="language-"]).hljs', count: 0, message: 'An unlabelled block stays plain' },
      ],
    },
    {
      name: 'ruby-tokens',
      label: 'Ruby syntax token colours',
      mode: 'document',
      fresh: true,
      screenshotSelector: 'code.language-ruby',
      contracts: [
        { within: 'document', selector: 'code.language-ruby', attribute: 'data-hl-done', value: '1', message: 'The block settles once' },
      ],
    },
    {
      name: 'explanation-comment',
      label: 'Code comments remain visually prominent',
      mode: 'document',
      fresh: true,
      screenshotSelector: 'code.language-python .hljs-comment',
      contracts: [
        { within: 'document', selector: 'code.language-python .hljs-comment', count: 1, visible: true, message: 'The explanation comment remains visible' },
      ],
    },
    {
      name: 'mobile-code',
      label: 'Highlighted code inside a narrow reader',
      mode: 'document',
      fresh: true,
      viewport: { width: 390, height: 844 },
      ignoreHover: true,
      contracts: [
        { within: 'document', selector: '.pre-wrapper', count: 3, insideViewport: true, message: 'All code wrappers stay inside the mobile viewport' },
        { within: 'document', selector: '.pre-wrapper:first-of-type .pre-tools button', minCount: 3, message: 'The visible code controls remain available on mobile' },
      ],
    },
  ],
};
