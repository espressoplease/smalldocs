import { render } from '/sdk/0.3.0/smalldocs.js';

const paper = document.querySelector('.field-paper');
const loading = document.querySelector('.field-loading');
const mount = document.getElementById('field-report');
let view;

async function openReport() {
  try {
    const response = await fetch('/public/developers/example/field-report.md', {
      headers: { Accept: 'text/markdown' },
    });
    if (!response.ok) throw new Error('Document returned HTTP ' + response.status);
    const markdown = await response.text();
    view = await render(mount, markdown, {
      navigation: true,
      sections: {
        collapsible: false,
        defaultOpen: true,
      },
      controls: {
        copy: true,
        fullscreen: true,
        download: true,
      },
    });
    loading.hidden = true;
    paper.setAttribute('aria-busy', 'false');
    document.body.dataset.demoReady = 'true';
  } catch (error) {
    mount.replaceChildren();
    const message = document.createElement('pre');
    message.className = 'field-error';
    message.textContent = 'Could not load the field report.\n\n' + error.message;
    mount.appendChild(message);
    loading.hidden = true;
    paper.setAttribute('aria-busy', 'false');
    document.body.dataset.demoReady = 'error';
  }
}

window.addEventListener('pagehide', function () {
  if (view) view.destroy();
}, { once: true });

openReport();
