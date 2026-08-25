import { loadScript } from '../assets.js';
import { setSanitizedHTML } from '../runtime.js';

const VERSION = '11.11.1';
const BASE = 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@' + VERSION;
const RESERVED = new Set(['chart', 'mermaid', 'cells', 'video', 'slide', 'slides', 'form', 'sdoc-app']);
const languageLoads = new Map();

function languageOf(code) {
  const match = (code.className || '').match(/(?:^|\s)language-([\w+#-]+)/i);
  return match ? match[1].toLowerCase() : '';
}

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
  const nodes = Array.from(context.root.querySelectorAll('pre code[class*="language-"]'))
    .filter((code) => {
      const language = languageOf(code);
      return language && !RESERVED.has(language) && code.textContent.length <= 200 * 1024;
    })
    .slice(0, 120)
    .map((code) => ({ code, source: code.textContent, language: languageOf(code) }));
  if (!nodes.length) return;

  try {
    const hljs = await loadScript(BASE + '/highlight.min.js', () => window.hljs);
    if (context.signal.aborted) return;
    await Promise.all(nodes.map(async (entry) => {
      const available = await ensureLanguage(hljs, entry.language);
      if (!available || context.signal.aborted || !entry.code.isConnected) return;
      try {
        const result = hljs.highlight(entry.source, {
          language: entry.language,
          ignoreIllegals: true,
        });
        setSanitizedHTML(entry.code, result.value, {
          ALLOWED_TAGS: ['span'],
          ALLOWED_ATTR: ['class'],
        });
        entry.code.classList.add('hljs');
      } catch (_) {}
    }));
  } catch (_) {}
}
