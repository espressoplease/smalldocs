// Library UI for local files and authenticated Cloud documents. Local data
// comes from the agent started by `sdoc library`, passed as
// ?agent=http://127.0.0.1:<port>. Cloud searches run against the selected
// library and return only documents the signed-in user can access.
//
// First-visit gate: if this browser has never been through /connect,
// bounce there with a return URL so the user sees the explainer +
// permission prompt in the right context. Skippable with ?force=1
// for testing or sharing direct links to filtered views.
(function ensureConnected() {
  if (typeof window === 'undefined' || !window.SDocsConnect) return;
  if (window.SDocsConnect.isConnected()) return;
  var p = new URLSearchParams(location.search);
  // ?force=1 - used by tests. ?demo=1 - the public sample library
  // linked from /connect. Neither talks to the local agent so neither
  // needs the connect gate.
  if (p.get('force') === '1' || p.get('demo') === '1' || p.get('scope') === 'cloud') return;
  var ret = location.pathname + location.search + location.hash;
  location.replace('/connect?return=' + encodeURIComponent(ret));
})();

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
// refresh. Pre-1.11 installs can hang while the old walker
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
  sharedOnly: false,
  entries: [],
  cloudTags: null,
  cloudTagsWorkspace: null,
  cloudMembers: [],
  cloudMembersWorkspace: null,
  cloudPeople: new Map(),
  cloudNextCursor: null,
  cloudPage: 0,
  cloudPageCursors: [null],
  cloudRetryPage: null,
  cloudTotal: 0,
  cloudLoading: false,
  cloudError: false,
  cloudRequest: null,
  cloudRequestKey: null,
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

const CLOUD_PERSON_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>';
let cloudColorPeople = null, cloudColorCount = 0, cloudPersonColors = new Map();
function cloudPersonIcon(id) {
  if (cloudColorPeople !== STATE.cloudPeople || cloudColorCount !== STATE.cloudPeople.size) {
    cloudColorPeople = STATE.cloudPeople; cloudColorCount = STATE.cloudPeople.size;
    cloudPersonColors = window.SDocsCloudAccountSelection.colorMap(STATE.cloudPeople.keys());
  }
  const color = cloudPersonColors.get(id) || window.SDocsCloudAccountSelection.color(id);
  return CLOUD_PERSON_ICON.replace('<svg ', '<svg style="color:' + color + '" ');
}
function cloudPersonLabel(id) {
  const person = STATE.cloudPeople.get(id);
  if (person && person.is_you) return 'You';
  return person && (person.name || person.email) || 'Member';
}
function cloudPeopleOptions() {
  return Array.from(STATE.cloudPeople.entries()).map(([id]) => ({ value: id, label: cloudPersonLabel(id) }))
    .sort((a, b) => (a.label === 'You' ? -1 : b.label === 'You' ? 1 : a.label.localeCompare(b.label)));
}
const FACET_DEFS = {
  author: { title: 'Created by', exclusive: true, people: true, getOptions: cloudPeopleOptions,
    match: (entry, id) => entry.authorId === id },
  updatedBy: { title: 'Updated by', exclusive: true, people: true, getOptions: cloudPeopleOptions,
    match: (entry, id) => entry.updatedById === id },
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
    getOptions: () => (isCloudMode() && STATE.cloudTags !== null
      ? STATE.cloudTags.map(item => [item.tag, item.count]) : Object.entries(allTags()))
      .sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]))
      .map(([k,v]) => ({ value: k, label: k, count: v })),
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
// Two explicit toggles, called by the +/- buttons on a facet option.
// Either button can switch state directly: if currently included and
// you press -, you move to excluded (no intermediate "off" step).
// Exclude is meaningless for exclusive facets ("since" date presets),
// which is enforced at the render layer by not drawing a - button.
function toggleIncludeChip(k, v) {
  const def = FACET_DEFS[k];
  if (def && def.exclusive) {
    if (chipState(k, v) === 'include') setExclusiveChip(k, '');
    else setExclusiveChip(k, v);
    return;
  }
  if (chipState(k, v) === 'include') removeChip(k, v);
  else setChip(k, v, { exclude: false });
}
function toggleExcludeChip(k, v) {
  if (chipState(k, v) === 'exclude') removeChip(k, v);
  else setChip(k, v, { exclude: true });
}

