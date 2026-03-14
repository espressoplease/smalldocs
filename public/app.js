const GOOGLE_FONTS = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Source Sans 3',
  'Oswald', 'Raleway', 'Poppins', 'Merriweather', 'Ubuntu',
  'Nunito', 'Playfair Display', 'Roboto Slab', 'PT Sans', 'Lora',
  'Mulish', 'Noto Sans', 'Rubik', 'Dosis',
  'Josefin Sans', 'PT Serif', 'Libre Franklin', 'Crimson Text'
];

// ── Dark mode ──────────────────────────────────

const LIGHT_DEFAULTS = {
  colorDefault:  '#1c1917',
  codeBg:        '#f4f1ed',
  codeColor:     '#6b21a8',
  linkColor:     '#2563eb',
  bqBorderColor: '#2563eb',
  bqColor:       '#6b6560',
};

const DARK_DEFAULTS = {
  colorDefault:  '#e7e5e2',
  codeBg:        '#1a1816',
  codeColor:     '#b8a99a',
  linkColor:     '#60a5fa',
  bqBorderColor: '#60a5fa',
  bqColor:       '#a8a29e',
};

function getThemeDefaults() {
  return document.documentElement.dataset.theme === 'dark' ? DARK_DEFAULTS : LIGHT_DEFAULTS;
}

function getColorDefault() {
  return getThemeDefaults().colorDefault;
}

function getPreferredTheme() {
  const stored = localStorage.getItem('sdocs-theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const SUN_ICON = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
const MOON_ICON = '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>';

function updateThemeIcon(theme) {
  const icon = document.getElementById('icon-theme');
  if (icon) icon.innerHTML = theme === 'dark' ? SUN_ICON : MOON_ICON;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('sdocs-theme', theme);
  updateThemeIcon(theme);
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  applyTheme(current === 'dark' ? 'light' : 'dark');
  updateDefaultColors();
}

function updateDefaultColors() {
  const defaults = getThemeDefaults();
  if (typeof overriddenColors !== 'undefined') {
    if (!overriddenColors.has('ctrl-color')) {
      setColorValue('ctrl-color', defaults.colorDefault, false);
    }
    // Update standalone color defaults for reset buttons
    const standaloneMap = {
      'ctrl-link-color':      defaults.linkColor,
      'ctrl-code-bg':         defaults.codeBg,
      'ctrl-code-color':      defaults.codeColor,
      'ctrl-bq-border-color': defaults.bqBorderColor,
      'ctrl-bq-color':        defaults.bqColor,
    };
    for (const [ctrlId, val] of Object.entries(standaloneMap)) {
      if (!overriddenColors.has(ctrlId)) {
        const el = document.getElementById(ctrlId);
        if (el) {
          el.value = val;
          const allVals = readAllControlValues();
          SDocStyles.controlToCssVars(ctrlId, val, allVals)
            .forEach(a => renderedEl.style.setProperty(a.cssVar, a.value));
        }
      }
    }
    syncAll('controls');
  }
}

applyTheme(getPreferredTheme());

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
  if (!localStorage.getItem('sdocs-theme')) {
    applyTheme(e.matches ? 'dark' : 'light');
    updateDefaultColors();
  }
});

const loadedFonts = new Set(['Inter']);

