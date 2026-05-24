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
    column: true,
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
    column: true,
    chipKey: 'since',
    match: (e, val) => {
      const d = dateFor(e); if (!d) return false;
      const days = daysFromSince(val);
      return (Date.now() - new Date(d).getTime()) / 86400000 <= days;
    },
  },
  tag: {
    title: 'Tag',
    getOptions: () => Object.entries(allTags()).sort((a,b) => b[1]-a[1]).map(([k,v]) => ({ value: k, label: k, count: v })),
    chipKey: 'tag',
    match: (e, val) => (e.tags || []).includes(val),
  },
};

function hasChip(k, v) { return STATE.chips.some(c => c.key === k && c.value === v); }
function removeChip(k, v) { STATE.chips = STATE.chips.filter(c => !(c.key === k && c.value === v)); }
function setExclusiveChip(k, v) {
  STATE.chips = STATE.chips.filter(c => c.key !== k);
  if (v) STATE.chips.push({ key: k, value: v });
}

function applyFilters() {
  const q = STATE.q.toLowerCase();
  return STATE.entries.filter(e => {
    if (STATE.starredOnly && !e.starred) return false;
    for (const c of STATE.chips) {
      const def = FACET_DEFS[c.key];
      if (def && !def.match(e, c.value)) return false;
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

function parseInput(s) {
  const KEYS = ['project','agent','path','since','tag'];
  const tokens = s.split(/\s+/);
  const remaining = [];
  for (const t of tokens) {
    const m = t.match(/^(\w+):(.+)$/);
    if (m && KEYS.includes(m[1])) {
      if (!hasChip(m[1], m[2])) STATE.chips.push({ key: m[1], value: m[2] });
    } else if (t) remaining.push(t);
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

function renderChipsInline() {
  const row = document.getElementById('chips-row');
  row.innerHTML = STATE.chips.map((c, i) =>
    `<span class="filter-chip">${c.key}:${escHtml(c.value)}<span class="x" data-rm="${i}" title="remove">&times;</span></span>`
  ).join('');
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
  container.innerHTML = opts.map(o => {
    const sel = hasChip(openFacet, o.value);
    return `
      <button class="facet-option ${sel ? 'selected' : ''}" data-key="${openFacet}" data-value="${escHtml(o.value)}" ${def.exclusive ? 'data-exclusive="1"' : ''}>
        <span class="prefix">${openFacet}:</span><span>${escHtml(o.label)}</span>
        ${o.labelExtra ? `<span class="label-extra">${escHtml(o.labelExtra)}</span>` : ''}
        ${o.count != null ? `<span class="count">${o.count}</span>` : ''}
      </button>
    `;
  }).join('');
  container.querySelectorAll('.facet-option').forEach(el => el.addEventListener('click', () => {
    const k = el.dataset.key, v = el.dataset.value;
    if (el.dataset.exclusive === '1') {
      if (hasChip(k, v)) setExclusiveChip(k, '');
      else setExclusiveChip(k, v);
    } else {
      if (hasChip(k, v)) removeChip(k, v);
      else STATE.chips.push({ key: k, value: v });
    }
    renderAll();
  }));
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
    const rescued = e.rescued ? `<span class="rescued-badge" title="Copied from ${escHtml(e.rescuedFrom || '')}">rescued</span>` : '';
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
    // Show the recovery banner only when autostart *should* be on but
    // isn't, and the user hasn't explicitly turned it off. If they have,
    // their preference is the truth; don't nag.
    if (STATE.autostart.supported && !STATE.autostart.enabled && !STATE.autostart.userDisabled) {
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
      message: 'The local library agent isn’t running. Start it with:',
      command: 'sdoc library',
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

// Ask the agent to encode an entry as a sdocs URL and open it in a new
// tab. The agent reads the file and returns the URL path; we attach the
// current origin so the tab opens on whichever SDocs instance we're on.
async function openEntry(id) {
  try {
    const r = await fetch(api('/api/library/open?id=' + encodeURIComponent(id)));
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      showBanner('Could not open: ' + (j.error || r.status), 'error');
      return;
    }
    const data = await r.json();
    const target = new URL(data.url, location.origin).toString();
    window.open(target, '_blank');
  } catch (e) {
    showBanner('Could not open entry: ' + e.message, 'error');
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
  if (e.key === 'Enter' && STATE.shownLen) {
    const el = document.querySelector(`.res[data-idx="${STATE.selected}"]`);
    if (el && el.dataset.id) { e.preventDefault(); openEntry(el.dataset.id); }
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
