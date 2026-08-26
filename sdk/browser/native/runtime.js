import DOMPurify from './vendor/purify.es.mjs';
import { Marked, Renderer } from './vendor/marked.esm.js';

const previousMarkedDelCore = window.SDocsMarkedDelCore;
await import('./vendor/sdocs-marked-del-core.js');
const markedDelCore = window.SDocsMarkedDelCore;
if (previousMarkedDelCore === undefined) delete window.SDocsMarkedDelCore;
else window.SDocsMarkedDelCore = previousMarkedDelCore;

const previousMathCore = window.SDocMathCore;
await import('./vendor/sdocs-math-core.js');
export const mathCore = window.SDocMathCore;
if (previousMathCore === undefined) delete window.SDocMathCore;
else window.SDocMathCore = previousMathCore;

const previousHighlightCore = window.SDocHighlightCore;
await import('./vendor/sdocs-highlight-core.js');
export const highlightCore = window.SDocHighlightCore;
if (previousHighlightCore === undefined) delete window.SDocHighlightCore;
else window.SDocHighlightCore = previousHighlightCore;

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
parser.use(markedDelCore.extension);
parser.use(mathCore.extension);

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
