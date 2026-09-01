import { render } from '/sdk/0.3.0/smalldocs.js';

const documents = Object.freeze({
  summary: {
    label: 'executive summary',
    source: '/public/developers/example/executive-summary.md',
  },
  briefing: {
    label: 'briefing slides',
    source: '/public/developers/example/briefing.md',
  },
  charts: {
    label: 'market charts',
    source: '/public/developers/example/charts.md',
  },
  model: {
    label: 'financial model',
    source: '/public/developers/example/model.md',
  },
  walkthrough: {
    label: 'guided walkthrough',
    source: '/public/developers/example/walkthrough.md',
  },
});

const surface = document.querySelector('.analysis-surface');
const mount = document.getElementById('analysis-document');
const loading = document.querySelector('.example-loading');
const buttons = Array.from(document.querySelectorAll('[data-document]'));
let view;
let generation = 0;

function setSelected(slug) {
  buttons.forEach(function (button) {
    button.setAttribute('aria-selected', String(button.dataset.document === slug));
  });
}

async function showDocument(slug) {
  const documentConfig = documents[slug];
  if (!documentConfig) return;
  const request = ++generation;
  setSelected(slug);
  surface.setAttribute('aria-busy', 'true');
  loading.textContent = 'Loading ' + documentConfig.label;
  loading.hidden = false;

  try {
    const response = await fetch(documentConfig.source, { headers: { Accept: 'text/markdown' } });
    if (!response.ok) throw new Error('Document returned HTTP ' + response.status);
    const markdown = await response.text();
    if (request !== generation) return;
    if (view) await view.update(markdown);
    else view = await render(mount, markdown, { runnableHtml: true });
    if (request !== generation) return;
    loading.hidden = true;
    surface.setAttribute('aria-busy', 'false');
  } catch (error) {
    if (request !== generation) return;
    if (view) {
      view.destroy();
      view = undefined;
    }
    mount.replaceChildren();
    const message = document.createElement('pre');
    message.className = 'example-error';
    message.textContent = 'Could not load this analysis.\n\n' + error.message;
    mount.appendChild(message);
    loading.hidden = true;
    surface.setAttribute('aria-busy', 'false');
  }
}

buttons.forEach(function (button) {
  button.addEventListener('click', function () {
    showDocument(button.dataset.document);
  });
});

window.addEventListener('pagehide', function () {
  if (view) view.destroy();
}, { once: true });

showDocument('summary');
