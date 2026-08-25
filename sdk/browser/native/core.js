import { ensureCoreAssets } from './assets.js';
import { closeActiveOverlay } from './overlay.js';
import { createRenderer as createMarkedRenderer, parseMarkdown, sanitizeHTML, setKnownHTML } from './runtime.js';

const RESERVED_LANGUAGES = new Set([
  'chart', 'mermaid', 'cells', 'slide', 'slides', 'video', 'form', 'math', 'sdoc-app',
]);

const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const LINK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';
const CHEVRON_ICON = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 2l4 3-4 3"/></svg>';

let instanceNumber = 0;

function normalizeOptions(options) {
  const source = options && typeof options === 'object' ? options : {};
  const sections = source.sections && typeof source.sections === 'object'
    ? source.sections
    : {};
  const controls = source.controls && typeof source.controls === 'object'
    ? source.controls
    : {};
  return {
    navigation: source.navigation !== false,
    sections: {
      collapsible: sections.collapsible !== false,
      defaultOpen: sections.defaultOpen !== false,
    },
    controls: {
      copy: controls.copy !== false,
      fullscreen: controls.fullscreen !== false,
      download: controls.download !== false,
    },
  };
}

function resolveTarget(target) {
  if (typeof target === 'string') {
    const element = document.querySelector(target);
    if (!element) throw new Error('SmallDocs render target was not found: ' + target);
    return element;
  }
  if (target && target.nodeType === 1) return target;
  throw new TypeError('SmallDocs render target must be a selector or an Element');
}

function abortError() {
  try {
    return new DOMException('A newer SmallDocs render replaced this one', 'AbortError');
  } catch (_) {
    const error = new Error('A newer SmallDocs render replaced this one');
    error.name = 'AbortError';
    return error;
  }
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function markdownRenderer() {
  const renderer = createMarkedRenderer();
  renderer.code = function (source, info) {
    const fenceInfo = String(info || '').trim();
    const language = (fenceInfo.split(/\s+/)[0] || '').toLowerCase();
    const className = language ? ' class="language-' + escapeAttribute(language) + '"' : '';
    return '<pre data-sdocs-fence="' + escapeAttribute(fenceInfo) + '"><code'
      + className + '>' + escapeAttribute(source) + '</code></pre>\n';
  };
  return renderer;
}

function parseDocument(markdown, assets) {
  const parsed = assets.yaml.parseFrontMatter(String(markdown == null ? '' : markdown));
  const html = parseMarkdown(parsed.body, { renderer: markdownRenderer() });
  const safe = sanitizeHTML(html);
  return { body: parsed.body, meta: parsed.meta || {}, html: safe };
}

function applyDocumentStyles(context) {
  context.root.removeAttribute('style');
  const styles = context.meta && context.meta.styles;
  if (!styles || !context.assets.styles) return;
  const mapped = context.assets.styles.stylesToControls(styles);
  const controls = mapped.controls || {};
  Object.keys(controls).forEach((controlId) => {
    const pairs = context.assets.styles.controlToCssVars(controlId, controls[controlId], controls) || [];
    pairs.forEach((pair) => context.root.style.setProperty(pair[0], pair[1]));
  });
}

function uniqueHeadingId(context, text, counts) {
  const base = context.assets.slugify.slugify(text) || 'section';
  const count = counts.get(base) || 0;
  counts.set(base, count + 1);
  return context.id + '--' + base + (count ? '-' + count : '');
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    button.dataset.copied = 'true';
    setTimeout(() => delete button.dataset.copied, 1200);
  } catch (_) {
    button.dataset.copyFailed = 'true';
  }
}

function iconButton(className, label, icon) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'smalldocs-control ' + className;
  button.setAttribute('aria-label', label);
  button.title = label;
  setKnownHTML(button, icon);
  return button;
}

