'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function escape(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
function decode(value) { return String(value || '').replace(/&#(?:x([a-f0-9]+)|(\d+));|&(amp|lt|gt|quot|apos);/gi, (all, hex, number, named) => named ? ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[named.toLowerCase()] : String.fromCodePoint(parseInt(hex || number, hex ? 16 : 10))); }
function json(value) { return JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026'); }
function publicationSource(row, origin) {
  if (row.public_source) return JSON.parse(row.public_source);
  const html = row.rendered_html || '';
  const payload = /<script id="publication-source" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  const title = decode((/<title>([\s\S]*?) \| SmallDocs<\/title>/.exec(html) || [,'Published document'])[1]);
  const description = decode((/<meta name="description" content="([^"]*)"/.exec(html) || [,''])[1]);
  const source = {title,description,url:origin + '/p/' + row.slug};
  // Legacy HTML is already public. Keep it as the source for recovery without
  // reading a private document or substituting a later draft.
  if (payload) source.markdown = JSON.parse(payload[1]).markdown;
  source.legacyHtml = html;
  return source;
}
function documentRoot(row) {
  const html = row.rendered_html || '';
  if (/^\s*<div\b[^>]*id="_sd_rendered"/.test(html)) return html;
  const article = /<article\b[^>]*id="_sd_rendered"[^>]*>([\s\S]*?)<\/article>/.exec(html);
  return '<div id="_sd_rendered" class="sdoc-reader">' + (article ? article[1].replace(/^<h1>Untitled document<\/h1>\s*/, '').replace(/<div class="publication-meta">[\s\S]*?<\/div>/,'') : '') + '</div>';
}
function renderPublicationShell({source,rootHtml='',renderedStyles={},substitutions={},compile=false,template} = {}) {
  let html = template || fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  html = html.replace('<html lang="en">','<html lang="en" data-sdocs-publication>');
  substitutions = {...{
    '__APP_VERSION__':'publication', '__SDOCS_DEV__':'0', '__DEFAULT_MD_PATH__':'/public/sdoc.md',
    '__CSP_NONCE__':crypto.randomBytes(16).toString('base64'), '__CLOUD_UI_STYLES__':'', '__CLOUD_UI_SCRIPT__':'',
    '__DOCUMENT_LIBRARY_HREF__':'/library?scope=cloud',
    '__DOCUMENT_LEGACY_LIBRARY__':'false', '__DOCUMENT_CLOUD_AUTHENTICATED__':'false',
    '__DOCUMENT_CLOUD_TERMS_ACCEPTED__':'false', '__DOCUMENT_NAV_MENU_HIDDEN__':'hidden',
    '<!--__DOCUMENT_NAV_MENU_BEFORE__-->':'', '<!--__DOCUMENT_NAV_MENU_AFTER__-->':''
  },...substitutions};
  for (const [key,value] of Object.entries(substitutions)) html = html.split(key).join(String(value));
  const title = escape(source.title || 'Published document'), description = escape(source.description || ''), url = escape(source.url);
  html = html.replace(/<title>[\s\S]*?<\/title>/,() => '<title>' + title + ' | SmallDocs</title>')
    .replace(/<meta\s+(?:name="(?:description|twitter:[^"]*)"|property="og:[^"]*")[^>]*>\s*/g,'');
  const metadata = '<meta name="description" content="' + description + '">\n<meta name="robots" content="index,follow">\n<link rel="canonical" href="' + url + '">\n<meta property="og:type" content="article">\n<meta property="og:title" content="' + title + '">\n<meta property="og:description" content="' + description + '">\n<meta property="og:url" content="' + url + '">\n';
  html = html.replace('<!--__SDOCS_PUBLICATION_DATA__-->', () => metadata + '<script id="sdocs-publication-data" type="application/json">' + json({...source,compile}) + '</script>');
  const styles=(renderedStyles.shape ? '<style id="sdocs-shape-render-css">'+String(renderedStyles.shape).replace(/</g,'\\3c ')+'</style>' : '') +
    (renderedStyles.math ? '<link id="katex-css" rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">' : '');
  html=html.replace('</head>',()=>styles+'</head>');
  if (rootHtml) html = html.replace('<div id="_sd_rendered" class="sdoc-reader"></div>', () => rootHtml);
  return html;
}
module.exports = {renderPublicationShell,publicationSource,documentRoot};
