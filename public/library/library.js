// Live library UI. The page is served from the SDocs site; all data
// comes from a local agent the user starts with `sdoc library`. The
// agent's URL is passed as ?agent=http://127.0.0.1:<port>. The page
// shows a fallback banner when the agent isn't reachable.

const AGENT_URL = (() => {
  const fromQuery = new URLSearchParams(location.search).get('agent');
  if (fromQuery) {
    try { return new URL(fromQuery).origin; } catch (_) { return fromQuery; }
  }
  // Default: try the canonical port. If it answers, we use it; if not,
  // the banner asks the user to run `sdoc library`.
  return 'http://127.0.0.1:47843';
})();

function api(p) { return AGENT_URL + p; }

// Minimum CLI version the library page expects. Any older install
// (including any pre-version-reporting build) is flagged with an
// "update your CLI" banner. Bump this when the page starts relying on
// a newer agent endpoint or response shape, or when an earlier version
// has a known behavioural problem worth nudging users away from.
//
// 1.11.0 added the throwaway-folder block and prune-missing on
// rescan. Pre-1.11 installs can hang on Rescan because the walker
// dives into /var/folders and similar - so anything older than 1.11
// gets a soft update prompt.
const MIN_AGENT_VERSION = '1.11.0';

// Loose semver compare: returns -1, 0, or 1. Anything that fails to
// parse (empty string, garbage) sorts as "older than everything" so
// the page errs toward asking the user to update.
function compareVersion(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] || 0, db = pb[i] || 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

// Same icons SDocs uses on code blocks and the file-info copy buttons.
const COPY_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const CHECK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const COPY_FEEDBACK_MS = 1500;

function showBanner(opts) {
  // opts: { kind, message, command, dismissKey }
  const b = document.getElementById('agent-banner');
  if (!b) return;
  if (opts.dismissKey && localStorage.getItem('sdoc-lib-dismiss-' + opts.dismissKey)) {
    b.hidden = true;
    return;
  }
  b.className = 'agent-banner ' + (opts.kind || 'info');
  b.innerHTML = '';
  const text = document.createElement('span');
  text.className = 'agent-banner-text';
  text.textContent = opts.message;
  b.appendChild(text);
  if (opts.command) {
    const cmd = document.createElement('code');
    cmd.className = 'agent-banner-cmd';
    cmd.textContent = opts.command;
    b.appendChild(cmd);
    const btn = document.createElement('button');
    btn.className = 'agent-banner-copy';
    btn.title = 'Copy command';
    btn.setAttribute('aria-label', 'Copy command');
    btn.innerHTML = COPY_SVG;
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(opts.command);
        btn.innerHTML = CHECK_SVG;
        btn.classList.add('copied');
        setTimeout(() => {
          btn.innerHTML = COPY_SVG;
          btn.classList.remove('copied');
        }, COPY_FEEDBACK_MS);
      } catch (_) {}
    });
    b.appendChild(btn);
  }
  if (opts.dismissKey) {
    const x = document.createElement('button');
    x.className = 'agent-banner-dismiss';
    x.setAttribute('aria-label', 'dismiss');
    x.textContent = '×';
    x.addEventListener('click', () => {
      localStorage.setItem('sdoc-lib-dismiss-' + opts.dismissKey, '1');
      b.hidden = true;
    });
    b.appendChild(x);
  }
  b.hidden = false;
}
function hideBanner() {
  const b = document.getElementById('agent-banner');
  if (b) b.hidden = true;
}

const STATE = {
  chips: [],
  q: '',
  selected: 0,
  starredOnly: false,
  entries: [],
  lastScanAt: 0,
  enabled: true,
  shownLen: 0,
};

const TIME_OPTIONS = [
  { value: '24h', label: 'Last 24 hours', days: 1 },
  { value: '7d',  label: 'Last 7 days',   days: 7 },
  { value: '14d', label: 'Last 14 days',  days: 14 },
  { value: '30d', label: 'Last 30 days',  days: 30 },
  { value: '90d', label: 'Last 90 days',  days: 90 },
];

function daysFromSince(val) {
  const m = TIME_OPTIONS.find(o => o.value === val);
  if (m) return m.days;
  const n = parseInt(val, 10);
  return isNaN(n) ? Infinity : n;
}

