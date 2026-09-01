import { loadScript } from '../assets.js';
import { highlightCore, setSanitizedHTML } from '../runtime.js';

const VERSION = '11.11.1';
const BASE = 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@' + VERSION;
const languageLoads = new Map();

async function ensureLanguage(hljs, language) {
  if (hljs.getLanguage(language)) return true;
  if (!languageLoads.has(language)) {
    languageLoads.set(language, loadScript(
      BASE + '/languages/' + encodeURIComponent(language) + '.min.js',
      () => window.hljs && window.hljs.getLanguage(language)
    ).then(() => true).catch(() => false));
  }
  return languageLoads.get(language);
}

export async function mount(context) {
  const allowDetached = context.allowDetached === true;
  const renderer = highlightCore.createRenderer({
    loadCore() {
      return loadScript(BASE + '/highlight.min.js', () => window.hljs).then((hljs) => {
        hljs.configure({ ignoreUnescapedHTML: true, throwUnescapedHTML: false });
        return hljs;
      });
    },
    ensureLanguage,
    isActive() { return !context.signal.aborted; },
    isNodeActive(node) { return allowDetached || node.isConnected; },
    applyHTML(element, source) {
      setSanitizedHTML(element, source, {
        ALLOWED_TAGS: ['span'],
        ALLOWED_ATTR: ['class'],
      });
    },
  });
  await renderer.processHighlight(context.root);
}
