import { openOverlay } from '../overlay.js';
import { downloadBlob, safeFilename } from '../download.js';
import { setKnownHTML } from '../runtime.js';

const CHART_JS = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/+esm';
const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const EXPAND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>';
const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>';
let chartPromise = null;

function loadChart() {
  if (!chartPromise) {
    chartPromise = import(CHART_JS).then((module) => {
      const Chart = module.Chart || module.default;
      Chart.register(...module.registerables);
      return Chart;
    }).catch((error) => {
      chartPromise = null;
      throw error;
    });
  }
  return chartPromise;
}

function button(label, icon) {
  const control = document.createElement('button');
  control.type = 'button';
  control.className = 'smalldocs-control';
  control.setAttribute('aria-label', label);
  control.title = label;
  setKnownHTML(control, icon);
  return control;
}

function chartData(source) {
  const data = JSON.parse(source);
  if (!data || typeof data !== 'object') throw new Error('Chart source must be a JSON object.');
  const type = String(data.type || 'bar').toLowerCase();
  const allowed = new Set(['bar', 'line', 'pie', 'doughnut', 'radar', 'polararea', 'scatter', 'bubble']);
  if (!allowed.has(type)) throw new Error('Unsupported chart type: ' + type);
  const labels = Array.isArray(data.labels) ? data.labels.map(String) : [];
  let datasets;
  if (Array.isArray(data.datasets)) {
    datasets = data.datasets.map((dataset, index) => ({
      label: String(dataset.label || 'Series ' + (index + 1)),
      data: Array.isArray(dataset.values) ? dataset.values : dataset.data,
      borderWidth: 2,
      borderColor: dataset.color,
      backgroundColor: dataset.color,
      tension: .25,
    }));
  } else {
    datasets = [{
      label: String(data.label || data.title || 'Values'),
      data: Array.isArray(data.values) ? data.values : [],
      borderWidth: 2,
      tension: .25,
    }];
  }
  return { source: data, type: type === 'polararea' ? 'polarArea' : type, labels, datasets };
}

function palette(root) {
  const styles = getComputedStyle(root && root.nodeType === 11 ? root.host : root);
  const accent = styles.getPropertyValue('--sdocs-accent').trim() || '#2563eb';
  return [accent, '#0f766e', '#d97706', '#7c3aed', '#dc2626', '#0891b2'];
}

function applyColors(config, colors) {
  config.datasets.forEach((dataset, index) => {
    const color = dataset.borderColor || colors[index % colors.length];
    dataset.borderColor = color;
    dataset.backgroundColor = config.type === 'line'
      ? color + '30'
      : colors.map((entry) => entry + 'cc');
  });
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Chart image creation failed')), 'image/png');
  });
}

function errorBlock(source, message) {
  const error = document.createElement('pre');
  error.className = 'smalldocs-feature-error sdoc-chart-error';
  error.textContent = message + '\n\n' + source;
  return error;
}

export async function mount(context) {
  const blocks = Array.from(context.root.querySelectorAll('code.language-chart')).slice(0, 50);
  if (!blocks.length) return;
  const Chart = await loadChart();
  if (context.signal.aborted) return;
  const charts = [];

  blocks.forEach((code, index) => {
    const pre = code.closest('pre');
    if (!pre || !pre.isConnected) return;
    const source = code.textContent || '';
    try {
      const config = chartData(source);
      applyColors(config, palette(context.root));
      const figure = document.createElement('figure');
      figure.className = 'sdoc-chart smalldocs-chart';
      const tools = document.createElement('div');
      tools.className = 'smalldocs-feature-tools';
      const canvas = document.createElement('canvas');
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', config.source.title || 'Chart');
      figure.append(tools, canvas);
      pre.replaceWith(figure);
      const computed = getComputedStyle(context.root && context.root.nodeType === 11 ? context.root.host : context.root);
      const chart = new Chart(canvas, {
        type: config.type,
        data: { labels: config.labels, datasets: config.datasets },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            title: { display: !!config.source.title, text: config.source.title, color: computed.color },
            legend: { display: config.source.legend !== false, labels: { color: computed.color } },
          },
          scales: ['pie', 'doughnut', 'radar', 'polarArea'].includes(config.type) ? {} : {
            x: { ticks: { color: computed.color }, grid: { color: 'rgba(120,113,108,.16)' } },
            y: { beginAtZero: true, ticks: { color: computed.color }, grid: { color: 'rgba(120,113,108,.16)' } },
          },
        },
      });
      charts.push(chart);

      if (context.options.controls.copy) {
        const copy = button('Copy chart image', COPY_ICON);
        copy.addEventListener('click', async () => {
          if (!navigator.clipboard || !window.ClipboardItem) return;
          const blob = await canvasBlob(canvas);
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        });
        tools.appendChild(copy);
      }
      if (context.options.controls.fullscreen) {
        const expand = button('Open chart in fullscreen', EXPAND_ICON);
        expand.addEventListener('click', () => {
          const overlay = openOverlay(context, { label: 'Chart', title: config.source.title || 'Chart' });
          const image = document.createElement('img');
          image.className = 'smalldocs-chart-focus';
          image.src = canvas.toDataURL('image/png');
          image.alt = config.source.title || 'Chart';
          overlay.stage.appendChild(image);
        });
        tools.appendChild(expand);
      }
      if (context.options.controls.download) {
        const download = button('Download chart PNG', DOWNLOAD_ICON);
        download.addEventListener('click', async () => downloadBlob(
          await canvasBlob(canvas),
          safeFilename(config.source.title, 'chart-' + (index + 1)) + '.png'
        ));
        tools.appendChild(download);
      }
    } catch (error) {
      pre.replaceWith(errorBlock(source, error.message));
    }
  });

  return () => charts.forEach((chart) => {
    try { chart.destroy(); } catch (_) {}
  });
}