function dateFor(entry) {
  return entry.mtime || entry.firstSeen || null;
}

function countBy(field) {
  const map = {};
  for (const e of STATE.entries) {
    const v = e[field];
    if (!v) continue;
    map[v] = (map[v] || 0) + 1;
  }
  return map;
}
function allTags() {
  const map = {};
  for (const e of STATE.entries) for (const t of (e.tags || [])) map[t] = (map[t] || 0) + 1;
  return map;
}

function pathPrefixOptions() {
  const counts = {};
  for (const e of STATE.entries) {
    if (!e.path) continue;
    const segs = e.path.split('/');
    segs.pop();
    for (let i = 1; i <= segs.length; i++) {
      const pref = segs.slice(0, i).join('/');
      if (!pref) continue;
      counts[pref] = (counts[pref] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .filter(([pref, n]) => n >= 2 || pref.split('/').length === 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 14)
    .map(([k, v]) => ({ value: k, label: k, count: v }));
}

const FACET_DEFS = {
  project: {
    title: 'Project',
    getOptions: () => Object.entries(countBy('gitProject')).sort((a,b) => b[1]-a[1]).map(([k,v]) => ({ value: k, label: k, count: v })),
    chipKey: 'project',
    match: (e, val) => e.gitProject === val,
  },
  path: {
    title: 'Path',
    getOptions: pathPrefixOptions,
    chipKey: 'path',
    match: (e, val) => (e.path || '').toLowerCase().includes(val.toLowerCase()),
  },
  agent: {
    title: 'Agent',
    getOptions: () => Object.entries(countBy('agent')).sort((a,b) => b[1]-a[1]).map(([k,v]) => ({ value: k, label: k, count: v })),
    chipKey: 'agent',
    match: (e, val) => e.agent === val,
  },
  since: {
    title: 'When',
    getOptions: () => TIME_OPTIONS.map(o => ({ value: o.value, label: o.value, labelExtra: o.label })),
    exclusive: true,
    chipKey: 'since',
    // val is either a preset like "7d" or a custom range
    // "range:YYYY-MM-DD..YYYY-MM-DD" (either end may be blank for an
    // open interval).
    match: (e, val) => {
      const d = dateFor(e); if (!d) return false;
      const t = new Date(d).getTime();
      if (typeof val === 'string' && val.startsWith('range:')) {
        const body = val.slice(6);
        const sep = body.indexOf('..');
        const from = sep >= 0 ? body.slice(0, sep) : body;
        const to   = sep >= 0 ? body.slice(sep + 2) : '';
        const fromT = from ? new Date(from + 'T00:00:00').getTime() : -Infinity;
        const toT   = to   ? new Date(to   + 'T23:59:59.999').getTime() : Infinity;
        return t >= fromT && t <= toT;
      }
      const days = daysFromSince(val);
      return (Date.now() - t) / 86400000 <= days;
    },
  },
  tag: {
    title: 'Tag',
    getOptions: () => Object.entries(allTags()).sort((a,b) => b[1]-a[1]).map(([k,v]) => ({ value: k, label: k, count: v })),
    chipKey: 'tag',
    match: (e, val) => (e.tags || []).includes(val),
  },
};

// Chips carry an optional `exclude: true` flag. Three states are
// possible for a (key, value) pair: not present (no chip), include
// (chip without exclude), exclude (chip with exclude). Clicking a
// facet option or typing in the search box cycles through them.
function chipFor(k, v) {
  return STATE.chips.find(c => c.key === k && c.value === v) || null;
}
function chipState(k, v) {
  const c = chipFor(k, v);
  if (!c) return 'none';
  return c.exclude ? 'exclude' : 'include';
}
function hasChip(k, v) { return chipState(k, v) !== 'none'; }
function removeChip(k, v) { STATE.chips = STATE.chips.filter(c => !(c.key === k && c.value === v)); }
function setChip(k, v, opts) {
  removeChip(k, v);
  STATE.chips.push({ key: k, value: v, exclude: !!(opts && opts.exclude) });
}
function setExclusiveChip(k, v) {
  STATE.chips = STATE.chips.filter(c => c.key !== k);
  if (v) STATE.chips.push({ key: k, value: v });
}
// One click = next state. Skip the exclude state for exclusive facets
// (date "since" presets) where excluding a single bucket makes no
// useful sense compared to picking a different bucket.
function cycleChip(k, v, opts) {
  const def = FACET_DEFS[k];
  const exclusive = def && def.exclusive;
  if (exclusive) {
    if (hasChip(k, v)) setExclusiveChip(k, '');
    else setExclusiveChip(k, v);
    return;
  }
  const state = chipState(k, v);
  if (state === 'none') setChip(k, v, { exclude: false });
  else if (state === 'include') setChip(k, v, { exclude: true });
  else removeChip(k, v);
}

function applyFilters() {
  const q = STATE.q.toLowerCase();
  return STATE.entries.filter(e => {
    if (STATE.starredOnly && !e.starred) return false;
    for (const c of STATE.chips) {
      const def = FACET_DEFS[c.key];
      if (!def) continue;
      const matched = def.match(e, c.value);
      if (c.exclude) {
        if (matched) return false;
      } else {
        if (!matched) return false;
      }
    }
    if (q) {
      const blob = (
        (e.title || '') + ' ' +
        (e.bodyExcerpt || '') + ' ' +
        (e.path || '') + ' ' +
        (e.tags || []).join(' ')
      ).toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => {
    const da = dateFor(a), db = dateFor(b);
    return (db || '').localeCompare(da || '');
  });
}

// Search-box syntax: `tag:foo` adds an include chip; `-tag:foo`
// (or `not:tag:foo`) adds an exclude chip. Unknown keys fall through
// to free-text search.
function parseInput(s) {
  const KEYS = ['project','agent','path','since','tag'];
  const tokens = s.split(/\s+/);
  const remaining = [];
  for (const t of tokens) {
    if (!t) continue;
    let exclude = false;
    let token = t;
    if (token.startsWith('-')) { exclude = true; token = token.slice(1); }
    else if (token.toLowerCase().startsWith('not:')) { exclude = true; token = token.slice(4); }
    const m = token.match(/^(\w+):(.+)$/);
    if (m && KEYS.includes(m[1])) {
      setChip(m[1], m[2], { exclude });
    } else {
      remaining.push(t);
    }
  }
  return remaining.join(' ');
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
}
function highlight(text, q) {
  if (!q || !q.trim()) return escHtml(text);
  const terms = q.trim().split(/\s+/).filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!terms.length) return escHtml(text);
  const re = new RegExp(terms.join('|'), 'gi');
  let out = '', last = 0, m;
  while ((m = re.exec(text)) !== null) {
    out += escHtml(text.slice(last, m.index)) + '<mark>' + escHtml(m[0]) + '</mark>';
    last = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  out += escHtml(text.slice(last));
  return out;
}

function findSnippet(text, q, before = 40, after = 100) {
  if (!q || !q.trim() || !text) return null;
  const terms = q.trim().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  let bestIdx = -1, bestLen = 0;
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (bestIdx < 0 || i < bestIdx)) { bestIdx = i; bestLen = t.length; }
  }
  if (bestIdx < 0) return null;
  const start = Math.max(0, bestIdx - before);
  const end = Math.min(text.length, bestIdx + bestLen + after);
  return (start > 0 ? '... ' : '') + highlight(text.slice(start, end), q) + (end < text.length ? ' ...' : '');
}

function splitPath(p) {
  const i = p.lastIndexOf('/');
  return i >= 0 ? { dir: p.slice(0, i), base: p.slice(i) } : { dir: '', base: p };
}

let openFacet = null;

function chipDisplayValue(c) {
  if (c.key === 'since' && typeof c.value === 'string' && c.value.startsWith('range:')) {
    const body = c.value.slice(6);
    const sep = body.indexOf('..');
    const from = sep >= 0 ? body.slice(0, sep) : body;
    const to   = sep >= 0 ? body.slice(sep + 2) : '';
    if (from && to)   return from + ' → ' + to;
    if (from && !to)  return 'after ' + from;
    if (!from && to)  return 'before ' + to;
    return c.value;
  }
  return c.value;
}

function renderChipsInline() {
  const row = document.getElementById('chips-row');
  row.innerHTML = STATE.chips.map((c, i) => {
    const prefix = c.exclude ? '−&nbsp;' : '';
    const cls = c.exclude ? 'filter-chip exclude' : 'filter-chip';
    const title = c.exclude ? 'excluded - click × to remove' : 'included - click × to remove';
    return `<span class="${cls}" title="${title}">${prefix}${c.key}:${escHtml(chipDisplayValue(c))}<span class="x" data-rm="${i}" title="remove">&times;</span></span>`;
  }).join('');
  document.querySelectorAll('[data-rm]').forEach(el => el.addEventListener('click', () => {
    STATE.chips.splice(+el.dataset.rm, 1);
    renderAll();
  }));
}

function chipCountFor(facet) { return STATE.chips.filter(c => c.key === facet).length; }

function renderFacetButtons() {
  document.querySelectorAll('.facet-button').forEach(btn => {
    const facet = btn.dataset.facet;
    const n = chipCountFor(facet);
    const isOpen = openFacet === facet;
    btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    btn.querySelectorAll('.count-badge').forEach(b => b.remove());
    if (n > 0) {
      const badge = document.createElement('span');
      badge.className = 'count-badge';
      badge.textContent = String(n);
      btn.insertBefore(badge, btn.querySelector('.chev'));
    }
  });
}

function renderFacetPanel() {
  const panel = document.getElementById('facet-panel');
  if (!openFacet) { panel.classList.remove('open'); return; }
  panel.classList.add('open');
  const def = FACET_DEFS[openFacet];
  document.getElementById('facet-panel-title').textContent = def.title;
  const opts = def.getOptions();
  const container = document.getElementById('facet-panel-options');
  container.classList.toggle('column', !!def.column);
  if (!opts.length) {
    container.innerHTML = '<div class="muted" style="font-size:11.5px">no values yet</div>';
    return;
  }
  const cycleHint = def.exclusive
    ? 'click to filter; click again to clear'
    : 'click to include; click again to exclude; once more to clear';
  container.innerHTML = opts.map(o => {
    const state = chipState(openFacet, o.value);
    const stateCls = state === 'include' ? 'selected' : state === 'exclude' ? 'excluded' : '';
    return `
      <button class="facet-option ${stateCls}" data-key="${openFacet}" data-value="${escHtml(o.value)}" ${def.exclusive ? 'data-exclusive="1"' : ''} title="${cycleHint}">
        ${state === 'exclude' ? '<span class="exclude-mark" aria-hidden="true">−</span>' : ''}
        <span class="prefix">${openFacet}:</span><span>${escHtml(o.label)}</span>
        ${o.labelExtra ? `<span class="label-extra">${escHtml(o.labelExtra)}</span>` : ''}
        ${o.count != null ? `<span class="count">${o.count}</span>` : ''}
      </button>
    `;
  }).join('');
  container.querySelectorAll('.facet-option').forEach(el => el.addEventListener('click', () => {
    cycleChip(el.dataset.key, el.dataset.value);
    renderAll();
  }));

  if (openFacet === 'since') renderDateRangePicker(container);
}

function currentRangeBounds() {
  const sinceChip = STATE.chips.find(c => c.key === 'since' && !c.exclude);
  if (!sinceChip || typeof sinceChip.value !== 'string' || !sinceChip.value.startsWith('range:')) {
    return { from: '', to: '' };
  }
  const body = sinceChip.value.slice(6);
  const sep = body.indexOf('..');
  return {
    from: sep >= 0 ? body.slice(0, sep) : body,
    to:   sep >= 0 ? body.slice(sep + 2) : '',
  };
}

function renderDateRangePicker(container) {
  const { from, to } = currentRangeBounds();
  const todayIso = new Date().toISOString().slice(0, 10);
  const wrap = document.createElement('div');
  wrap.className = 'date-range';
  wrap.innerHTML = `
    <div class="date-range-row">
      <label class="date-range-label">From</label>
      <input type="date" class="date-range-input" data-end="from" value="${from}" max="${todayIso}" />
      <label class="date-range-label">to</label>
      <input type="date" class="date-range-input" data-end="to" value="${to}" max="${todayIso}" />
      <button class="date-range-apply" type="button" data-act="apply">Apply</button>
      ${from || to ? '<button class="date-range-clear" type="button" data-act="clear">Clear</button>' : ''}
    </div>
    <div class="date-range-hint">Pick a custom range. Either end can be blank for an open interval.</div>
  `;
  container.appendChild(wrap);

  const applyBtn = wrap.querySelector('[data-act="apply"]');
  applyBtn.addEventListener('click', () => {
    const f = wrap.querySelector('[data-end="from"]').value || '';
    const t = wrap.querySelector('[data-end="to"]').value || '';
    if (!f && !t) return;
    setExclusiveChip('since', 'range:' + f + '..' + t);
    renderAll();
  });
  const clearBtn = wrap.querySelector('[data-act="clear"]');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    setExclusiveChip('since', '');
    renderAll();
  });
}

function renderResults() {
  const all = applyFilters();
  const shown = all.slice(0, 60);
  if (STATE.selected >= shown.length) STATE.selected = Math.max(0, shown.length - 1);
  STATE.shownLen = shown.length;
  document.getElementById('count').textContent = all.length + ' result' + (all.length === 1 ? '' : 's');
  const c = document.getElementById('results');
  if (!shown.length) {
    if (!STATE.entries.length) {
      c.innerHTML = '<div class="empty">Library is empty.<div class="tip">Open a markdown file with <code>sdoc file.md</code> or click "rescan" to walk your home directory.</div></div>';
    } else {
      c.innerHTML = '<div class="empty">No matches. Try removing a chip or refining your search.</div>';
    }
    return;
  }

  const tagChips = new Set(STATE.chips.filter(c => c.key === 'tag').map(c => c.value));
  const q = STATE.q.trim().toLowerCase();
  const tagMatches = (tag) => tagChips.has(tag) || (q && tag.toLowerCase().includes(q));

  const rows = shown.map((e, i) => {
    const isStarred = !!e.starred;
    let snippetHtml = '';
    if (STATE.q.trim()) {
      const bodyHit = findSnippet(e.bodyExcerpt, STATE.q);
      if (bodyHit) snippetHtml = `<span class="src">body</span>${bodyHit}`;
    }
    let pathHtml = '';
    if (e.path) {
      const { dir, base } = splitPath(e.path);
      pathHtml = `<span class="path" title="${escHtml(e.path)}">
        <span class="path-dir">${highlight(dir, STATE.q)}</span><span class="path-base">${highlight(base, STATE.q)}</span>
      </span>`;
    }
    const project = e.gitProject ? `<code>${escHtml(e.gitProject)}</code>` : '';
    const agent = e.agent ? `<span>${escHtml(e.agent)}</span>` : '';
    const rescued = e.rescued
      ? `<a class="rescued-badge" href="/library/rescued" target="_blank" rel="noopener" title="This file lived in a throwaway folder. SDocs kept a snapshot so it survives. Click for details.${e.rescuedFrom ? '\n\nOriginal: ' + e.rescuedFrom : ''}" onclick="event.stopPropagation()">rescued</a>`
      : '';
    const when = dateFor(e) ? new Date(dateFor(e)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    return `
    <div class="res ${i === STATE.selected ? 'sel' : ''}" data-idx="${i}" data-id="${escHtml(e.id)}">
      <div>
        <div class="res-title">${highlight(e.title || e.path || '(untitled)', STATE.q)}</div>
        <div class="res-meta">
          ${project} ${agent} ${pathHtml} ${rescued}
          ${(e.tags || []).map(t => `<span class="tag ${tagMatches(t)?'match':''}">#${escHtml(t)}</span>`).join('')}
        </div>
        ${snippetHtml ? `<div class="res-snippet">${snippetHtml}</div>` : ''}
      </div>
      <div class="res-side">
        <button class="res-star ${isStarred ? 'on' : ''}" data-star="${escHtml(e.id)}" aria-pressed="${isStarred}">
          <svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="${isStarred ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
        </button>
        <div class="res-when">${escHtml(when)}</div>
      </div>
    </div>
  `}).join('');

  const overflow = all.length > shown.length
    ? `<div class="res-overflow">Showing first ${shown.length} of ${all.length} - narrow with a filter or refine your search.</div>`
    : '';
  c.innerHTML = '<div class="results-list">' + rows + overflow + '</div>';
}

function renderStarToggle() {
  const btn = document.getElementById('star-toggle');
  btn.classList.toggle('on', STATE.starredOnly);
  btn.setAttribute('aria-pressed', STATE.starredOnly ? 'true' : 'false');
}

function renderStatus() {
  const last = STATE.lastScanAt ? new Date(STATE.lastScanAt).toLocaleString() : 'never';
  const enabledTxt = STATE.enabled ? '' : ' (disabled)';
  document.getElementById('status-line').textContent =
    `${STATE.entries.length} entries, last scan ${last}${enabledTxt}`;
}

function renderAll() {
  renderChipsInline();
  renderFacetButtons();
  renderFacetPanel();
  renderStarToggle();
  renderResults();
  renderStatus();
  const clearBtn = document.getElementById('clear');
  const hasFilters = STATE.chips.length > 0 || STATE.q.trim().length > 0 || STATE.starredOnly;
  if (hasFilters) clearBtn.removeAttribute('hidden');
  else clearBtn.setAttribute('hidden', '');
}

async function loadData() {
  try {
    const r = await fetch(api('/api/library/data'));
    if (!r.ok) throw new Error('agent returned ' + r.status);
    const data = await r.json();
    STATE.entries = data.entries || [];
    STATE.lastScanAt = data.lastScanAt || 0;
    STATE.enabled = data.enabled !== false;
    STATE.autostart = data.autostart || { supported: false, enabled: false, userDisabled: false };
    // Stale-CLI check runs before the autostart nag - an outdated
    // install is the more urgent thing for the user to see.
    if (compareVersion(data.version, MIN_AGENT_VERSION) < 0) {
      showBanner({
        kind: 'info',
        message: 'Your SDocs CLI is out of date. Update with:',
        command: 'npm i -g sdocs-dev',
      });
    } else if (STATE.autostart.supported && !STATE.autostart.enabled && !STATE.autostart.userDisabled) {
      // Show the recovery banner only when autostart *should* be on but
      // isn't, and the user hasn't explicitly turned it off. If they have,
      // their preference is the truth; don't nag.
      showBanner({
        kind: 'info',
        message: 'Library auto-start isn’t on. Turn it back on with:',
        command: 'sdoc library autostart enable',
        dismissKey: 'autostart-off',
      });
    } else {
      hideBanner();
    }
    renderAll();
  } catch (e) {
    showBanner({
      kind: 'error',
      message: 'No local library running. Install the CLI (if you haven’t), then start it with:',
      command: 'npm i -g sdocs-dev && sdoc library',
    });
    STATE.entries = [];
    renderAll();
  }
}

async function toggleStar(id, starred) {
  try {
    await fetch(api('/api/library/star'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, starred }),
    });
  } catch (_) {}
}

async function rescan() {
  const btn = document.getElementById('rescan-btn');
  btn.textContent = 'scanning...';
  btn.disabled = true;
  try {
    await fetch(api('/api/library/rescan'), { method: 'POST' });
    await loadData();
  } catch (_) {
    showBanner('Could not reach the local library agent.', 'error');
  } finally {
    btn.textContent = 'rescan';
    btn.disabled = false;
  }
}

// Open a library entry by asking the agent to start a Bridge for the
// underlying file, then opening a bridged URL in a new tab. Live
// editing (including tag edits) works because the Bridge is the single
// write channel. If the bridge-for endpoint fails for any reason
// (e.g. file missing, port exhaustion), fall back to the snapshot URL
// so the user can still read the document.
async function openEntry(id) {
  try {
    const entryResp = await fetch(api('/api/library/entry?id=' + encodeURIComponent(id)));
    if (!entryResp.ok) {
      showBanner({ kind: 'error', message: 'Entry not found.' });
      return;
    }
    const entry = await entryResp.json();
    // Always bridge against the entry's stable path. For rescued entries
    // that is the snapshot copy under ~/.sdocs/library/rescued/ - the
    // whole point of rescuing is that the original location (rescuedFrom)
    // is unreliable, so we never re-open from it even when it still
    // exists. rescuedFrom stays around as provenance only.
    const filePath = entry.path;

    // Try to spin up a Bridge for editable open. Success -> bridged URL.
    const bridgeResp = await fetch(api('/api/library/bridge-for'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });
    if (bridgeResp.ok) {
      const b = await bridgeResp.json();
      const params = new URLSearchParams();
      params.set('bridge', '127.0.0.1:' + b.port);
      params.set('token', b.token);
      params.set('file',  b.file);
      window.open(location.origin + '/#' + params.toString(), '_blank');
      return;
    }

    // Fallback: snapshot URL. Read-only by design - the user can read
    // but tag edits won't be available in the opened tab.
    const snapResp = await fetch(api('/api/library/open?id=' + encodeURIComponent(id)));
    if (!snapResp.ok) {
      const j = await snapResp.json().catch(() => ({}));
      showBanner({ kind: 'error', message: 'Could not open: ' + (j.error || snapResp.status) });
      return;
    }
    const snap = await snapResp.json();
    window.open(new URL(snap.url, location.origin).toString(), '_blank');
  } catch (e) {
    showBanner({ kind: 'error', message: 'Could not open entry: ' + e.message });
  }
}

document.querySelectorAll('.facet-button').forEach(btn => {
  btn.addEventListener('click', () => {
    const facet = btn.dataset.facet;
    openFacet = openFacet === facet ? null : facet;
    renderAll();
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openFacet) { openFacet = null; renderAll(); return; }
  if (e.key === '/' && document.activeElement !== document.getElementById('q')) {
    e.preventDefault(); document.getElementById('q').focus(); return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!STATE.shownLen) return;
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    STATE.selected = Math.max(0, Math.min(STATE.shownLen - 1, STATE.selected + step));
    renderAll();
    const el = document.querySelector(`.res[data-idx="${STATE.selected}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (e.key === 'Enter') {
    // If the search input has pending facet syntax (e.g. `-tag:foo`
    // typed without a trailing space), Enter materialises it as a
    // chip instead of opening the selected row. This keeps the input
    // box predictable: pressing Enter always commits whatever is in
    // it before performing the secondary action.
    const inputEl = document.getElementById('q');
    const raw = inputEl && inputEl.value.trim();
    if (raw && /(^|\s)-?\w+:/.test(raw)) {
      const before = STATE.chips.length;
      const remaining = parseInput(raw);
      if (STATE.chips.length !== before || remaining !== raw) {
        e.preventDefault();
        inputEl.value = remaining;
        STATE.q = remaining;
        renderAll();
        return;
      }
    }
    if (STATE.shownLen) {
      const el = document.querySelector(`.res[data-idx="${STATE.selected}"]`);
      if (el && el.dataset.id) { e.preventDefault(); openEntry(el.dataset.id); }
    }
  }
});

document.getElementById('star-toggle').addEventListener('click', () => {
  STATE.starredOnly = !STATE.starredOnly;
  renderAll();
});

document.getElementById('rescan-btn').addEventListener('click', rescan);

document.getElementById('results').addEventListener('click', (e) => {
  const starBtn = e.target.closest('[data-star]');
  if (starBtn) {
    const id = starBtn.dataset.star;
    const entry = STATE.entries.find(x => x.id === id);
    if (entry) {
      entry.starred = !entry.starred;
      toggleStar(id, entry.starred);
      renderAll();
    }
    return;
  }
  const row = e.target.closest('.res');
  if (!row) return;
  const wasSelected = STATE.selected === parseInt(row.dataset.idx, 10);
  STATE.selected = parseInt(row.dataset.idx, 10);
  renderAll();
  // Click an already-selected row to open it; first click on a row
  // selects it.
  if (wasSelected) openEntry(row.dataset.id);
});

document.getElementById('results').addEventListener('dblclick', (e) => {
  const row = e.target.closest('.res');
  if (!row) return;
  openEntry(row.dataset.id);
});

const input = document.getElementById('q');
input.addEventListener('input', (e) => {
  const val = e.target.value;
  if (val.endsWith(' ')) {
    const remaining = parseInput(val.trim());
    input.value = remaining + (remaining ? ' ' : '');
    STATE.q = remaining;
  } else {
    STATE.q = val;
  }
  renderAll();
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Backspace' && !input.value && STATE.chips.length) {
    STATE.chips.pop(); renderAll();
  }
});

document.getElementById('clear').addEventListener('click', () => {
  STATE.chips = []; STATE.q = ''; STATE.starredOnly = false;
  input.value = ''; renderAll();
});

loadData();
