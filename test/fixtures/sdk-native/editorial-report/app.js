import { render } from '__SDOCS_ORIGIN__/sdk/0.3.0/smalldocs.js';
import {
  editorialMarkdown,
  editorialUpdateMarkdown,
  unsafeMarkdown,
} from './report.js';

function measureHostProbes() {
  const heading = getComputedStyle(document.getElementById('host-heading'));
  const button = getComputedStyle(document.getElementById('host-button'));
  const table = getComputedStyle(document.getElementById('host-table'));
  return {
    heading: {
      color: heading.color,
      fontFamily: heading.fontFamily,
      fontSize: heading.fontSize,
    },
    button: {
      color: button.color,
      backgroundColor: button.backgroundColor,
      borderRadius: button.borderRadius,
      padding: button.padding,
    },
    table: {
      color: table.color,
      backgroundColor: table.backgroundColor,
      borderCollapse: table.borderCollapse,
    },
  };
}

window.hostProbeBefore = measureHostProbes();

try {
  const view = await render('#report', editorialMarkdown, {
    navigation: true,
    sections: {
      collapsible: true,
      defaultOpen: false,
    },
    controls: {
      copy: true,
      fullscreen: true,
    },
  });

  window.editorialView = view;
  window.hostProbeAfter = measureHostProbes();
  window.updateEditorialDocument = async () => view.update(editorialUpdateMarkdown);
  window.restoreEditorialDocument = async () => view.update(editorialMarkdown);
  window.renderUnsafeFixture = async () => view.update(unsafeMarkdown);
  window.destroyEditorialDocument = () => view.destroy();
  document.body.dataset.ready = 'true';
} catch (error) {
  document.body.dataset.error = error instanceof Error ? error.message : String(error);
}
