import { render } from '__SDOCS_ORIGIN__/sdk/0.3.0/smalldocs.js';
import {
  capacityMarkdown,
  capacityUpdateMarkdown,
  riskMarkdown,
  riskUpdateMarkdown,
} from './documents.js';

function measureHostProbes() {
  const heading = getComputedStyle(document.getElementById('host-heading'));
  const button = getComputedStyle(document.getElementById('host-button'));
  const table = getComputedStyle(document.getElementById('host-table'));
  return {
    heading: {
      color: heading.color,
      fontFamily: heading.fontFamily,
      letterSpacing: heading.letterSpacing,
    },
    button: {
      color: button.color,
      backgroundColor: button.backgroundColor,
      borderRadius: button.borderRadius,
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
  const [capacityView, riskView] = await Promise.all([
    render('#capacity-report', capacityMarkdown, {
      navigation: true,
      sections: { collapsible: false },
      controls: { copy: true, fullscreen: true },
    }),
    render('#risk-report', riskMarkdown, {
      navigation: false,
      sections: { collapsible: true, defaultOpen: true },
      controls: { copy: false, fullscreen: true },
    }),
  ]);

  window.capacityView = capacityView;
  window.riskView = riskView;
  window.hostProbeAfter = measureHostProbes();

  window.updateCapacityDocument = async () => capacityView.update(capacityUpdateMarkdown);
  window.restoreCapacityDocument = async () => capacityView.update(capacityMarkdown);
  window.updateRiskDocument = async () => riskView.update(riskUpdateMarkdown);
  window.restoreRiskDocument = async () => riskView.update(riskMarkdown);
  window.destroyCapacityDocument = () => capacityView.destroy();
  window.destroyRiskDocument = () => riskView.destroy();

  document.body.dataset.ready = 'true';
} catch (error) {
  document.body.dataset.error = error instanceof Error ? error.message : String(error);
}