function sectionSource(markdown, headingText, level, occurrence) {
  const lines = markdown.split('\n');
  let fence = null;
  let seen = 0;
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const fenceMatch = lines[index].match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fence === fenceMatch[1][0]) fence = null;
      continue;
    }
    if (fence) continue;
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    if (match[1].length === level && match[2] === headingText) {
      if (seen === occurrence) {
        start = index;
        break;
      }
      seen += 1;
    }
  }
  if (start < 0) return markdown;
  let end = lines.length;
  fence = null;
  for (let index = start + 1; index < lines.length; index += 1) {
    const fenceMatch = lines[index].match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fence === fenceMatch[1][0]) fence = null;
      continue;
    }
    if (fence) continue;
    const match = lines[index].match(/^(#{1,6})\s+/);
    if (match && match[1].length <= level) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trimEnd();
}

function decorateHeadings(context) {
  const counts = new Map();
  const sourceCounts = new Map();
  const headings = Array.from(context.root.querySelectorAll('h1, h2, h3, h4, h5, h6'));
  headings.forEach((heading) => {
    const text = heading.textContent.trim();
    const level = Number(heading.tagName.slice(1));
    const sourceKey = level + ':' + text;
    const sourceOccurrence = sourceCounts.get(sourceKey) || 0;
    sourceCounts.set(sourceKey, sourceOccurrence + 1);
    heading.id = uniqueHeadingId(context, text, counts);
    heading.dataset.smalldocsHeadingText = text;

    const tools = document.createElement('span');
    tools.className = 'smalldocs-heading-tools';
    if (context.options.controls.copy) {
      const copy = iconButton('smalldocs-heading-copy', 'Copy section', COPY_ICON);
      copy.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        copyText(sectionSource(context.body, text, level, sourceOccurrence), copy);
      });
      tools.appendChild(copy);
    }
    const link = document.createElement('a');
    link.className = 'smalldocs-heading-link';
    link.href = '#' + heading.id;
    link.setAttribute('aria-label', 'Link to ' + text);
    link.title = 'Link to section';
    setKnownHTML(link, LINK_ICON);
    tools.appendChild(link);
    heading.appendChild(tools);
  });
  return headings;
}

function setSectionOpen(section, open) {
  const body = section.querySelector(':scope > .smalldocs-section-body');
  const toggle = section.querySelector(':scope > h2 .smalldocs-section-toggle, :scope > h3 .smalldocs-section-toggle, :scope > h4 .smalldocs-section-toggle');
  if (!body || !toggle) return;
  body.hidden = !open;
  section.classList.toggle('is-open', open);
  toggle.setAttribute('aria-expanded', String(open));
}

function buildSections(context) {
  if (!context.options.sections.collapsible) return;
  const children = Array.from(context.root.children);
  const fragment = document.createDocumentFragment();
  const stack = [{ level: 1, body: fragment }];

  children.forEach((child) => {
    const match = child.tagName && child.tagName.match(/^H([2-4])$/);
    if (!match) {
      stack[stack.length - 1].body.appendChild(child);
      return;
    }
    const level = Number(match[1]);
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    const section = document.createElement('section');
    section.className = 'smalldocs-section';
    const body = document.createElement('div');
    body.className = 'smalldocs-section-body';
    const toggle = iconButton('smalldocs-section-toggle', 'Toggle ' + child.dataset.smalldocsHeadingText, CHEVRON_ICON);
    toggle.setAttribute('aria-expanded', String(context.options.sections.defaultOpen));
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setSectionOpen(section, body.hidden);
    });
    child.insertBefore(toggle, child.firstChild);
    section.append(child, body);
    stack[stack.length - 1].body.appendChild(section);
    stack.push({ level, body });
    setSectionOpen(section, context.options.sections.defaultOpen);
  });
  context.root.replaceChildren(fragment);
}

