import { loadScript, loadStyle, vendorAsset } from '../assets.js';
import { downloadBlob } from '../download.js';
import { setKnownHTML } from '../runtime.js';

const CHART_JS = 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js';
const DATA_LABELS = 'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js';
const ANNOTATION = 'https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.1.0/dist/chartjs-plugin-annotation.min.js';

let canonicalPromise = null;
let chartPromise = null;

function restoreGlobal(name, previous) {
  if (previous === undefined) delete window[name];
  else window[name] = previous;
}

async function ensureCanonical() {
  if (canonicalPromise) return canonicalPromise;
  canonicalPromise = (async () => {
    const previous = window.SDocCharts;
    await import('../vendor/sdocs-charts.js');
    const charts = window.SDocCharts;
    restoreGlobal('SDocCharts', previous);
    if (!charts || typeof charts.create !== 'function') {
      throw new Error('SmallDocs chart asset loaded without its canonical API.');
    }
    return charts;
  })().catch((error) => {
    canonicalPromise = null;
    throw error;
  });
  return canonicalPromise;
}

function loadChart() {
  if (!chartPromise) {
    chartPromise = (async () => {
      const previousChart = window.Chart;
      const previousLabels = window.ChartDataLabels;
      const previousAnnotation = window.ChartAnnotation;
      try {
        const Chart = await loadScript(CHART_JS, () => window.Chart);
        const ChartDataLabels = await loadScript(DATA_LABELS, () => window.ChartDataLabels);
        const ChartAnnotation = await loadScript(ANNOTATION, () => window.ChartAnnotation);
        return { Chart, ChartDataLabels, ChartAnnotation };
      } finally {
        restoreGlobal('Chart', previousChart);
        restoreGlobal('ChartDataLabels', previousLabels);
        restoreGlobal('ChartAnnotation', previousAnnotation);
      }
    })().catch((error) => {
      chartPromise = null;
      throw error;
    });
  }
  return chartPromise;
}

export async function mount(context) {
  if (!context.root.querySelector('code.language-chart')) return;
  const canonical = await ensureCanonical();
  if (context.signal.aborted) return;
  await loadStyle(vendorAsset('sdocs-chart-reader.css'), 'smalldocs-sdk-chart-reader-styles');
  if (context.signal.aborted) return;

  const renderer = canonical.create({
    window,
    document,
    styles: context.assets.styles,
    root: () => context.root,
    styleRoot: () => context.root.nodeType === 11 ? context.root.host : context.root,
    controls: context.options.controls,
    blockCap: 50,
    allowDetached: context.allowDetached === true,
    loadChart,
    downloadPng(dataUrl, filename) {
      const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      downloadBlob(new Blob([bytes], { type: 'image/png' }), filename);
    },
    setHTML: setKnownHTML,
    isActive: () => !context.signal.aborted,
  });

  try {
    await renderer.processCharts(context.root, context.chartOptions);
  } catch (error) {
    renderer.destroy();
    throw error;
  }

  return () => renderer.destroy();
}
