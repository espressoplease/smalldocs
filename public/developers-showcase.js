import { render } from '/sdk/0.2.0/smalldocs.js';

const examples = Object.freeze({
  complete: {
    eyebrow: 'Full feature surface',
    title: 'Investment decision room',
    summary: 'One agent document using every supported renderer feature.',
    label: 'complete analysis',
    source: '/public/developers/showcase/complete-analysis.md',
    options: {
      navigation: true,
      sections: { collapsible: true, defaultOpen: true },
      controls: { copy: true, fullscreen: true, download: true },
    },
  },
  editorial: {
    eyebrow: 'Host-styled reading',
    title: 'Fieldwork editorial report',
    summary: 'Serif typography, a custom palette, and sections that always stay open.',
    label: 'editorial report',
    source: '/public/developers/example/field-report.md',
    options: {
      navigation: true,
      sections: { collapsible: false },
      controls: { copy: true, fullscreen: true, download: true },
    },
  },
  compact: {
    eyebrow: 'Compact embedded answer',
    title: 'Operations console answer',
    summary: 'The host supplies navigation while the document keeps rich fullscreen views.',
    label: 'compact answer',
    source: '/public/developers/showcase/compact-answer.md',
    options: {
      navigation: false,
      sections: { collapsible: false },
      controls: { copy: false, fullscreen: true, download: false },
    },
  },
  reference: {
    eyebrow: 'Long reference',
    title: 'Runbook and operating controls',
    summary: 'Navigation stays visible and substantial sections begin closed.',
    label: 'long reference',
    source: '/public/developers/showcase/long-reference.md',
    options: {
      navigation: true,
      sections: { collapsible: true, defaultOpen: false },
      controls: { copy: true, fullscreen: true, download: true },
    },
  },
});

const surface = document.querySelector('.showcase-surface');
const mount = document.getElementById('showcase-document');
const loading = document.querySelector('.example-loading');
const title = document.getElementById('showcase-title');
const eyebrow = document.getElementById('showcase-eyebrow');
const summary = document.getElementById('showcase-summary');
const config = document.getElementById('showcase-config');
const select = document.getElementById('showcase-select');
const buttons = Array.from(document.querySelectorAll('[data-showcase-choice]'));
let view;
let generation = 0;

function readableOptions(options) {
  return JSON.stringify(options, null, 2);
}

function selectExample(slug) {
  buttons.forEach(function (button) {
    button.setAttribute('aria-pressed', String(button.dataset.showcaseChoice === slug));
  });
  select.value = slug;
}

function showError(error) {
  mount.replaceChildren();
  const message = document.createElement('pre');
  message.className = 'example-error';
  message.textContent = 'Could not load this example.\n\n' + error.message;
  mount.appendChild(message);
}

async function showExample(slug) {
  const example = examples[slug];
  if (!example) return;
  const request = ++generation;
  selectExample(slug);
  document.body.dataset.showcase = slug;
  eyebrow.textContent = example.eyebrow;
  title.textContent = example.title;
  summary.textContent = example.summary;
  config.textContent = readableOptions(example.options);
  loading.textContent = 'Loading ' + example.label;
  loading.hidden = false;
  surface.setAttribute('aria-busy', 'true');

  if (view) {
    view.destroy();
    view = undefined;
  }

  try {
    const response = await fetch(example.source, { headers: { Accept: 'text/markdown' } });
    if (!response.ok) throw new Error('Document returned HTTP ' + response.status);
    const markdown = await response.text();
    if (request !== generation) return;
    view = await render(mount, markdown, example.options);
    if (request !== generation) {
      view.destroy();
      view = undefined;
      return;
    }
    history.replaceState(null, '', '/developers/examples?document=' + slug);
    loading.hidden = true;
    surface.setAttribute('aria-busy', 'false');
    document.body.dataset.demoReady = 'true';
  } catch (error) {
    if (request !== generation) return;
    showError(error);
    loading.hidden = true;
    surface.setAttribute('aria-busy', 'false');
    document.body.dataset.demoReady = 'error';
  }
}

buttons.forEach(function (button) {
  button.addEventListener('click', function () {
    showExample(button.dataset.showcaseChoice);
  });
});

select.addEventListener('change', function () {
  showExample(select.value);
});

window.addEventListener('pagehide', function () {
  if (view) view.destroy();
}, { once: true });

const initial = new URLSearchParams(location.search).get('document');
showExample(examples[initial] ? initial : 'complete');