function applyFilters() {
  const q = STATE.q.toLowerCase();
  return STATE.entries.filter(e => {
    if (STATE.starredOnly && !e.starred) return false;
    // Cloud filters are evaluated across the whole authorized library by search.
    if (isCloudMode()) return true;
    if (STATE.sharedOnly && !e.sharedWithMe) return false;
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
  const KEYS = isCloudMode() ? ['since', 'tag'] : ['project','agent','path','since','tag'];
  const tokens = s.split(/\s+/);
  const remaining = [];
  for (const t of tokens) {
    if (!t) continue;
    let exclude = false;
    let token = t;
    if (token.startsWith('-')) { exclude = true; token = token.slice(1); }
    else if (token.toLowerCase().startsWith('not:')) { exclude = true; token = token.slice(4); }
    const m = token.match(/^(\w+):(.+)$/);
    if (m && KEYS.includes(m[1]) && !(isCloudMode() && m[1] === 'since' && exclude)) {
      setChip(m[1], m[2], { exclude });
    } else {
      remaining.push(t);
    }
  }
  return remaining.join(' ');
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
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
let tagsOpenedBySearch = false;

function syncSearchTagPanel() {
  if (!isCloudMode()) return;
  if (STATE.q.trim() && !openFacet) {
    openFacet = 'tag';
    tagsOpenedBySearch = true;
  } else if (!STATE.q.trim() && tagsOpenedBySearch) {
    if (openFacet === 'tag') openFacet = null;
    tagsOpenedBySearch = false;
  }
}

function chipDisplayValue(c) {
  if (c.key === 'author' || c.key === 'updatedBy') return cloudPersonLabel(c.value);
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
    return `<span class="${cls}" title="${title}">${prefix}${escHtml(FACET_DEFS[c.key] && FACET_DEFS[c.key].people ? FACET_DEFS[c.key].title : c.key)}:${escHtml(chipDisplayValue(c))}<span class="x" data-rm="${i}" title="remove">&times;</span></span>`;
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
  if (!openFacet) {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    return;
  }
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  const def = FACET_DEFS[openFacet];
  document.getElementById('facet-panel-title').textContent = def.title;
  const tagQuery = isCloudMode() && openFacet === 'tag' ? STATE.q.trim().toLowerCase() : '';
  const opts = def.getOptions().filter(o => !tagQuery || o.value.toLowerCase().includes(tagQuery));
  const container = document.getElementById('facet-panel-options');
  const focusedPerson = container.contains(document.activeElement) && document.activeElement.dataset.personChoice;
  container.classList.toggle('column', !!def.column);
  panel.querySelector('.syntax-hint').hidden = !!def.people;
  if (def.people) {
    container.innerHTML = opts.map(option => '<button class="sdoc-cloud-lab-access cloud-library-person-option" type="button" data-person-choice="' + escHtml(option.value)
      + '" aria-pressed="' + (chipState(openFacet, option.value) === 'include') + '">' + cloudPersonIcon(option.value) + '<span>' + escHtml(option.label) + '</span></button>').join('');
    container.querySelectorAll('[data-person-choice]').forEach(button => button.addEventListener('click', () => {
      toggleIncludeChip(openFacet, button.dataset.personChoice); renderAll();
    }));
    if (focusedPerson) {
      const replacement = Array.from(container.querySelectorAll('[data-person-choice]')).find(button => button.dataset.personChoice === focusedPerson);
      if (replacement) replacement.focus({ preventScroll: true });
    }
    return;
  }
  if (!opts.length) {
    const tagsLoading = isCloudMode() && openFacet === 'tag' && STATE.cloudTags === null && cloudFiltersLoad && !cloudFiltersLoad.failed;
    container.innerHTML = '<div class="muted" style="font-size:11.5px">' + (tagsLoading ? 'Loading...' : 'no values yet') + '</div>';
    return;
  }
  const exclusive = !!def.exclusive;
  container.innerHTML = opts.map(o => {
    const state = chipState(openFacet, o.value);
    const stateCls = state === 'include' ? 'selected' : state === 'exclude' ? 'excluded' : '';
    // The label is the main click target (acts as +). Then explicit
    // + and - buttons in the right edge of the pill so the user can
    // see what each click will do. Exclude is hidden for exclusive
    // facets where there's no useful "not this date bucket" meaning.
    const plusTitle  = state === 'include' ? 'remove from filter' : 'include';
    const minusTitle = state === 'exclude' ? 'remove from filter' : 'exclude';
    return `
      <div class="facet-option ${stateCls}" data-key="${openFacet}" data-value="${escHtml(o.value)}" ${exclusive ? 'data-exclusive="1"' : ''}>
        <button class="opt-label" data-act="include" type="button">
          <span class="prefix">${openFacet}:</span><span>${tagQuery ? highlight(o.label, tagQuery) : escHtml(o.label)}</span>
          ${o.labelExtra ? `<span class="label-extra">${escHtml(o.labelExtra)}</span>` : ''}
          ${o.count != null ? `<span class="count">${o.count}</span>` : ''}
        </button>
        <button class="opt-btn opt-plus" data-act="include" type="button" title="${plusTitle}" aria-label="${plusTitle}">+</button>
        ${exclusive ? '' : `<button class="opt-btn opt-minus" data-act="exclude" type="button" title="${minusTitle}" aria-label="${minusTitle}">−</button>`}
      </div>
    `;
  }).join('');
  container.querySelectorAll('.facet-option').forEach(el => {
    el.addEventListener('click', (e) => {
      const target = e.target.closest('[data-act]');
      if (!target) return;
      const act = target.dataset.act;
      const k = el.dataset.key, v = el.dataset.value;
      if (act === 'include') toggleIncludeChip(k, v);
      else if (act === 'exclude') toggleExcludeChip(k, v);
      renderAll();
    });
  });

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

// Local calendar-day key for grouping ("2026-07-08"). Uses local date
// parts, not toISOString (which is UTC), so a file touched at 11pm local
// lands on the day the user remembers touching it. Null-dated entries key
// to '' so they collect in one trailing group.
function dayKey(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// "Today" / "Yesterday" for the two most recent days, otherwise a full
// weekday + date ("Tuesday, Jul 8"). The year is appended once the day
// falls outside the current calendar year.
function dayLabel(key) {
  if (!key) return 'No date';
  const todayKey = dayKey(new Date().toISOString());
  const yd = new Date(); yd.setDate(yd.getDate() - 1);
  const yesterdayKey = dayKey(yd.toISOString());
  if (key === todayKey) return 'Today';
  if (key === yesterdayKey) return 'Yesterday';
  const d = new Date(key + 'T12:00:00');
  const opts = { weekday: 'long', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

// One result row. `i` is the running index across the whole shown set so
// the shared keyboard/click handlers (which key off data-idx) work in
// both the flat list and the day-grouped view.
function cloudPersonPills(entry) {
  function pill(id, facet, prefix) {
    if (!id) return '';
    const label = cloudPersonLabel(id), title = FACET_DEFS[facet].title + ' ' + label;
    return '<button class="sdoc-cloud-lab-access cloud-library-person" type="button" data-cloud-person="' + escHtml(id)
      + '" data-person-facet="' + facet + '" title="' + escHtml(title) + '" aria-label="Filter: ' + escHtml(title)
      + '">' + cloudPersonIcon(id) + '<span>' + escHtml(prefix + label) + '</span></button>';
  }
  return pill(entry.authorId, 'author', '') + (entry.updatedById && entry.updatedById !== entry.authorId
    ? pill(entry.updatedById, 'updatedBy', 'Updated by ') : '');
}

const cloudStarWrites = new Set();

function renderRow(e, i, tagMatches) {
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
  const people = isCloudMode() && STATE.cloudMembers.length > 1 ? cloudPersonPills(e) : '';
  const project = !isCloudMode() && e.gitProject ? `<code>${escHtml(e.gitProject)}</code>` : '';
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
        ${people} ${project} ${agent} ${pathHtml} ${rescued}
        ${(e.tags || []).map(t => `<span class="tag ${tagMatches(t)?'match':''}">#${escHtml(t)}</span>`).join('')}
      </div>
      ${snippetHtml ? `<div class="res-snippet">${snippetHtml}</div>` : ''}
    </div>
    <div class="res-side">
      <button class="res-star ${isStarred ? 'on' : ''}" data-star="${escHtml(e.id)}" aria-pressed="${isStarred}" aria-label="${isStarred ? 'Remove star' : 'Star document'}" ${cloudStarWrites.has(e.id) ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="${isStarred ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
      </button>
      <div class="res-when">${escHtml(when)}</div>
    </div>
  </div>
`;
}

function cloudPagination() {
  if (!STATE.cloudPage && !STATE.cloudNextCursor) return '';
  const disabled = STATE.cloudLoading || STATE.cloudRequestKey !== cloudFilterKey();
  return '<nav class="res-overflow" aria-label="Document pages">'
    + '<button class="btn" type="button" data-cloud-page="previous"' + (disabled || !STATE.cloudPage ? ' disabled' : '') + '>Previous</button>'
    + '<span aria-live="polite">' + (STATE.cloudLoading ? 'Loading...' : 'Page ' + (STATE.cloudPage + 1)) + '</span>'
    + '<button class="btn" type="button" data-cloud-page="next"' + (disabled || !STATE.cloudNextCursor ? ' disabled' : '') + '>Next</button></nav>';
}

function renderResults() {
  const all = applyFilters();
  const shown = isCloudMode() ? all : all.slice(0, 60);
  const total = isCloudMode() ? STATE.cloudTotal : all.length;
  if (STATE.selected >= shown.length) STATE.selected = Math.max(0, shown.length - 1);
  STATE.shownLen = shown.length;
  document.getElementById('count').textContent = isCloudMode() && !shown.length && (STATE.cloudLoading || STATE.cloudError)
    ? (STATE.cloudLoading ? 'Searching...' : '') : total + ' result' + (total === 1 ? '' : 's');
  const c = document.getElementById('results');
  if (isCloudMode()) c.setAttribute('aria-busy', String(STATE.cloudLoading));
  if (isCloudMode() && !shown.length && (STATE.cloudLoading || STATE.cloudError)) { c.innerHTML = ''; return; }
  if (!shown.length) {
    if (!STATE.entries.length && !(isCloudMode() && (STATE.q.trim() || STATE.chips.length || STATE.sharedOnly || STATE.starredOnly))) {
      c.innerHTML = isCloudMode()
        ? '<div class="empty">No Cloud documents yet.<div class="tip">Save a document with <code>sdoc file.md --cloud</code>. It will appear here.</div></div>'
        : '<div class="empty">Library is empty.<div class="tip">Open a markdown file with <code>sdoc file.md</code> to add it.</div></div>';
    } else {
      c.innerHTML = '<div class="empty">No matches. Try removing a chip or refining your search.</div>';
    }
    return;
  }

  const tagChips = new Set(STATE.chips.filter(c => c.key === 'tag').map(c => c.value));
  const q = STATE.q.trim().toLowerCase();
  const tagMatches = (tag) => tagChips.has(tag) || (q && tag.toLowerCase().includes(q));

  const overflow = isCloudMode() ? cloudPagination() : all.length > shown.length
    ? `<div class="res-overflow">Showing first ${shown.length} of ${all.length} - narrow with a filter or refine your search.</div>`
    : '';

  // Walk the already-sorted (date-descending) shown set, opening a new
  // group each time the calendar day changes. `all` is sorted the same
  // way, so days stay contiguous and no re-sort is needed.
  let html = '';
  let curKey = null;
  let groupOpen = false;
  shown.forEach((e, i) => {
    const k = dayKey(dateFor(e));
    if (k !== curKey) {
      if (groupOpen) html += '</div></div>';
      curKey = k;
      // Count of shown entries in this day (the run of same-key rows).
      let n = 0;
      for (let j = i; j < shown.length && dayKey(dateFor(shown[j])) === k; j++) n++;
      html += `<div class="day-group">
        <div class="day-header"><span class="day-label">${escHtml(dayLabel(k))}</span><span class="day-count">${n} doc${n === 1 ? '' : 's'}</span></div>
        <div class="results-list">`;
      groupOpen = true;
    }
    html += renderRow(e, i, tagMatches);
  });
  if (groupOpen) html += '</div></div>';
  c.innerHTML = html + overflow;
}

function renderStarToggle() {
  const btn = document.getElementById('star-toggle');
  btn.classList.toggle('on', STATE.starredOnly);
  btn.setAttribute('aria-pressed', STATE.starredOnly ? 'true' : 'false');
}

function renderSharedToggle() {
  const btn = document.getElementById('shared-toggle');
  btn.classList.toggle('on', STATE.sharedOnly);
  btn.setAttribute('aria-pressed', STATE.sharedOnly ? 'true' : 'false');
}

function renderStatus() {
  if (isCloudMode()) {
    document.getElementById('status-line').textContent = 'Cloud';
    return;
  }
  const enabledTxt = STATE.enabled ? '' : ' (disabled)';
  document.getElementById('status-line').textContent =
    `${STATE.entries.length} entries${enabledTxt}`;
}

function renderAll() {
  renderChipsInline();
  renderFacetButtons();
  renderFacetPanel();
  renderStarToggle();
  renderSharedToggle();
  renderResults();
  renderStatus();
  scheduleCloudRefresh();
  const clearBtn = document.getElementById('clear');
  const hasFilters = STATE.chips.length > 0 || STATE.q.trim().length > 0 ||
    STATE.starredOnly || STATE.sharedOnly;
  if (hasFilters) clearBtn.removeAttribute('hidden');
  else clearBtn.setAttribute('hidden', '');
}

// A small fixed dataset for the public demo view. Linked from
// /connect so curious visitors can poke at the library experience
// before installing the CLI. No agent involved, no network call,
// no real files.
const DEMO_ENTRIES = [
  {
    id: 'd1', title: 'Architecture proposal: event bus',
    path: '/Users/example/work/platform/notes/event-bus-proposal.md',
    tags: ['proposal', 'architecture', 'platform'],
    gitProject: 'platform', agent: 'claude-code',
    bodyExcerpt: 'Proposing a small in-process event bus to decouple the ingest pipeline from downstream consumers...',
    mtime: '2026-05-22T10:00:00Z',
  },
  {
    id: 'd2', title: 'Q2 launch plan',
    path: '/Users/example/work/marketing/q2-launch.md',
    tags: ['launch', 'marketing', 'planning'],
    gitProject: 'marketing', agent: 'codex',
    bodyExcerpt: 'Three workstreams, two weeks each, one cross-team checkpoint at the midpoint...',
    mtime: '2026-05-18T14:30:00Z',
  },
  {
    id: 'd3', title: 'Accessibility audit findings',
    path: '/Users/example/work/platform/a11y/audit.md',
    tags: ['a11y', 'audit', 'reliability'],
    gitProject: 'platform', agent: 'claude-code',
    bodyExcerpt: 'Two blockers, six nice-to-haves. The colour contrast in dark mode is the most urgent...',
    mtime: '2026-05-12T09:15:00Z', starred: true,
  },
  {
    id: 'd4', title: 'Meeting notes — design review',
    path: '/Users/example/Documents/notes/design-review-may.md',
    tags: ['meeting-notes', 'design'],
    bodyExcerpt: 'Anna walked us through the new onboarding flow. Three open questions, all about copy...',
    mtime: '2026-05-09T16:45:00Z',
  },
  {
    id: 'd5', title: 'Recipe: weeknight bolognese',
    path: '/Users/example/Documents/personal/recipes/bolognese.md',
    tags: ['recipe', 'personal'],
    bodyExcerpt: 'Brown the mince in batches. Pancetta gives it the depth - don\'t skip it...',
    mtime: '2026-04-28T19:00:00Z',
  },
  {
    id: 'd6', title: 'Scratch ideas from yesterday',
    path: '/Users/example/.sdocs/library/rescued/a1c3-scratch.md',
    rescued: true,
    rescuedFrom: '/tmp/scratch-2026-04-15.md',
    tags: ['scratch'],
    bodyExcerpt: 'Idea: what if the bridge could carry partial documents - just the section you\'re editing?',
    mtime: '2026-04-15T11:30:00Z',
  },
  {
    id: 'd7', title: 'Reading list',
    path: '/Users/example/Documents/notes/reading.md',
    tags: ['reading', 'personal'],
    bodyExcerpt: 'Currently: Designing Data-Intensive Applications. Next up: A Philosophy of Software Design...',
    mtime: '2026-03-20T08:00:00Z',
  },
  {
    id: 'd8', title: 'Onboarding checklist - new hires',
    path: '/Users/example/work/people/onboarding.md',
    tags: ['onboarding', 'people', 'process'],
    gitProject: 'people-ops', agent: 'claude-code',
    bodyExcerpt: 'Day one: accounts, laptop, intro coffee. Week one: shadow each team for a half day...',
    mtime: '2026-05-25T13:20:00Z',
  },
  {
    id: 'd9', title: 'Postmortem - May 14 outage',
    path: '/Users/example/work/platform/postmortems/2026-05-14.md',
    tags: ['postmortem', 'reliability', 'platform'],
    gitProject: 'platform', agent: 'codex',
    bodyExcerpt: 'Root cause: a stale DNS record cached at the edge for 14 hours after we cut over...',
    mtime: '2026-05-15T17:00:00Z', starred: true,
  },
  {
    id: 'd10', title: 'Trip planning - Lisbon',
    path: '/Users/example/Documents/personal/travel/lisbon.md',
    tags: ['travel', 'personal', 'planning'],
    bodyExcerpt: 'Five days in late October. Three days central, two days out to Sintra. Need to book Pasteis...',
    mtime: '2026-05-11T20:45:00Z',
  },
  {
    id: 'd11', title: 'Pricing experiments - Q3',
    path: '/Users/example/work/marketing/pricing-q3.md',
    tags: ['pricing', 'marketing', 'experiment'],
    gitProject: 'marketing',
    bodyExcerpt: 'Three variants, geographic split. Hold annual flat at the top of the funnel; test monthly tiers...',
    mtime: '2026-05-07T11:10:00Z',
  },
  {
    id: 'd12', title: 'API design - rate limits v2',
    path: '/Users/example/work/platform/api/rate-limits.md',
    tags: ['api', 'architecture', 'platform'],
    gitProject: 'platform', agent: 'claude-code',
    bodyExcerpt: 'Move from a fixed per-key bucket to per-route token buckets with shared overdraft...',
    mtime: '2026-05-03T09:30:00Z',
  },
  {
    id: 'd13', title: 'Garden notes - spring 2026',
    path: '/Users/example/Documents/personal/garden/spring-2026.md',
    tags: ['garden', 'personal'],
    bodyExcerpt: 'Tomatoes in by mid-April this year. The dwarf French beans went in too early - frost took half of them...',
    mtime: '2026-04-22T07:30:00Z',
  },
  {
    id: 'd14', title: 'Brainstorm - product names',
    path: '/Users/example/.sdocs/library/rescued/b9f2-names.md',
    rescued: true,
    rescuedFrom: '/tmp/names-2026-04-08.md',
    tags: ['brainstorm', 'naming'],
    bodyExcerpt: 'Words that feel calm but specific. Avoid anything ending in -ify. Three-syllable maximum for the brand...',
    mtime: '2026-04-08T15:00:00Z',
  },
];

function isDemoMode() {
  return typeof window !== 'undefined' &&
    new URLSearchParams(location.search).get('demo') === '1';
}

function isCloudMode() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(location.search);
  return params.get('scope') === 'cloud';
}

function isSignedOutCloudMode() {
  return isCloudMode() && document.body.dataset.cloudAuthenticated !== 'true';
}

function cloudEntry(document) {
  const match = document.matches && document.matches[0];
  return {
    id: document.id,
    starred: document.starred === true,
    title: document.title,
    path: document.filename,
    tags: document.tags || [],
    gitProject: document.project && document.project.name,
    bodyExcerpt: match && match.snippet ? match.snippet : '',
    mtime: document.updated_at,
    cloudRevisionId: document.current_revision_id,
    sharedWithMe: document.shared_with_me === true,
    authorId: document.created_by_user_id,
    updatedById: document.updated_by_user_id,
  };
}

let cloudRequestVersion = 0;
let cloudAbort = null;
let cloudScheduledKey = null;
let cloudTimer = null;
let cloudFiltersLoad = null;
async function getCloudJson(url, options) {
  const response = await fetch(url, Object.assign({ credentials: 'same-origin' }, options));
  if (response.status === 401) {
    location.href = '/cloud/sign-in?return=' + encodeURIComponent(location.pathname + location.search);
    throw new Error('Sign in required');
  }
  if (!response.ok) throw new Error('Cloud returned ' + response.status);
  return response.json();
}
function showCloudFilterError() {
  if (!cloudFiltersLoad || !cloudFiltersLoad.failed || STATE.cloudError) return;
  showBanner({ kind: 'error', message: 'Could not load library filters.' });
  const retry = document.createElement('button');
  retry.className = 'btn'; retry.type = 'button'; retry.textContent = 'Retry';
  retry.addEventListener('click', () => loadCloudFilters(window.SDocsCloudLibrary.workspaceId, true));
  document.getElementById('agent-banner').appendChild(retry);
}
function loadCloudFilters(workspaceId, retry) {
  // Fetch the complete tag vocabulary on entry, independently of document pages
  // and search changes. Opening the tag panel never starts a network request.
  if (!retry && cloudFiltersLoad && cloudFiltersLoad.workspaceId === workspaceId) return;
  if (cloudFiltersLoad) cloudFiltersLoad.controller.abort();
  const load = cloudFiltersLoad = { workspaceId, controller: new AbortController(), failed: false };
  const suffix = '?account_id=' + encodeURIComponent(workspaceId);
  const options = { signal: load.controller.signal };
  const current = () => cloudFiltersLoad === load && window.SDocsCloudLibrary.workspaceId === workspaceId;
  if (retry) hideBanner();
  async function fetchFilter(kind, apply) {
    try {
      const data = await getCloudJson('/api/cloud/v1/account/' + kind + suffix, options);
      if (current()) { apply(data); renderAll(); }
    } catch (error) {
      if (current() && error.name !== 'AbortError') load.failed = true;
    }
  }
  const tags = STATE.cloudTagsWorkspace === workspaceId ? null : fetchFilter('tags', data => {
    STATE.cloudTags = data.tags || [];
    STATE.cloudTagsWorkspace = workspaceId;
  });
  const members = STATE.cloudMembersWorkspace === workspaceId ? null : fetchFilter('members', data => {
    STATE.cloudMembers = data.members || [];
    STATE.cloudMembersWorkspace = workspaceId;
    for (const person of STATE.cloudMembers) STATE.cloudPeople.set(person.user_id, person);
    if (STATE.cloudMembers.length <= 1) {
      STATE.chips = STATE.chips.filter(chip => chip.key !== 'author' && chip.key !== 'updatedBy');
      if (openFacet === 'author' || openFacet === 'updatedBy') openFacet = null;
    }
    document.querySelectorAll('[data-facet="author"], [data-facet="updatedBy"]').forEach(button => { button.hidden = STATE.cloudMembers.length <= 1; });
  });
  load.promise = Promise.all([tags, members]).then(() => {
    if (current()) { renderAll(); showCloudFilterError(); }
  });
}
function cloudFilterKey() {
  return JSON.stringify([window.SDocsCloudLibrary && window.SDocsCloudLibrary.workspaceId,
    STATE.q.trim(), STATE.chips, STATE.sharedOnly, STATE.starredOnly]);
}
function scheduleCloudRefresh() {
  if (!isCloudMode() || isSignedOutCloudMode() || !window.SDocsCloudLibrary || !window.SDocsCloudLibrary.workspaceId) return;
  const key = cloudFilterKey();
  if (cloudScheduledKey === key) return;
  cloudScheduledKey = key;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => loadCloudData(STATE.q).catch(cloudLoadError), 180);
}
function cloudLoadError(error) {
  if (error && error.name === 'AbortError') return;
  showBanner({ kind: 'error', message: 'Cloud search is temporarily unavailable.' });
  const retry = document.createElement('button');
  retry.className = 'btn'; retry.type = 'button'; retry.textContent = 'Retry';
  retry.addEventListener('click', () => loadCloudData(STATE.q, STATE.cloudRetryPage).catch(cloudLoadError));
  document.getElementById('agent-banner').appendChild(retry);
}
function cloudSearchRequest(query) {
  const request = { workspace_id: window.SDocsCloudLibrary.workspaceId, limit: 60,
    query: query.trim() || undefined, sort: 'updated_desc', shared_with_me: STATE.sharedOnly, starred_only: STATE.starredOnly,
    tags: [], tags_none: [] };
  for (const chip of STATE.chips) {
    if (chip.key === 'author' && !chip.exclude) request.author_user_ids = [chip.value];
    if (chip.key === 'updatedBy' && !chip.exclude) request.updated_by_user_ids = [chip.value];
    if (chip.key === 'tag') request[chip.exclude ? 'tags_none' : 'tags'].push(chip.value);
    if (chip.key === 'since' && !chip.exclude) {
      if (chip.value.startsWith('range:')) {
        const [from, to] = chip.value.slice(6).split('..');
        if (from) request.updated_after = new Date(from + 'T00:00:00').toISOString();
        if (to) request.updated_before = new Date(to + 'T23:59:59.999').toISOString();
      } else request.updated_after = new Date(Date.now() - daysFromSince(chip.value) * 86400000).toISOString();
    }
  }
  return request;
}
async function loadCloudData(query, page) {
  const workspaceId = window.SDocsCloudLibrary && window.SDocsCloudLibrary.workspaceId;
  if (!workspaceId || isSignedOutCloudMode()) return;
  const key = cloudFilterKey(), version = ++cloudRequestVersion;
  cloudScheduledKey = key;
  clearTimeout(cloudTimer);
  if (cloudAbort) cloudAbort.abort();
  const controller = cloudAbort = new AbortController();
  const options = { credentials: 'same-origin', signal: controller.signal };
  const reuse = Number.isInteger(page) && page >= 0 && STATE.cloudRequest && STATE.cloudRequestKey === key &&
    (page < STATE.cloudPageCursors.length || (page === STATE.cloudPage + 1 && STATE.cloudNextCursor));
  const targetPage = reuse ? page : 0;
  const cursor = reuse && targetPage > 0
    ? (targetPage === STATE.cloudPage + 1 ? STATE.cloudNextCursor : STATE.cloudPageCursors[targetPage]) : null;
  // Keep exact filters and relative date bounds for both directions. Store only
  // page cursors, so Previous always fetches rows with current permissions.
  const request = reuse ? Object.assign({}, STATE.cloudRequest) : cloudSearchRequest(query);
  if (cursor) request.cursor = cursor;
  if (!reuse && !STATE.q.trim() && !STATE.chips.length && !STATE.sharedOnly) { request.facets = ['authors']; request.facet_limit = 1000; }
  if (!reuse) {
    STATE.entries = []; STATE.cloudTotal = 0; STATE.cloudNextCursor = null;
    STATE.cloudPage = 0; STATE.cloudPageCursors = [null];
    STATE.cloudRequest = null; STATE.cloudRequestKey = null;
  }
  const pageChanged = targetPage !== STATE.cloudPage;
  let loaded = false;
  STATE.cloudRetryPage = null;
  STATE.cloudLoading = true; STATE.cloudError = false;
  hideBanner();
  renderResults();
  loadCloudFilters(workspaceId);
  function current() { return version === cloudRequestVersion && key === cloudFilterKey(); }
  try {
    const data = await getCloudJson('/api/cloud/v1/search', Object.assign({}, options,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }));
    if (!current()) { scheduleCloudRefresh(); return; }
    const documents = data.documents || [];
    // A deletion or revocation can empty a later page. Return to the first page
    // of the same search rather than leaving the user beyond the remaining rows.
    if (targetPage && !documents.length) return loadCloudData(query, 0);
    STATE.cloudRequest = Object.assign({}, request);
    delete STATE.cloudRequest.cursor;
    STATE.cloudRequestKey = key;
    for (const person of (data.facets && data.facets.authors || []).concat(documents.flatMap(doc => [doc.author, doc.updated_by].filter(Boolean)))) {
      if (person.user_id && !STATE.cloudPeople.has(person.user_id)) STATE.cloudPeople.set(person.user_id, person);
    }
    STATE.entries = documents.map(cloudEntry);
    STATE.cloudPage = targetPage;
    STATE.cloudPageCursors = STATE.cloudPageCursors.slice(0, targetPage + 1);
    STATE.cloudPageCursors[targetPage] = cursor;
    STATE.selected = 0;
    STATE.cloudNextCursor = data.next_cursor || null;
    STATE.cloudTotal = data.total_count == null ? STATE.entries.length : data.total_count;
    STATE.lastScanAt = Date.now(); STATE.enabled = true;
    STATE.autostart = { supported: false, enabled: false, userDisabled: false };
    hideBanner();
    loaded = true;
  } catch (error) {
    if (current()) { STATE.cloudError = true; STATE.cloudRetryPage = targetPage; throw error; }
  } finally {
    if (version === cloudRequestVersion) {
      STATE.cloudLoading = false; renderAll(); showCloudFilterError();
      if (loaded && pageChanged) {
        const results = document.getElementById('results');
        results.focus({ preventScroll: true });
        results.scrollIntoView({ block: 'start' });
      }
    }
  }
}

function showDemoBanner() {
  const b = document.getElementById('agent-banner');
  if (!b) return;
  b.className = 'agent-banner info';
  b.innerHTML = '';
  const text = document.createElement('span');
  text.className = 'agent-banner-text';
  text.textContent = 'This is a sample library. The files aren\'t real; nothing connects to your machine. Install SDocs to browse your own files.';
  b.appendChild(text);
  const cmd = document.createElement('code');
  cmd.className = 'agent-banner-cmd';
  cmd.textContent = 'npm i -g sdocs-dev';
  b.appendChild(cmd);
  b.hidden = false;
}

async function loadData() {
  if (isCloudMode()) return loadCloudData(STATE.q);
  if (isDemoMode()) {
    STATE.entries = DEMO_ENTRIES.slice();
    STATE.lastScanAt = Date.now();
    STATE.enabled = true;
    STATE.autostart = { supported: false, enabled: false, userDisabled: false };
    showDemoBanner();
    renderAll();
    return;
  }
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
  if (isCloudMode()) {
    if (cloudStarWrites.has(id)) return;
    const entry = STATE.entries.find(value => value.id === id);
    const workspaceId = window.SDocsCloudLibrary.workspaceId;
    cloudStarWrites.add(id);
    renderResults();
    try {
      const response = await fetch('/api/cloud/v1/documents/' + encodeURIComponent(id) + '/star', {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ starred }) });
      if (!response.ok) throw new Error('Star could not be saved');
      if (workspaceId === window.SDocsCloudLibrary.workspaceId) await loadCloudData(STATE.q, STATE.cloudPage).catch(cloudLoadError);
    } catch (_) {
      if (entry) entry.starred = !starred;
      if (workspaceId === window.SDocsCloudLibrary.workspaceId) {
        const current = STATE.entries.find(value => value.id === id);
        if (current) current.starred = !starred;
        showBanner({ kind: 'error', message: 'Could not save your star. Try again.' });
      }
    } finally {
      cloudStarWrites.delete(id);
      if (workspaceId === window.SDocsCloudLibrary.workspaceId) renderResults();
    }
    return;
  }
  if (isDemoMode()) return; // local state already updated in the click handler
  try {
    await fetch(api('/api/library/star'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, starred }),
    });
  } catch (_) {}
}

// Open a library entry by asking the agent to start a Bridge for the
// underlying file, then opening a bridged URL in a new tab. Live
// editing (including tag edits) works because the Bridge is the single
// write channel. If the bridge-for endpoint fails for any reason
// (e.g. file missing, port exhaustion), fall back to the snapshot URL
// so the user can still read the document.
async function openEntry(id) {
  if (isCloudMode()) {
    window.open(location.origin + '/docs?cloud-document=' + encodeURIComponent(id),
      '_blank', 'noopener');
    return;
  }
  if (isDemoMode()) {
    showDemoBanner();
    return;
  }
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
      window.open(location.origin + '/#' + params.toString(), '_blank', 'noopener');
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
    window.open(new URL(snap.url, location.origin).toString(), '_blank', 'noopener');
  } catch (e) {
    showBanner({ kind: 'error', message: 'Could not open entry: ' + e.message });
  }
}

document.querySelectorAll('.facet-button').forEach(btn => {
  btn.addEventListener('click', () => {
    const facet = btn.dataset.facet;
    tagsOpenedBySearch = false;
    openFacet = openFacet === facet ? null : facet;
    renderAll();
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openFacet) {
    openFacet = null; tagsOpenedBySearch = false; renderAll(); return;
  }
  if (e.key === '/' && document.activeElement !== document.getElementById('q')) {
    e.preventDefault(); document.getElementById('q').focus(); return;
  }
  if (e.target.closest('button, a, select, textarea, [contenteditable]')) return;
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
        syncSearchTagPanel();
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

document.getElementById('shared-toggle').addEventListener('click', () => {
  STATE.sharedOnly = !STATE.sharedOnly;
  renderAll();
});

document.getElementById('results').addEventListener('click', (e) => {
  const pageButton = e.target.closest('[data-cloud-page]');
  if (pageButton) {
    if (!pageButton.disabled) loadCloudData(STATE.q, STATE.cloudPage + (pageButton.dataset.cloudPage === 'next' ? 1 : -1)).catch(cloudLoadError);
    return;
  }
  const person = e.target.closest('[data-cloud-person]');
  if (person) {
    setExclusiveChip(person.dataset.personFacet, person.dataset.cloudPerson);
    openFacet = person.dataset.personFacet; tagsOpenedBySearch = false;
    renderAll();
    const option = Array.from(document.querySelectorAll('[data-person-choice]')).find(button => button.dataset.personChoice === person.dataset.cloudPerson);
    if (option) option.focus({ preventScroll: true });
    return;
  }
  const starBtn = e.target.closest('[data-star]');
  if (starBtn) {
    const id = starBtn.dataset.star;
    const entry = STATE.entries.find(x => x.id === id);
    if (entry && !cloudStarWrites.has(id)) {
      entry.starred = !entry.starred;
      toggleStar(id, entry.starred);
      renderAll();
    }
    return;
  }
  const row = e.target.closest('.res');
  if (!row) return;
  STATE.selected = parseInt(row.dataset.idx, 10);
  const id = row.dataset.id;
  renderAll();
  openEntry(id);
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
  syncSearchTagPanel();
  renderAll();

});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Backspace' && !input.value && STATE.chips.length) {
    STATE.chips.pop(); renderAll();
  }
});

document.getElementById('clear').addEventListener('click', () => {
  STATE.chips = []; STATE.q = ''; STATE.starredOnly = false; STATE.sharedOnly = false;
  syncSearchTagPanel();
  input.value = ''; renderAll();

});

// Hold the kick-off fetch until we know the user has been through
// /connect. The ensureConnected() IIFE at the top of the file
// redirects in that case; we just need to make sure no loopback
// fetch races the navigation. Demo and force modes both skip the
// gate, but only the connected / force paths actually hit the agent
// (loadData() short-circuits to baked entries when demo=1).
const search = new URLSearchParams(location.search);
if (search.get('tag')) STATE.chips.push({ key: 'tag', value: search.get('tag') });
if (search.get('starred') === '1') STATE.starredOnly = true;
if (search.get('shared') === '1') STATE.sharedOnly = true;
if (!isSignedOutCloudMode() && (!window.SDocsConnect ||
    window.SDocsConnect.isConnected() ||
    search.get('force') === '1' ||
    search.get('demo')  === '1')) {
  loadData();
}

if (isCloudMode()) {
  document.getElementById('star-toggle').hidden = false;
  document.getElementById('shared-toggle').hidden = false;
  document.getElementById('q').placeholder = 'search titles, tags, and document text...';
  const projectButton = document.querySelector('[data-facet="project"]');
  if (projectButton) projectButton.hidden = true;
  const pathButton = document.querySelector('[data-facet="path"]');
  if (pathButton) pathButton.hidden = true;
  const agentButton = document.querySelector('[data-facet="agent"]');
  if (agentButton) agentButton.hidden = true;
  document.body.classList.add('cloud-library');
  const results = document.getElementById('results');
  results.tabIndex = -1;
  results.setAttribute('role', 'region');
  results.setAttribute('aria-label', 'Documents');
}

window.addEventListener('sdocs-cloud-workspace-change', function () {
  if (cloudFiltersLoad) cloudFiltersLoad.controller.abort();
  cloudFiltersLoad = null;
  STATE.entries = []; STATE.cloudMembers = []; STATE.cloudPeople = new Map();
  STATE.cloudMembersWorkspace = null;
  STATE.cloudTagsWorkspace = null; STATE.cloudTags = null; STATE.cloudNextCursor = null; STATE.cloudTotal = 0;
  STATE.cloudRequest = null; STATE.cloudRequestKey = null; STATE.cloudError = false;
  STATE.cloudPage = 0; STATE.cloudPageCursors = [null]; STATE.cloudRetryPage = null;
  STATE.chips = STATE.chips.filter(chip => chip.key !== 'author' && chip.key !== 'updatedBy');
  document.querySelectorAll('[data-facet="author"], [data-facet="updatedBy"]').forEach(button => { button.hidden = true; });
  if (openFacet === 'author' || openFacet === 'updatedBy') openFacet = null;
  STATE.q = '';
  syncSearchTagPanel();
  input.value = '';
  STATE.cloudLoading = true;
  renderAll();
  loadCloudData('').catch(function () {
    showBanner({ kind: 'error', message: 'Could not load this Cloud workspace.' });
  });
});
