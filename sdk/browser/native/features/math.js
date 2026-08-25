import { loadStyle } from '../assets.js';
import { setSanitizedHTML } from '../runtime.js';

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
  try {
    const katex = await loadKatex();
    if (context.signal.aborted) return;
    nodes.forEach((node) => {
      if (!node.isConnected) return;
      const tex = node.dataset.tex || '';
      try {
        const html = katex.renderToString(tex, {
          displayMode: node.classList.contains('sdocs-math-display'),
          throwOnError: false,
          output: 'html',
        });
        setSanitizedHTML(node, html, { FORBID_ATTR: ['srcdoc'] });
      } catch (_) {
        node.textContent = tex;
      }
    });
  } catch (_) {
    nodes.forEach((node) => { node.textContent = node.dataset.tex || ''; });
  }
}
