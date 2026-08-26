import { loadStyle, vendorAsset } from '../assets.js';
import { mathCore, setSanitizedHTML } from '../runtime.js';

const KATEX_VERSION = '0.16.11';
const KATEX_CSS = 'https://cdn.jsdelivr.net/npm/katex@' + KATEX_VERSION + '/dist/katex.min.css';
const KATEX_JS = 'https://cdn.jsdelivr.net/npm/katex@' + KATEX_VERSION + '/dist/katex.mjs';

let katexPromise = null;

function loadKatex() {
  if (katexPromise) return katexPromise;
  katexPromise = Promise.all([
    loadStyle(KATEX_CSS, 'smalldocs-sdk-katex-css'),
    import(KATEX_JS),
  ]).then((values) => values[1].default || values[1]).catch((error) => {
    katexPromise = null;
    throw error;
  });
  return katexPromise;
}

export async function mount(context) {
  const nodes = Array.from(context.root.querySelectorAll('.sdocs-math-display, .sdocs-math-inline'));
  if (!nodes.length) return;
  await loadStyle(vendorAsset('sdocs-math-reader.css'), 'smalldocs-sdk-math-reader-styles');
  const renderer = mathCore.createRenderer({
    load: loadKatex,
    isActive() { return !context.signal.aborted; },
    isNodeActive(node) { return context.allowDetached === true || node.isConnected; },
    render(katex, tex, node, displayMode) {
      const html = katex.renderToString(tex, {
        displayMode,
        throwOnError: false,
        output: 'html',
      });
      setSanitizedHTML(node, html, { FORBID_ATTR: ['srcdoc'] });
    },
  });
  await renderer.processMath(context.root);
}
