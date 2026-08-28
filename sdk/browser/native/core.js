import { ensureCoreAssets } from './assets.js';
import { closeActiveOverlay } from './overlay.js';
import { createRenderer as createMarkedRenderer, parseMarkdown, sanitizeHTML, setKnownHTML } from './runtime.js';

const RESERVED_LANGUAGES = new Set([
  'chart', 'mermaid', 'cells', 'slide', 'slides', 'video', 'form', 'math', 'sdoc-app',
]);

let instanceNumber = 0;
const SDK_VERSION = '0.2.0';

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
    const code = String(source || '').endsWith('\n') ? String(source || '') : String(source || '') + '\n';
    return '<pre data-sdocs-fence="' + escapeAttribute(fenceInfo) + '"><code'
      + className + '>' + escapeAttribute(code) + '</code></pre>\n';
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
      if (context.prose) context.prose.openHeading(heading);
      heading.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    item.appendChild(link);
    list.appendChild(item);
  });
  context.navigation.append(title, list);
}

function codeLanguage(code) {
  const match = (code.className || '').match(/(?:^|\s)language-([\w+#-]+)/i);
  return match ? match[1].toLowerCase() : '';
}

const featureDefinitions = [
  { name: 'code', detect: (root) => Array.from(root.querySelectorAll('pre code')).some((code) => !RESERVED_LANGUAGES.has(codeLanguage(code))) },
  { name: 'math', detect: (root) => root.querySelector('.sdocs-math-display, .sdocs-math-inline') },
  { name: 'video', detect: (root) => root.querySelector('code.language-video') },
  { name: 'charts', detect: (root) => root.querySelector('code.language-chart') },
  { name: 'mermaid', detect: (root) => root.querySelector('code.language-mermaid') },
  { name: 'cells', detect: (root) => root.querySelector('code.language-cells') },
  { name: 'slides', detect: (root) => root.querySelector('code.language-slide, code.language-slides') },
  { name: 'apps', detect: (root) => root.querySelector('code.language-sdoc-app') },
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
    apps: 'code.language-sdoc-app',
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
  shell.dataset.smalldocsSdkVersion = SDK_VERSION;
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

function runCleanups(context, reason) {
  closeActiveOverlay(context, reason, { restoreFocus: false });
  const cleanups = context.cleanups.splice(0).reverse();
  cleanups.forEach((cleanup) => {
    try { cleanup(reason); } catch (_) {}
  });
}

async function updateContext(context, markdown) {
  if (context.active) {
    if (context.active.prose) {
      context.openSectionIds = context.active.prose.captureOpenIds(context.active.root);
      context.sectionIds = context.active.prose.sectionIds();
      context.hasSectionState = true;
    }
    context.active.controller.abort();
    runCleanups(context.active, 'update');
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
  const prose = state.assets.prose.create({
    root: state.root,
    markdown: state.body,
    slugify: state.assets.slugify.slugify,
    idPrefix: state.id + '--',
    sections: state.options.sections,
    controls: state.options.controls,
    openSectionIds: context.openSectionIds,
    sectionIds: context.sectionIds,
    restoreSectionState: context.hasSectionState === true,
    setHTML: setKnownHTML,
    isActive: () => !state.signal.aborted && context.active === state,
  });
  state.prose = prose;
  prose.attach(state.root);
  state.cleanups.push(() => prose.destroy());
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
        runCleanups(context.active, 'destroy');
      }
      context.shell.remove();
    },
  };

  await view.update(markdown);
  return view;
}
