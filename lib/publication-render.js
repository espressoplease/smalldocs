'use strict';

const { Marked, Renderer } = require('marked');
const yaml = require('../cli/shared/sdocs-yaml');
const styles = require('../cli/shared/sdocs-styles');
const { slugify } = require('../cli/shared/sdocs-slugify');
const strikethrough = require('../public/sdocs-marked-del-core');

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// Marked has already escaped entities in link/image token attributes. Keep
// those entities while escaping attribute delimiters and unescaped ampersands.
function escapeMarkedAttribute(value) {
  return String(value == null ? '' : value)
    .replace(/&(?!(?:#\d+|#x[a-f0-9]+|[a-z][a-z0-9]+);)/gi, '&amp;')
    .replace(/[<>"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Only explicitly permitted URL schemes reach an HTML URL attribute. In
// particular, entity-encoded scheme names cannot become relative URLs.
function publicUrl(value, { image = false, fragment = false } = {}) {
  const source = String(value || '').trim();
  if (fragment && /^#[^\s<>]*$/.test(source)) return source;
  if (!/^(https?:\/\/|mailto:)/i.test(source) || /[\u0000-\u0020\u007f]/.test(source)) return '';
  try {
    const url = new URL(source);
    if (url.username || url.password) return '';
    if (url.protocol !== 'https:' && url.protocol !== 'http:' && (!image && url.protocol !== 'mailto:')) return '';
    if (image && url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.href;
  } catch (_) { return ''; }
}

const colorIds = new Set(styles.ALL_COLOR_IDS);
const palettes = new Set(['monochrome', 'mono', 'complementary', 'analogous', 'triadic', 'pastel', 'warm', 'cool', 'earth']);
function safeControl(id, value) {
  const text = String(value == null ? '' : value).trim();
  if (colorIds.has(id)) return /^#[a-f0-9]{6}$/i.test(text) ? text : null;
  if (id === '_sd_ctrl-chart-palette') return palettes.has(text) ? text : null;
  if (id === '_sd_ctrl-link-decoration') return ['underline', 'none'].includes(text) ? text : null;
  if (/font-family$|code-font$/.test(id)) return /^[a-z0-9'" ,-]+$/i.test(text) ? text : null;
  if (/-weight$/.test(id)) return /^(?:[1-9]00|normal|bold)$/.test(text) ? text : null;
  if (/-num$/.test(id) && text && Number.isFinite(Number(text)) && Number(text) >= 0) return String(Number(text));
  return null;
}

function styleDeclarations(controls) {
  const valid = {};
  Object.entries(controls).forEach(([id, value]) => {
    const safe = safeControl(id, value);
    if (safe !== null) valid[id] = safe;
  });
  const overridden = new Set(Object.keys(valid).filter(id => colorIds.has(id)));
  const cascaded = Object.assign({}, valid);
  Object.entries(valid).forEach(([id, value]) => {
    if (colorIds.has(id)) Object.assign(cascaded, styles.cascadeColor(id, value, overridden));
  });
  const declarations = new Map();
  Object.entries(cascaded).forEach(([id, value]) => {
    styles.controlToCssVars(id, value, cascaded).forEach(entry => declarations.set(entry.cssVar, entry.value));
  });
  return Array.from(declarations, ([key, value]) => key + ':' + value).join(';');
}

function publicationStyles(meta) {
  if (!meta || typeof meta !== 'object' || !meta.styles || typeof meta.styles !== 'object') return '';
  const controls = styles.stylesToControls(meta.styles).controls;
  const dark = {};
  Object.entries(controls).forEach(([id, value]) => {
    if (colorIds.has(id) && safeControl(id, value) !== null) {
      dark[id] = styles.invertLightness(String(value), styles.colorControlRole(id));
    }
  });
  Object.assign(dark, styles.parseDarkBlock(meta.styles.dark));
  const lightCss = styleDeclarations(controls);
  const darkCss = styleDeclarations(dark);
  if (!lightCss && !darkCss) return '';
  return '<style>html #_sd_rendered{' + lightCss + '}html[data-theme="dark"] #_sd_rendered{' + darkCss + '}</style>\n';
}

function chartTable(source) {
  let data;
  try { data = JSON.parse(source); } catch (_) { return ''; }
  if (!data || typeof data !== 'object' || !Array.isArray(data.labels)) return '';
  const sets = Array.isArray(data.datasets) ? data.datasets : (Array.isArray(data.values) ? [{ label: 'Value', data: data.values }] : []);
  if (!sets.length || sets.some(set => !set || !Array.isArray(set.data))) return '';
  const cell = value => escapeHtml(value && typeof value === 'object' ? JSON.stringify(value) : value);
  return '<div class="publication-table"><table><caption>' + escapeHtml(data.title || 'Chart data') + '</caption><thead><tr><th scope="col">Label</th>'
    + sets.map(set => '<th scope="col">' + cell(set.label || 'Value') + '</th>').join('')
    + '</tr></thead><tbody>' + data.labels.map((label, i) => '<tr><th scope="row">' + cell(label) + '</th>'
      + sets.map(set => '<td>' + cell(set.data[i]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
}

function renderArticle(body) {
  const renderer = new Renderer();
  const headings = new Map();
  const features = new Set();
  renderer.html = html => escapeHtml(html);
  renderer.link = (href, title, text) => {
    const safe = publicUrl(href, { fragment: true });
    return safe ? '<a href="' + escapeMarkedAttribute(safe) + '" rel="nofollow ugc noreferrer"' + (title ? ' title="' + escapeMarkedAttribute(title) + '"' : '') + '>' + text + '</a>' : text;
  };
  renderer.image = (href, title, text) => {
    const safe = publicUrl(href, { image: true });
    return safe ? '<img src="' + escapeMarkedAttribute(safe) + '" alt="' + escapeMarkedAttribute(text) + '" loading="lazy" decoding="async" referrerpolicy="no-referrer"' + (title ? ' title="' + escapeMarkedAttribute(title) + '"' : '') + '>' : escapeMarkedAttribute(text);
  };
  renderer.heading = (text, level, raw) => {
    const base = slugify(raw) || 'section';
    const count = headings.get(base) || 0;
    headings.set(base, count + 1);
    const id = base + (count ? '-' + count : '');
    return '<h' + level + ' id="' + escapeHtml(id) + '">' + text + '</h' + level + '>\n';
  };
  renderer.table = (header, body) => '<div class="md-table-scroll">' + Renderer.prototype.table.call(renderer, header, body) + '</div>\n';
  renderer.code = (code, info) => {
    const language = String(info || '').trim().split(/\s+/)[0];
    const safeLanguage = /^[a-z0-9_+-]+$/i.test(language) ? language.toLowerCase() : '';
    const listing = '<pre><code' + (safeLanguage ? ' class="language-' + safeLanguage + '"' : '') + '>' + escapeHtml(code) + '\n</code></pre>\n';
    if (!['chart', 'mermaid'].includes(safeLanguage)) return listing;
    features.add(safeLanguage);
    return '<figure class="publication-rich" data-publication-feature="' + safeLanguage + '"><div class="publication-rich-stage">' + listing + '</div>'
      + (safeLanguage === 'chart' ? chartTable(code) : '') + '</figure>\n';
  };
  const parser = new Marked(strikethrough.extension, { renderer, gfm: true, async: false });
  return { html: parser.parse(body), features };
}

function safeDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function renderPublicationPage({ markdown = '', title = '', description = '', url = '', publishedAt, updatedAt, authorName = '' } = {}) {
  const parsed = yaml.parseFrontMatter(String(markdown));
  const body = parsed.body;
  const pageTitle = String(title || 'Untitled document');
  const canonical = publicUrl(url, { image: true });
  const published = safeDate(publishedAt);
  const updated = safeDate(updatedAt);
  const article = renderArticle(body);
  const metadata = [];
  if (authorName) metadata.push('<span>' + escapeHtml(authorName) + '</span>');
  if (published) metadata.push('<time datetime="' + published + '">' + new Date(published).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) + '</time>');
  if (updated && updated !== published) metadata.push('<span>Updated <time datetime="' + updated + '">' + new Date(updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) + '</time></span>');
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<meta name="color-scheme" content="light dark">\n<title>' + escapeHtml(pageTitle) + ' | SmallDocs</title>\n'
    + '<meta name="description" content="' + escapeHtml(description) + '">\n<meta name="robots" content="index,follow">\n'
    + (canonical ? '<link rel="canonical" href="' + escapeHtml(canonical) + '">\n<meta property="og:url" content="' + escapeHtml(canonical) + '">\n' : '')
    + '<meta property="og:type" content="article">\n<meta property="og:site_name" content="SmallDocs">\n<meta property="og:title" content="' + escapeHtml(pageTitle) + '">\n<meta property="og:description" content="' + escapeHtml(description) + '">\n'
    + (published ? '<meta property="article:published_time" content="' + published + '">\n' : '')
    + (updated ? '<meta property="article:modified_time" content="' + updated + '">\n' : '')
    + '<link rel="stylesheet" href="/public/css/tokens.css">\n<link rel="stylesheet" href="/public/css/rendered.css">\n<link rel="stylesheet" href="/public/css/prose-reader.css">\n<link rel="stylesheet" href="/public/css/publication.css">\n'
    + publicationStyles(parsed.meta) + '<script defer src="/public/publication-reader.js"></script>\n</head>\n<body class="publication-page">\n'
    + '<header class="publication-topbar"><a class="publication-brand" href="https://smalldocs.org/">SmallDocs</a><button class="publication-theme" type="button" aria-label="Toggle dark mode" hidden><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg></button></header>\n'
    + '<main><article id="_sd_rendered" aria-label="' + escapeHtml(pageTitle) + '">'
    + article.html + '</article>'
    + (metadata.length ? '<footer class="publication-meta">' + metadata.join('<span aria-hidden="true">·</span>') + '</footer>\n' : '')
    + '</main>\n<script id="publication-source" type="application/json">'
    + JSON.stringify({ markdown: body }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    + '</script>\n</body>\n</html>\n';
}

module.exports = { renderPublicationPage };
