import { render } from '/sdk/0.1.2/smalldocs.js';

const pages = Object.freeze({
  sdk: { path: '/developers', label: 'Render in your app', markdown: '/developers/integration.md' },
  agents: { path: '/developers/agents', label: 'Author with an agent', markdown: '/developers/agents.md' },
  'authoring/markdown': { path: '/developers/authoring/markdown', label: 'Authoring / Markdown', markdown: '/developers/authoring/markdown.md' },
  'authoring/code': { path: '/developers/authoring/code', label: 'Authoring / Code', markdown: '/developers/authoring/code.md' },
  'authoring/math': { path: '/developers/authoring/math', label: 'Authoring / Math', markdown: '/developers/authoring/math.md' },
  'authoring/diagrams': { path: '/developers/authoring/diagrams', label: 'Authoring / Diagrams', markdown: '/developers/authoring/diagrams.md' },
  'authoring/charts': { path: '/developers/authoring/charts', label: 'Authoring / Charts', markdown: '/developers/authoring/charts.md' },
  'authoring/cells': { path: '/developers/authoring/cells', label: 'Authoring / Computed cells', markdown: '/developers/authoring/cells.md' },
  'authoring/slides': { path: '/developers/authoring/slides', label: 'Authoring / Slides', markdown: '/developers/authoring/slides.md' },
  'authoring/slide-shapes': { path: '/developers/authoring/slide-shapes', label: 'Authoring / Custom slide shapes', markdown: '/developers/authoring/slide-shapes.md' },
  'authoring/video': { path: '/developers/authoring/video', label: 'Authoring / Video', markdown: '/developers/authoring/video.md' },
  'authoring/styles': { path: '/developers/authoring/styles', label: 'Authoring / Styles', markdown: '/developers/authoring/styles.md' },
});

const documentShell = document.getElementById('developer-document');
const mount = document.getElementById('developer-renderer');
const loadingMessage = document.querySelector('.loading-message');
const sidebar = document.getElementById('developer-sidebar');
const menuButton = document.querySelector('.mobile-menu');
const referenceGroup = document.getElementById('agent-references');
let view;
let requestGeneration = 0;

function setLoading(loading) {
  loadingMessage.hidden = !loading;
  documentShell.setAttribute('aria-busy', String(loading));
}

function slugFromPath(pathname) {
  if (pathname === '/developers' || pathname === '/developers/') return 'sdk';
  const match = /^\/developers\/((?:authoring\/)?[a-z-]+)\/?$/.exec(pathname);
  if (!match) return null;
  if (pages[match[1]]) return match[1];
  if (/^(overview|quickstart|content|lifecycle|security|loading|api)$/.test(match[1])) return 'sdk';
  return null;
}

function setActive(slug) {
  document.querySelectorAll('[data-doc]').forEach(function (link) {
    if (link.dataset.doc === slug) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (slug.startsWith('authoring/')) referenceGroup.open = true;
  const page = pages[slug];
  document.title = page.label + ' - SmallDocs developers';
}

async function loadPage(slug, push) {
  const page = pages[slug];
  if (!page) return;
  const generation = ++requestGeneration;
  setActive(slug);
  setLoading(true);
  if (push) history.pushState({ slug: slug }, '', page.path);

  let markdown;
  try {
    const response = await fetch(page.markdown, { headers: { Accept: 'text/markdown' } });
    if (!response.ok) throw new Error('Documentation returned HTTP ' + response.status);
    markdown = await response.text();
    if (generation !== requestGeneration) return;
    if (view) await view.update(markdown);
    else view = await render(mount, markdown);
    if (generation !== requestGeneration) return;
    setLoading(false);
    window.scrollTo({ top: 0, behavior: push ? 'smooth' : 'auto' });
  } catch (error) {
    if (generation !== requestGeneration) return;
    if (view) {
      view.destroy();
      view = undefined;
    }
    mount.replaceChildren();
    const fallback = document.createElement('pre');
    fallback.className = 'document-error';
    fallback.textContent = markdown || ('Could not load this documentation page.\n\n' + error.message);
    mount.appendChild(fallback);
    setLoading(false);
  }

  sidebar.classList.remove('open');
  menuButton.setAttribute('aria-expanded', 'false');
}

document.addEventListener('click', function (event) {
  const link = event.target.closest('[data-doc]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  loadPage(link.dataset.doc, true);
});

window.addEventListener('popstate', function () {
  loadPage(slugFromPath(location.pathname) || 'sdk', false);
});

menuButton.addEventListener('click', function () {
  const open = sidebar.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(open));
});

window.addEventListener('pagehide', function () {
  if (view) view.destroy();
}, { once: true });

loadPage(slugFromPath(location.pathname) || 'sdk', false);
