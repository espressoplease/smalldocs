import DOMPurify from './vendor/purify.es.mjs';
import { Marked, Renderer } from './vendor/marked.esm.js';

const POLICY_NAME = 'smalldocs-sdk-0.2.0';
let trustedPolicy = null;

if (window.trustedTypes) {
  try {
    trustedPolicy = window.trustedTypes.createPolicy(POLICY_NAME, {
      createHTML(value) { return value; },
      createScriptURL(value) { return value; },
    });
  } catch (error) {
    throw new Error('SmallDocs could not create its Trusted Types policy: ' + error.message);
  }
}

const parser = new Marked();
const inlineMath = /^\$(?!\s)((?:\\\$|[^$\n])+?)(?<!\s)\$(?!\d)/;
const blockMath = /^\$\$([\s\S]+?)\$\$(?:\n|$)/;
const blockMathStart = /(?<=^|\n)\$\$/;

parser.use({
  extensions: [
    {
      name: 'sdocsNativeMathBlock',
      level: 'block',
      start(source) {
        const match = blockMathStart.exec(source);
        return match ? match.index : undefined;
      },
      tokenizer(source) {
        const match = blockMath.exec(source);
        if (match) return { type: 'sdocsNativeMathBlock', raw: match[0], tex: match[1].trim() };
      },
      renderer(token) {
        return '<div class="sdocs-math-display" data-tex="'
          + escapeAttribute(token.tex) + '"></div>\n';
      },
    },
    {
      name: 'sdocsNativeMathInline',
      level: 'inline',
      start(source) {
        const match = source.match(/(?<!\\)\$/);
        return match ? match.index : undefined;
      },
      tokenizer(source) {
        const match = inlineMath.exec(source);
        if (match) return { type: 'sdocsNativeMathInline', raw: match[0], tex: match[1] };
      },
      renderer(token) {
        return '<span class="sdocs-math-inline" data-tex="'
          + escapeAttribute(token.tex) + '"></span>';
      },
    },
  ],
});

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function createRenderer() {
  return new Renderer();
}

export function parseMarkdown(source, options) {
  return parser.parse(String(source == null ? '' : source), options || {});
}

export function sanitizeHTML(source, extra) {
  const clean = DOMPurify.sanitize(source, Object.assign({
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'template'],
    FORBID_ATTR: ['style', 'srcdoc'],
    SANITIZE_NAMED_PROPS: true,
    RETURN_TRUSTED_TYPE: false,
  }, extra || {}));
  return trustedPolicy ? trustedPolicy.createHTML(clean) : clean;
}

export function setSanitizedHTML(element, source, extra) {
  element.innerHTML = sanitizeHTML(source, extra);
}

export function setKnownHTML(element, source) {
  element.innerHTML = trustedPolicy ? trustedPolicy.createHTML(source) : source;
}

export function trustedScriptURL(source) {
  return trustedPolicy ? trustedPolicy.createScriptURL(source) : source;
}

export const trustedTypesPolicyName = POLICY_NAME;
