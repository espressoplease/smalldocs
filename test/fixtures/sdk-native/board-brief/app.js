import { render } from '__SDOCS_ORIGIN__/sdk/0.3.0/smalldocs.js';
import { boardMarkdown, boardUpdateMarkdown } from './briefing.js';

function measureHostProbes() {
  const heading = getComputedStyle(document.getElementById('host-heading'));
  const button = getComputedStyle(document.getElementById('host-button'));
  const table = getComputedStyle(document.getElementById('host-table'));
  return {
    heading: {
      color: heading.color,
      fontFamily: heading.fontFamily,
      textTransform: heading.textTransform,
    },
    button: {
      color: button.color,
      backgroundColor: button.backgroundColor,
      borderRadius: button.borderRadius,
      boxShadow: button.boxShadow,
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
  const view = await render('#briefing-report', boardMarkdown, {
    navigation: true,
    sections: {
      collapsible: true,
      defaultOpen: true,
    },
    controls: {
      copy: true,
      fullscreen: true,
    },
  });

  window.boardView = view;
  window.hostProbeAfter = measureHostProbes();
  window.updateBoardDocument = async () => view.update(boardUpdateMarkdown);
  window.restoreBoardDocument = async () => view.update(boardMarkdown);
  window.destroyBoardDocument = () => view.destroy();
  document.body.dataset.ready = 'true';
} catch (error) {
  document.body.dataset.error = error instanceof Error ? error.message : String(error);
}