function loadGoogleFont(family) {
  if (loadedFonts.has(family)) return;
  loadedFonts.add(family);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;600;700&display=swap`;
  document.head.appendChild(link);
}

function populateFontSelect(sel, includeInherit) {
  if (includeInherit) {
    const opt = document.createElement('option');
    opt.value = 'inherit';
    opt.textContent = '— Same as body —';
    sel.appendChild(opt);
  }
  GOOGLE_FONTS.forEach(f => {
    const opt = document.createElement('option');
    opt.value = `'${f}', sans-serif`;
    opt.textContent = f;
    sel.appendChild(opt);
  });
  [['Georgia, serif','Georgia'],['Times New Roman, serif','Times New Roman'],
   ['system-ui, sans-serif','System UI']].forEach(([v,l]) => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = l;
    sel.appendChild(opt);
  });
}

populateFontSelect(document.getElementById('ctrl-font-family'), false);
document.getElementById('ctrl-font-family').value = "'Inter', sans-serif";
populateFontSelect(document.getElementById('ctrl-h-font-family'), true);

// YAML front matter parsing

function parseFrontMatter(text) {
  const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const m = text.match(FM_RE);
  if (!m) return { meta: {}, body: text };
  return { meta: parseSimpleYaml(m[1]), body: text.slice(m[0].length) };
}

function parseSimpleYaml(str) {
  const result = {};
  const lines = str.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const km = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (!km) { i++; continue; }
    const key = km[1], rest = km[2].trim();
    if (rest.startsWith('{')) {
      result[key] = parseInlineObject(rest); i++;
    } else if (rest === '') {
      const nested = {}; i++;
      while (i < lines.length && /^  /.test(lines[i])) {
        const nl = lines[i].trim();
        const nm = nl.match(/^(\w[\w-]*):\s*(.*)/);
        if (nm) nested[nm[1]] = nm[2].trim().startsWith('{')
          ? parseInlineObject(nm[2].trim()) : parseScalar(nm[2].trim());
        i++;
      }
      result[key] = nested;
    } else { result[key] = parseScalar(rest); i++; }
  }
  return result;
}

function parseInlineObject(str) {
  const inner = str.replace(/^\{/, '').replace(/\}$/, '').trim();
  const obj = {};
  inner.split(',').forEach(pair => {
    const m = pair.trim().match(/^(\w[\w-]*):\s*(.*)/);
    if (m) obj[m[1]] = parseScalar(m[2].trim());
  });
  return obj;
}

function parseScalar(v) {
  v = v.trim().replace(/^["']|["']$/g, '');
  const n = Number(v);
  return (!isNaN(n) && v !== '') ? n : v;
}

function serializeFrontMatter(meta) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === 'object' && v !== null) {
      lines.push(`${k}:`);
      for (const [sk, sv] of Object.entries(v)) {
        if (typeof sv === 'object' && sv !== null) {
          const inner = Object.entries(sv).map(([a,b]) => `${a}: ${JSON.stringify(b)}`).join(', ');
          lines.push(`  ${sk}: { ${inner} }`);
        } else { lines.push(`  ${sk}: ${JSON.stringify(sv)}`); }
      }
    } else { lines.push(`${k}: ${JSON.stringify(v)}`); }
  }
  lines.push('---');
  return lines.join('\n');
}

// State

let currentBody = '';
let currentMeta = {};

// Render

const renderedEl = document.getElementById('rendered');
const rawEl = document.getElementById('raw');

const LINK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
const CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

function slugify(text) {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function buildSectionUrl(slug) {
  const base = window.location.origin + window.location.pathname;
  const hash = window.location.hash.slice(1);
  const params = hash ? new URLSearchParams(hash) : new URLSearchParams();
  params.delete('sec');
  params.set('sec', slug);
  return base + '#' + params.toString();
}

function render() {
  renderedEl.innerHTML = marked.parse(currentBody);

  const slugCounts = {};
  const tocItems = [];
  renderedEl.querySelectorAll('h1, h2, h3, h4').forEach(h => {
    let slug = slugify(h.textContent);
    if (!slug) slug = 'section';
    if (slugCounts[slug] != null) {
      slugCounts[slug]++;
      slug = slug + '-' + slugCounts[slug];
    } else {
      slugCounts[slug] = 0;
    }
    h.id = slug;
    tocItems.push({ slug, text: h.textContent, level: parseInt(h.tagName[1]) });

    const anchor = document.createElement('a');
    anchor.className = 'header-anchor';
    anchor.innerHTML = LINK_SVG;
    anchor.title = 'Copy link to section';
    anchor.addEventListener('click', e => {
      e.preventDefault();
      navigator.clipboard.writeText(buildSectionUrl(slug)).then(() => {
        anchor.innerHTML = CHECK_SVG;
        setTimeout(() => { anchor.innerHTML = LINK_SVG; }, 1500);
      });
    });
    h.appendChild(anchor);
  });

  // Generate TOC (only if 2+ headings)
  if (tocItems.length >= 2) {
    const nav = document.createElement('nav');
    nav.className = 'sdocs-toc';
    const title = document.createElement('div');
    title.className = 'sdocs-toc-title';
    title.textContent = 'Contents';
    nav.appendChild(title);

    const minLevel = Math.min(...tocItems.map(t => t.level));
    const rootUl = document.createElement('ul');
    tocItems.forEach(item => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = item.text;
      a.dataset.sec = item.slug;
      a.addEventListener('click', e => {
        e.preventDefault();
        const target = document.getElementById(item.slug);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      li.appendChild(a);
      const depth = item.level - minLevel;
      let parent = rootUl;
      for (let i = 0; i < depth; i++) {
        let nested = parent.lastElementChild?.querySelector('ul');
        if (!nested) {
          nested = document.createElement('ul');
          (parent.lastElementChild || parent).appendChild(nested);
        }
        parent = nested;
      }
      parent.appendChild(li);
    });
    nav.appendChild(rootUl);
    renderedEl.insertBefore(nav, renderedEl.firstChild);
  }

  renderedEl.querySelectorAll('pre').forEach(pre => {
    const wrapper = document.createElement('div');
    wrapper.className = 'pre-wrapper';
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    btn.title = 'Copy code';
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code');
      navigator.clipboard.writeText(code ? code.textContent : pre.textContent).then(() => {
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(() => {
          btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        }, 1500);
      });
    });
    wrapper.appendChild(btn);
  });
}

// CSS var updates

function applyCtrl(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const v = el.value;

  if (id === 'ctrl-font-family' || id === 'ctrl-h-font-family') {
    const name = v.replace(/['"]/g,'').split(',')[0].trim();
    if (GOOGLE_FONTS.includes(name)) loadGoogleFont(name);
  }

  const allVals = readAllControlValues();
  SDocStyles.controlToCssVars(id, v, allVals)
    .forEach(({cssVar, value}) => renderedEl.style.setProperty(cssVar, value));
  syncAll('controls');
}

function readAllControlValues() {
  const vals = {};
  Object.keys(SDocStyles.CTRL_CSS_MAP).forEach(id => {
    const el = document.getElementById(id);
    if (el) vals[id] = el.value;
  });
  Object.keys(SDocStyles.COLOR_VAR_MAP).forEach(id => {
    const el = document.getElementById(id);
    if (el) vals[id] = el.value;
  });
  return vals;
}

function linkRangeNum(rangeId, numId) {
  const r = document.getElementById(rangeId);
  const n = document.getElementById(numId);
  r.addEventListener('input', () => { n.value = r.value; applyCtrl(numId); });
  n.addEventListener('input', () => { r.value = n.value; applyCtrl(numId); });
}

SDocStyles.RANGE_NUM_PAIRS.forEach(([r,n]) => linkRangeNum(r,n));

const STANDALONE_COLOR_IDS = new Set([
  'ctrl-link-color','ctrl-code-bg','ctrl-code-color','ctrl-bq-border-color','ctrl-bq-color',
]);

[
  'ctrl-font-family','ctrl-h-font-family',
  'ctrl-h1-weight','ctrl-h2-weight','ctrl-h3-weight','ctrl-h4-weight',
  'ctrl-link-color','ctrl-link-decoration',
  'ctrl-code-font','ctrl-code-bg','ctrl-code-color',
  'ctrl-bq-border-color','ctrl-bq-color',
].forEach(id => {
  const handler = () => { if (STANDALONE_COLOR_IDS.has(id)) overriddenColors.add(id); applyCtrl(id); };
  document.getElementById(id).addEventListener('input',  handler);
  document.getElementById(id).addEventListener('change', handler);
});

// Color cascade

const COLOR_VAR = SDocStyles.COLOR_VAR_MAP;
const COLOR_CHILDREN = SDocStyles.COLOR_CASCADE;

const overriddenColors = new Set();

function setColorValue(ctrlId, value, userAction = false) {
  if (userAction) overriddenColors.add(ctrlId);
  renderedEl.style.setProperty(COLOR_VAR[ctrlId], value);
  const ctrl = document.getElementById(ctrlId);
  if (ctrl) ctrl.value = value;
  for (const childId of (COLOR_CHILDREN[ctrlId] || [])) {
    if (!overriddenColors.has(childId)) {
      setColorValue(childId, value, false);
    }
  }
}

function resetColorValue(ctrlId) {
  overriddenColors.delete(ctrlId);
  setColorValue(ctrlId, getColorDefault(), false);
}

Object.keys(COLOR_VAR).forEach(ctrlId => {
  const el = document.getElementById(ctrlId);
  if (!el) return;
  el.addEventListener('input',  () => { setColorValue(ctrlId, el.value, true); syncAll('controls'); });
  el.addEventListener('change', () => { setColorValue(ctrlId, el.value, true); syncAll('controls'); });
});

document.getElementById('reset-color').addEventListener('click',      () => { overriddenColors.delete('ctrl-color'); setColorValue('ctrl-color', getColorDefault(), false); syncAll('controls'); });
document.getElementById('reset-h-color').addEventListener('click',    () => { resetColorValue('ctrl-h-color'); syncAll('controls'); });
document.getElementById('reset-h1-color').addEventListener('click',   () => { resetColorValue('ctrl-h1-color'); syncAll('controls'); });
document.getElementById('reset-h2-color').addEventListener('click',   () => { resetColorValue('ctrl-h2-color'); syncAll('controls'); });
document.getElementById('reset-h3-color').addEventListener('click',   () => { resetColorValue('ctrl-h3-color'); syncAll('controls'); });
document.getElementById('reset-h4-color').addEventListener('click',   () => { resetColorValue('ctrl-h4-color'); syncAll('controls'); });
document.getElementById('reset-p-color').addEventListener('click',    () => { resetColorValue('ctrl-p-color'); syncAll('controls'); });
document.getElementById('reset-list-color').addEventListener('click', () => { resetColorValue('ctrl-list-color'); syncAll('controls'); });

function getStandaloneDefault(ctrlId) {
  const d = getThemeDefaults();
  const map = {
    'ctrl-link-color':      d.linkColor,
    'ctrl-code-bg':         d.codeBg,
    'ctrl-code-color':      d.codeColor,
    'ctrl-bq-border-color': d.bqBorderColor,
    'ctrl-bq-color':        d.bqColor,
  };
  return map[ctrlId];
}

['ctrl-link-color','ctrl-code-bg','ctrl-code-color','ctrl-bq-border-color','ctrl-bq-color'].forEach(ctrlId => {
  const btnId = 'reset-' + ctrlId.replace('ctrl-', '');
  document.getElementById(btnId).addEventListener('click', () => {
    const defaultVal = getStandaloneDefault(ctrlId);
    const el = document.getElementById(ctrlId);
    overriddenColors.delete(ctrlId);
    el.value = defaultVal;
    const assignments = SDocStyles.controlToCssVars(ctrlId, defaultVal, readAllControlValues());
    assignments.forEach(a => renderedEl.style.setProperty(a.cssVar, a.value));
    syncAll('controls');
  });
});

// Apply styles from meta → controls

function setCtrl(id, val) {
  if (val === undefined || val === null) return;
  const el = document.getElementById(id);
  if (!el) return;
  el.value = val;
  const rangeId = id.replace(/-num$/, '-range');
  const rng = document.getElementById(rangeId);
  if (rng) rng.value = val;
  applyCtrl(id);
}

function applyStylesFromMeta(s) {
  if (!s) return;
  // Suppress syncAll during batch updates to avoid capturing partial state
  const wasSyncing = _syncing;
  _syncing = true;

  const { controls, overriddenColors: newOverridden } = SDocStyles.stylesToControls(s);

  // Font family selects need special handling to match bare names against <option> values
  for (const [styleKey, ctrlId] of [['fontFamily', 'ctrl-font-family'], ['headers.fontFamily', 'ctrl-h-font-family']]) {
    const fontName = styleKey === 'fontFamily' ? s.fontFamily : (s.headers || {}).fontFamily;
    if (fontName) {
      const sel = document.getElementById(ctrlId);
      const match = [...sel.options].find(o =>
        o.value.replace(/['"]/g,'').split(',')[0].trim() === fontName ||
        o.textContent === fontName
      );
      if (match) { sel.value = match.value; applyCtrl(ctrlId); }
    }
  }

  for (const [id, val] of Object.entries(controls)) {
    if (id === 'ctrl-font-family' || id === 'ctrl-h-font-family') continue;
    if (SDocStyles.COLOR_VAR_MAP[id]) continue;
    setCtrl(id, val);
  }

  overriddenColors.clear();
  setColorValue('ctrl-color', getColorDefault(), false);

  for (const id of newOverridden) {
    overriddenColors.add(id);
    setColorValue(id, controls[id], true);
  }

  _syncing = wasSyncing;
}

function collectStyles() {
  return SDocStyles.collectStyles(readAllControlValues(), overriddenColors);
}

// Load content

function setStatus(msg) {
  document.getElementById('status-text').textContent = msg;
}

function loadText(text, filename) {
  const { meta, body } = parseFrontMatter(text);
  currentMeta = meta;
  currentBody = body;
  render();
  if (meta.styles) applyStylesFromMeta(meta.styles);
  currentMeta = { ...currentMeta, styles: collectStyles() };
  rawEl.value = serializeFrontMatter(currentMeta) + '\n' + currentBody;
  setStatus(filename ? `Loaded: ${filename}` : 'Ready');
  syncAll('load');
}

// Auto-save to URL hash

let _hashTimer = null;

// When true, we're showing the default welcome doc — keep a clean URL (no hash).
let _isDefaultState = true;

function updateHash() {
  clearTimeout(_hashTimer);
  _hashTimer = setTimeout(() => {
    if (_isDefaultState) {
      history.replaceState(null, '', window.location.pathname);
      return;
    }
    const meta = { ...currentMeta, styles: collectStyles() };
    const full = serializeFrontMatter(meta) + '\n' + currentBody;
    const params = new URLSearchParams();
    params.set('md', encodeURIComponent(btoa(unescape(encodeURIComponent(full)))));
    history.replaceState(null, '', '#' + params.toString());
  }, 400);
}

// State sync — keeps editor, rendered view, controls, and URL hash in lockstep

let _syncing = false;
let _rawSyncTimer = null;

function syncAll(source) {
  if (_syncing) return;
  _syncing = true;
  try {
    if (source === 'controls') {
      _isDefaultState = false;
      currentMeta = { ...currentMeta, styles: collectStyles() };
      rawEl.value = serializeFrontMatter(currentMeta) + '\n' + currentBody;
      updateHash();
    } else if (source === 'raw') {
      _isDefaultState = false;
      const { meta, body } = parseFrontMatter(rawEl.value);
      currentMeta = meta;
      currentBody = body;
      render();
      if (meta.styles) applyStylesFromMeta(meta.styles);
      updateHash();
    } else if (source === 'load') {
      updateHash();
    }
  } finally {
    _syncing = false;
  }
}

// Drag & drop

const contentArea = document.getElementById('content-area');

contentArea.addEventListener('dragover', e => {
  e.preventDefault();
  contentArea.classList.add('drag-over');
});
['dragleave','dragend'].forEach(ev =>
  contentArea.addEventListener(ev, () => contentArea.classList.remove('drag-over'))
);
contentArea.addEventListener('drop', e => {
  e.preventDefault();
  contentArea.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => { _isDefaultState = false; loadText(ev.target.result, file.name); };
  reader.readAsText(file);
});

rawEl.addEventListener('input', () => {
  clearTimeout(_rawSyncTimer);
  _rawSyncTimer = setTimeout(() => syncAll('raw'), 300);
});

// Mode toggle (read / style / raw)

function setMode(mode) {
  renderedEl.style.display = mode === 'raw' ? 'none' : '';
  rawEl.style.display      = mode === 'raw' ? 'block' : 'none';

  document.getElementById('btn-read').classList.toggle('active',  mode === 'read');
  document.getElementById('btn-style').classList.toggle('active', mode === 'style');
  document.getElementById('btn-raw').classList.toggle('active',   mode === 'raw');

  document.body.classList.toggle('read-mode', mode === 'read');
  document.body.classList.toggle('raw-mode', mode === 'raw');
  document.body.classList.remove('mobile-sheet-open');
}

document.getElementById('btn-theme').addEventListener('click', toggleTheme);
document.getElementById('btn-read').addEventListener('click',  () => setMode('read'));
document.getElementById('btn-style').addEventListener('click', () => setMode('style'));
document.getElementById('btn-raw').addEventListener('click',   () => setMode('raw'));

document.getElementById('right-header').addEventListener('click', () => {
  if (window.innerWidth <= 768) {
    document.body.classList.toggle('mobile-sheet-open');
  }
});

function resetAllStyles() {
  overriddenColors.clear();
  setColorValue('ctrl-color', getColorDefault(), false);
  // Set standalone color controls to theme-appropriate defaults
  STANDALONE_COLOR_IDS.forEach(ctrlId => {
    const el = document.getElementById(ctrlId);
    if (el) el.value = getStandaloneDefault(ctrlId);
  });
  document.querySelectorAll('#right input, #right select').forEach(el => {
    if (STANDALONE_COLOR_IDS.has(el.id)) return; // already set above
    if (el.type === 'range' || el.type === 'number') el.value = el.defaultValue;
    else if (el.tagName === 'SELECT') el.selectedIndex = [...el.options].findIndex(o => o.defaultSelected);
    else if (el.type === 'color') el.value = el.defaultValue;
  });
  ['ctrl-font-family','ctrl-base-size-num','ctrl-line-height-num',
   'ctrl-h-font-family','ctrl-h-scale-num','ctrl-h-mb-num',
   'ctrl-h1-size-num','ctrl-h1-weight','ctrl-h2-size-num','ctrl-h2-weight',
   'ctrl-h3-size-num','ctrl-h3-weight','ctrl-h4-size-num','ctrl-h4-weight',
   'ctrl-p-lh-num','ctrl-p-mb-num',
   'ctrl-link-color','ctrl-link-decoration',
   'ctrl-code-font','ctrl-code-bg','ctrl-code-color',
   'ctrl-bq-border-color','ctrl-bq-bw-num','ctrl-bq-size-num','ctrl-bq-color',
   'ctrl-list-spacing-num','ctrl-list-indent-num',
  ].forEach(id => applyCtrl(id));
}

document.getElementById('factory-reset-styles').addEventListener('click', () => {
  resetAllStyles();
  currentMeta = { ...currentMeta, styles: collectStyles() };
  rawEl.value = serializeFrontMatter(currentMeta) + '\n' + currentBody;
  render();
  syncAll('load');
});

document.getElementById('topbar-brand').addEventListener('click', e => {
  e.preventDefault();
  resetAllStyles();
  loadText(serializeFrontMatter({ styles: collectStyles() }) + '\n' + DEFAULT_MD);
  _isDefaultState = true;
  clearTimeout(_hashTimer);
  history.replaceState(null, '', window.location.pathname);
  setMode('style');
});

// Collapsible panels

document.querySelectorAll('.panel-header').forEach(h => {
  h.addEventListener('click', () => {
    const body = document.getElementById(h.dataset.target);
    const open = body.classList.toggle('open');
    h.classList.toggle('open', open);
  });
});
document.querySelectorAll('.sub-header').forEach(h => {
  h.addEventListener('click', () => {
    const body = document.getElementById(h.dataset.target);
    const open = body.classList.toggle('open');
    h.classList.toggle('open', open);
  });
});

// Export

function cv(name) {
  return (renderedEl.style.getPropertyValue(name) ||
          getComputedStyle(renderedEl).getPropertyValue(name)).trim();
}

function buildExportCSS() {
  const fontFamily    = cv('--md-font-family')    || "'Inter', sans-serif";
  const baseSize      = cv('--md-base-size')      || '16px';
  const lineHeight    = cv('--md-line-height')    || '1.75';
  const color         = cv('--md-color')          || '#1c1917';

  const hFontFamily   = cv('--md-h-font-family')  || 'inherit';
  const hScale        = parseFloat(cv('--md-h-scale') || '1');
  const hMB           = cv('--md-h-margin-bottom')|| '0.4em';
  const hColor        = cv('--md-h-color')        || '#0f0d0c';

  const h1Size    = `calc(${cv('--md-h1-size')    || '2.1em'} * ${hScale})`;
  const h1Color   = cv('--md-h1-color')   || hColor;
  const h1Weight  = cv('--md-h1-weight')  || '700';
  const h2Size    = `calc(${cv('--md-h2-size')    || '1.55em'} * ${hScale})`;
  const h2Color   = cv('--md-h2-color')   || hColor;
  const h2Weight  = cv('--md-h2-weight')  || '600';
  const h3Size    = `calc(${cv('--md-h3-size')    || '1.2em'} * ${hScale})`;
  const h3Color   = cv('--md-h3-color')   || hColor;
  const h3Weight  = cv('--md-h3-weight')  || '600';
  const h4Size    = `calc(${cv('--md-h4-size')    || '1.0em'} * ${hScale})`;
  const h4Color   = cv('--md-h4-color')   || hColor;
  const h4Weight  = cv('--md-h4-weight')  || '600';

  const pColor    = cv('--md-p-color')     || '#3c3733';
  const pLH       = cv('--md-p-line-height')|| lineHeight;
  const pMargin   = cv('--md-p-margin')    || '0 0 1.1em';

  const linkColor = cv('--md-link-color')  || '#2563eb';
  const linkDec   = cv('--md-link-decoration') || 'underline';

  const codeBG    = cv('--md-code-bg')     || '#f4f1ed';
  const codeColor = cv('--md-code-color')  || '#6b21a8';
  const codeFont  = cv('--md-code-font')   || "'JetBrains Mono', monospace";
  const preBG     = cv('--md-pre-bg')      || codeBG;

  const bqBorder  = cv('--md-bq-border')   || '3px solid #2563eb';
  const bqColor   = cv('--md-bq-color')    || '#6b6560';
  const bqPad     = cv('--md-bq-padding')  || '0.5em 1em';
  const bqMargin  = cv('--md-bq-margin')   || '1.2em 0';

  return `
body {
  font-family: ${fontFamily};
  font-size: ${baseSize};
  color: ${color};
  line-height: ${lineHeight};
  max-width: 720px;
  margin: 0 auto;
  padding: 40px 48px 60px;
  -webkit-font-smoothing: antialiased;
}
h1 { font-family: ${hFontFamily}; font-size: ${h1Size}; color: ${h1Color}; font-weight: ${h1Weight}; letter-spacing: -0.02em; line-height: 1.2; margin: 0 0 ${hMB}; }
h2 { font-family: ${hFontFamily}; font-size: ${h2Size}; color: ${h2Color}; font-weight: ${h2Weight}; letter-spacing: -0.015em; line-height: 1.3; margin: 1.4em 0 ${hMB}; padding-bottom: 0.3em; border-bottom: 1px solid #ede8e2; }
h3 { font-family: ${hFontFamily}; font-size: ${h3Size}; color: ${h3Color}; font-weight: ${h3Weight}; letter-spacing: -0.01em; line-height: 1.4; margin: 1.2em 0 ${hMB}; }
h4 { font-family: ${hFontFamily}; font-size: ${h4Size}; color: ${h4Color}; font-weight: ${h4Weight}; line-height: 1.5; margin: 1em 0 ${hMB}; }
p  { color: ${pColor}; line-height: ${pLH}; margin: ${pMargin}; }
a  { color: ${linkColor}; text-decoration: ${linkDec}; text-underline-offset: 2px; }
code { background: ${codeBG}; color: ${codeColor}; padding: 0.15em 0.45em; border-radius: 4px; font-family: ${codeFont}; font-size: 0.85em; }
pre  { background: ${preBG}; padding: 1.1em 1.25em; border-radius: 8px; overflow-x: auto; margin: 1.2em 0; border: 1px solid #e7e2db; }
pre code { background: none; padding: 0; color: #3c3733; font-size: 0.88em; }
blockquote { border-left: ${bqBorder}; color: ${bqColor}; padding: ${bqPad}; margin: ${bqMargin}; background: #f7f5f2; border-radius: 0 6px 6px 0; }
blockquote p { margin: 0; color: inherit; }
ul, ol { padding-left: 1.6em; margin: 0.5em 0 1.1em; }
li { margin-bottom: 0.3em; }
hr { border: none; border-top: 1px solid #ede8e2; margin: 2em 0; }
table { border-collapse: collapse; width: 100%; margin: 1.2em 0; font-size: 0.92em; }
th, td { border: 1px solid #e2ddd6; padding: 7px 12px; text-align: left; }
th { background: #f4f1ed; font-weight: 600; }
tr:nth-child(even) td { background: #fafaf8; }
img { max-width: 100%; border-radius: 8px; }
`;
}

function buildExportHTML() {
  const fontName = document.getElementById('ctrl-font-family').value.replace(/['"]/g,'').split(',')[0].trim();
  const fontLink = GOOGLE_FONTS.includes(fontName)
    ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@400;500;600;700&display=swap">`
    : '';
  const title = (currentMeta.title || 'Document').replace(/</g,'&lt;');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${title}</title>
${fontLink}
<style>${buildExportCSS()}</style>
</head>
<body>
${renderedEl.innerHTML
  .replace(/<button class="copy-btn"[^]*?<\/button>/g, '')
  .replace(/<div class="pre-wrapper">([\s\S]*?)<\/div>/g, '$1')
  .replace(/<a class="header-anchor"[^]*?<\/a>/g, '')
  .replace(/<nav class="sdocs-toc"[^]*?<\/nav>/g, '')}
</body>
</html>`;
}

function exportPDF() {
  setStatus('Opening print dialog…');
  const html = buildExportHTML();
  const win = window.open('', '_blank', 'width=900,height=700');
  win.document.open();
  win.document.write(html + `<script>
    document.fonts.ready.then(() => {
      window.focus();
      window.print();
    });
  <\/script>`);
  win.document.close();
  setStatus('PDF print dialog opened');
}

let htmlDocxLoaded = false;

function loadHtmlDocx() {
  return new Promise((resolve, reject) => {
    if (htmlDocxLoaded) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/html-docx-js@0.3.1/dist/html-docx.js';
    s.onload = () => { htmlDocxLoaded = true; resolve(); };
    s.onerror = () => reject(new Error('Could not load html-docx-js'));
    document.head.appendChild(s);
  });
}

async function exportWord() {
  setStatus('Generating Word document…');
  try {
    await loadHtmlDocx();
    const html = buildExportHTML();
    const blob = window.htmlDocx.asBlob(html, {
      orientation: 'portrait',
      margins: { top: 720, right: 900, bottom: 720, left: 900 },
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (currentMeta.title || 'document').replace(/[^a-z0-9_-]/gi,'_') + '.docx';
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus('Exported Word .docx');
  } catch (e) {
    setStatus('Word export failed: ' + e.message);
    console.error(e);
  }
}

function download(filename, content) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

document.getElementById('btn-export-raw').addEventListener('click', () => {
  download('document.md', currentBody);
  setStatus('Exported raw .md');
});

document.getElementById('btn-export-styled').addEventListener('click', () => {
  const meta = { ...currentMeta, styles: collectStyles() };
  const fm = serializeFrontMatter(meta);
  download('document.md', fm + '\n' + currentBody);
  setStatus('Exported styled .md with YAML front matter');
});

document.getElementById('btn-export-pdf').addEventListener('click', exportPDF);
document.getElementById('btn-export-word').addEventListener('click', exportWord);

// Save as default styles

function buildStylesYaml() {
  const styles = collectStyles();
  const lines = [];
  for (const [k, v] of Object.entries(styles)) {
    if (typeof v === 'object' && v !== null) {
      const inner = Object.entries(v).map(([a, b]) => `${a}: ${JSON.stringify(b)}`).join(', ');
      lines.push(`${k}: { ${inner} }`);
    } else {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    }
  }
  return lines.join('\n');
}

let saveDefaultCmd = '';

function refreshSaveDefaultPreview() {
  const yaml = buildStylesYaml();
  saveDefaultCmd = `mkdir -p ~/.sdocs && cat > ~/.sdocs/styles.yaml << 'SDOCS'\n${yaml}\nSDOCS`;
  document.getElementById('save-default-display').textContent = saveDefaultCmd;
}

document.querySelector('[data-target="body-save-default"]').addEventListener('click', () => {
  // Delay so the panel-body open class is toggled first
  setTimeout(refreshSaveDefaultPreview, 0);
});

document.getElementById('btn-copy-default').addEventListener('click', async () => {
  refreshSaveDefaultPreview();
  try {
    await navigator.clipboard.writeText(saveDefaultCmd);
    const msg = document.getElementById('save-default-msg');
    msg.textContent = 'Copied! Paste in your terminal to save defaults.';
    msg.style.display = 'block';
    setTimeout(() => { msg.style.display = 'none'; }, 4000);
  } catch (e) {
    setStatus('Could not copy to clipboard');
  }
});

// Default content

const DEFAULT_MD = `# Word is dead. Markdown won.

Agents speak markdown. They can't open a .docx. But markdown on its own looks like a text file, so here we are.

## What this is

SDocs adds typography styles to markdown files. You write your content in regular markdown and the styles live in a metadata block at the top of the file.

That metadata block is called [YAML front matter](https://jekyllrb.com/docs/front-matter/). It's a convention that started with [Jekyll](https://jekyllrb.com/) (the static site generator) back in 2008 and has since been adopted by [Hugo](https://gohugo.io/), [Gatsby](https://www.gatsbyjs.com/), [Obsidian](https://obsidian.md/), and most of the markdown ecosystem. It looks like this — a block of key-value pairs between two \`---\` lines at the top of your file:

\`\`\`yaml
---
title: My Document
author: Someone
---
\`\`\`

These tools each use front matter for their own purposes. Jekyll uses it for page layout and permalink configuration. Hugo uses it for content taxonomy and templating. Obsidian uses it for note metadata, tags, and a \`cssclass\` field that points to an external stylesheet.

What SDocs does is add a \`styles:\` key where the values are CSS typography properties written in YAML. So instead of needing a separate CSS file or a build step, the styles travel with the document:

\`\`\`yaml
---
styles:
  fontFamily: Lora
  baseFontSize: 17
  color: "#1a1a2e"
  h1: { fontSize: 2.3, color: "#c0392b", fontWeight: 700 }
  p: { lineHeight: 1.9, marginBottom: 1.2 }
---
\`\`\`

The property names map directly to CSS — \`fontFamily\` is \`font-family\`, \`baseFontSize\` sets the root \`font-size\` in pixels, \`lineHeight\` is \`line-height\`, and so on. Nested keys like \`h1\`, \`h2\`, \`p\`, \`blockquote\` target those specific elements. You can see every available property by running \`sdocs-dev --schema\`.

The panel on the right side of this screen lets you adjust all of these visually. When you export, the styles get written into the front matter automatically.

You can also just click **Raw** above to see and edit the front matter directly — the styles for this document are right there at the top of the file.

## The CLI

There's a CLI called \`sdocs-dev\`. You install it with npm and point it at any \`.md\` file:

\`\`\`bash
sdocs-dev README.md              # opens in read mode
sdocs-dev report.md --mode style # opens with the styling panel
cat notes.md | sdocs-dev         # pipe from stdin
\`\`\`

If the file has a \`styles:\` block in its front matter, those styles get applied. If it doesn't, you just get sensible defaults.

The main idea is that your AI agent can write a markdown file with a styles block and then open it for you:

\`\`\`bash
sdocs-dev report.md
\`\`\`

The agent writes markdown anyway — now it can also make it look good.

## Sharing

The entire document — content and styles — gets base64-encoded into the URL hash (the \`#\` part of the URL). That means the server never stores anything. The URL *is* the document.

When you're running locally, the URL looks something like \`localhost:3000/#md=SGVsbG8...&mode=read\`. You can copy that and send it to someone else running the server locally, and it works.

But more usefully, SDocs is hosted at [sdocs.dev](https://sdocs.dev). So you can share a link like \`sdocs.dev/#md=SGVsbG8...&mode=read\` and anyone with a browser can open it. They don't need to install anything or run a server. They just click the link and see the styled document.

The CLI opens documents on localhost by default, but the hash is the same either way — you can swap \`localhost:3000\` for \`sdocs.dev\` in any URL and it works.

## Privacy

Your document never hits the server. This isn't a promise — it's how HTTP works. The hash fragment (everything after the \`#\` in a URL) is never sent to the server by the browser. It stays entirely client-side.

Here's what happens when you open an SDocs URL:

1. The browser requests \`sdocs.dev/\` — just the bare HTML page, no document data
2. The server returns \`index.html\` — a static file, same for every request
3. JavaScript in the browser reads \`window.location.hash\`, decodes the base64, and renders it locally

The relevant code in \`index.html\`:

\`\`\`js
const hash = window.location.hash.slice(1);
const params = new URLSearchParams(hash);
const text = atob(decodeURIComponent(params.get('md')));
\`\`\`

The server itself is about 60 lines of Node.js that serves static files. There's no database, no logging, no analytics, no request body parsing. You can read the whole thing in \`server.js\`.

If you want to be sure, run it locally. The CLI does that by default.

## Default styles

If you keep using the same fonts and colors across documents, you can save them as defaults in \`~/.sdocs/styles.yaml\`. Here's how that works:

When you run \`sdocs-dev report.md\`, the CLI reads your file, then checks if \`~/.sdocs/styles.yaml\` exists. If it does, it merges those default styles *under* the file's own styles before encoding everything into the URL hash. So by the time the browser opens, the merged styles are already baked into the front matter.

This means your defaults show up in the rendered document and in the raw view, but the original file on disk isn't modified. The file's own styles always take priority over defaults — if your default says \`fontFamily: Lora\` but the file says \`fontFamily: Inter\`, Inter wins. For nested properties like \`h1\`, the merge happens at the property level, so your default can provide \`h1.fontSize\` while the file provides \`h1.color\` and both apply.

There's a "Save as default styles" section at the bottom of the right panel that generates the terminal command to create this file.

## About the project

The whole thing is a single HTML file, one Node server, and one dependency (\`marked\` for markdown parsing). It's open source and designed to stay simple.
`;

// Init

// Set standalone color controls to theme-appropriate defaults before collectStyles()
if (document.documentElement.dataset.theme === 'dark') {
  STANDALONE_COLOR_IDS.forEach(ctrlId => {
    const el = document.getElementById(ctrlId);
    if (el) el.value = getStandaloneDefault(ctrlId);
  });
}

setColorValue('ctrl-color', getColorDefault(), false);

(function () {
  const hash = window.location.hash.slice(1);
  const params = hash ? new URLSearchParams(hash) : new URLSearchParams();
  const mdParam = params.get('md');
  const modeParam = params.get('mode');
  const stylesParam = params.get('styles');
  if (mdParam) {
    try {
      _isDefaultState = false;
      const text = decodeURIComponent(escape(atob(decodeURIComponent(mdParam))));
      loadText(text, 'document.md');
    } catch (e) {
      console.warn('sdocs-dev: could not decode #md hash', e);
    }
  }
  if (modeParam && ['read', 'style', 'raw'].includes(modeParam)) {
    setMode(modeParam);
  } else if (mdParam && window.innerWidth <= 768) {
    setMode('read');
  }
  if (!mdParam) {
    loadText(serializeFrontMatter({ styles: collectStyles() }) + '\n' + DEFAULT_MD);
    if (stylesParam) {
      try {
        const styles = JSON.parse(atob(decodeURIComponent(stylesParam)));
        applyStylesFromMeta(styles);
      } catch (e) {
        console.warn('sdocs-dev: could not decode #styles hash', e);
      }
    }
  }

  const secParam = params.get('sec');
  if (secParam) {
    setTimeout(() => {
      const target = document.getElementById(secParam);
      if (target) {
        const container = document.getElementById('content-area');
        if (container) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }, 200);
  }
}());