function buildNavigation(context) {
  context.navigation.replaceChildren();
  context.navigation.hidden = !context.options.navigation;
  if (!context.options.navigation) return;
  const title = document.createElement('div');
  title.className = 'smalldocs-navigation-title';
  title.textContent = 'On this page';
  const list = document.createElement('ol');
  context.root.querySelectorAll('h2, h3').forEach((heading) => {
    const item = document.createElement('li');
    item.className = 'level-' + heading.tagName.slice(1);
    const link = document.createElement('a');
    link.href = '#' + heading.id;
    link.textContent = heading.dataset.smalldocsHeadingText || heading.textContent;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const section = heading.closest('.smalldocs-section');
      if (section) setSectionOpen(section, true);
      heading.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    item.appendChild(link);
    list.appendChild(item);
  });
  context.navigation.append(title, list);
}

function tableRows(table) {
  return Array.from(table.rows).map((row) => Array.from(row.cells).map((cell) => {
    const clone = cell.cloneNode(true);
    clone.querySelectorAll('.smalldocs-table-tools').forEach((node) => node.remove());
    return clone.textContent.trim();
  }));
}

function csvValue(value) {
  return /[",\n\r]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

function decorateTables(context) {
  context.root.querySelectorAll('table').forEach((table) => {
    const scroller = document.createElement('div');
    scroller.className = 'smalldocs-table-scroll';
    table.parentNode.insertBefore(scroller, table);
    scroller.appendChild(table);
    if (!context.options.controls.copy) return;
    const tools = document.createElement('div');
    tools.className = 'smalldocs-table-tools';
    const copy = iconButton('smalldocs-table-copy', 'Copy table as CSV', COPY_ICON);
    const label = document.createElement('span');
    label.textContent = 'CSV';
    copy.appendChild(label);
    copy.addEventListener('click', () => {
      const csv = tableRows(table).map((row) => row.map(csvValue).join(',')).join('\n');
      copyText(csv, copy);
    });
    tools.appendChild(copy);
    scroller.insertBefore(tools, table);
  });
}

function codeLanguage(code) {
  const match = (code.className || '').match(/(?:^|\s)language-([\w+#-]+)/i);
  return match ? match[1].toLowerCase() : '';
}

function decorateBlockquotes(context) {
  if (!context.options.controls.copy) return;
  context.root.querySelectorAll('blockquote').forEach((quote) => {
    quote.classList.add('smalldocs-copyable-quote');
    const copy = iconButton('smalldocs-quote-copy', 'Copy quote', COPY_ICON);
    copy.addEventListener('click', () => copyText(quote.innerText.trim(), copy));
    quote.appendChild(copy);
  });
}

const featureDefinitions = [
  { name: 'code', detect: (root) => Array.from(root.querySelectorAll('pre code')).some((code) => !RESERVED_LANGUAGES.has(codeLanguage(code))) },
  { name: 'math', detect: (root) => root.querySelector('.sdocs-math-display, .sdocs-math-inline') },
  { name: 'video', detect: (root) => root.querySelector('code.language-video') },
  { name: 'charts', detect: (root) => root.querySelector('code.language-chart') },
  { name: 'mermaid', detect: (root) => root.querySelector('code.language-mermaid') },
  { name: 'cells', detect: (root) => root.querySelector('code.language-cells') },
  { name: 'slides', detect: (root) => root.querySelector('code.language-slide, code.language-slides') },
  { name: 'highlight', detect: (root) => Array.from(root.querySelectorAll('pre code[class*="language-"]')).some((code) => !RESERVED_LANGUAGES.has(codeLanguage(code))) },
];

function featureFallback(context, feature, error) {
  const selectors = {
    math: '.sdocs-math-display, .sdocs-math-inline',
    video: 'code.language-video',
    charts: 'code.language-chart',
    mermaid: 'code.language-mermaid',
    cells: 'code.language-cells',
    slides: 'code.language-slide, code.language-slides',
  };
  const selector = selectors[feature.name];
  if (!selector) return;
  context.root.querySelectorAll(selector).forEach((node) => {
    if (feature.name === 'math') {
      node.textContent = node.dataset.tex || node.textContent;
      return;
    }
    const pre = node.closest('pre');
    if (!pre) return;
    const fallback = document.createElement('pre');
    fallback.className = 'smalldocs-feature-error';
    fallback.textContent = feature.name + ' could not render: ' + error.message
      + '\n\n' + node.textContent;
    pre.replaceWith(fallback);
  });
}

async function mountFeatures(context) {
  const selected = featureDefinitions.filter((feature) => feature.detect(context.root));
  context.features = selected.map((feature) => feature.name);
  await Promise.all(selected.map(async (feature) => {
    try {
      const module = await import('./features/' + feature.name + '.js');
      if (context.signal.aborted) throw abortError();
      const cleanup = await module.mount(context);
      if (typeof cleanup === 'function') context.cleanups.push(cleanup);
    } catch (error) {
      if (context.signal.aborted) throw abortError();
      featureFallback(context, feature, error);
    }
  }));
}

function createContext(mount, options) {
  const id = 'sdocs-' + (++instanceNumber).toString(36);
  const shell = document.createElement('div');
  shell.className = 'smalldocs-sdk-view';
  shell.dataset.smalldocsInstance = id;
  mount.replaceChildren(shell);
  return {
    id,
    mount,
    shell,
    options,
    generation: 0,
    active: null,
  };
}

function runCleanups(context) {
  closeActiveOverlay(context);
  const cleanups = context.cleanups.splice(0).reverse();
  cleanups.forEach((cleanup) => {
    try { cleanup(); } catch (_) {}
  });
}

async function updateContext(context, markdown) {
  if (context.active) {
    context.active.controller.abort();
    runCleanups(context.active);
  }
  const generation = ++context.generation;
  const controller = new AbortController();
  const parsed = parseDocument(markdown, context.assets);
  const navigation = document.createElement('nav');
  navigation.className = 'smalldocs-navigation';
  navigation.setAttribute('aria-label', 'Document navigation');
  const root = document.createElement('article');
  root.className = 'smalldocs-document sdoc-reader';
  root.dataset.smalldocsInstance = context.id;
  root.innerHTML = parsed.html;
  const state = {
    id: context.id,
    mount: context.mount,
    shell: context.shell,
    options: context.options,
    assets: context.assets,
    generation,
    controller,
    signal: controller.signal,
    cleanups: [],
    navigation,
    root,
    body: parsed.body,
    meta: parsed.meta,
    features: [],
  };
  context.active = state;
  context.shell.replaceChildren(navigation, root);
  applyDocumentStyles(state);
  decorateHeadings(state);
  buildSections(state);
  decorateTables(state);
  decorateBlockquotes(state);
  buildNavigation(state);
  await mountFeatures(state);
  if (state.signal.aborted || context.active !== state || generation !== context.generation) throw abortError();
  state.root.dispatchEvent(new CustomEvent('smalldocs:rendered', {
    bubbles: true,
    detail: { instanceId: state.id, features: state.features.slice() },
  }));
}

export async function createRenderer(target, markdown, rawOptions) {
  if (!/^https?:$/.test(location.protocol)) {
    throw new Error('SmallDocs rendering requires an http or https host page');
  }
  const assets = await ensureCoreAssets();
  const mount = resolveTarget(target);
  const context = createContext(mount, normalizeOptions(rawOptions));
  context.assets = assets;
  let destroyed = false;

  const view = {
    get element() { return context.active ? context.active.root : null; },
    get features() { return context.active ? context.active.features.slice() : []; },
    async update(nextMarkdown) {
      if (destroyed) throw new Error('SmallDocs renderer has been destroyed');
      await updateContext(context, String(nextMarkdown == null ? '' : nextMarkdown));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (context.active) {
        context.active.controller.abort();
        runCleanups(context.active);
      }
      context.shell.remove();
    },
  };

  await view.update(markdown);
  return view;
}
