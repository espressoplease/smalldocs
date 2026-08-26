import { loadScript, loadStyle, vendorAsset } from '../assets.js';
import { setKnownHTML } from '../runtime.js';

async function ensureCells() {
  const [cells, formula, controller, selection, ui] = await Promise.all([
    loadScript(vendorAsset('sdocs-cells.js'), () => window.SDocCells),
    loadScript(vendorAsset('sdocs-cells-formula.js'), () => window.SDocCellsFormula),
    loadScript(vendorAsset('sdocs-cells-controller.js'), () => window.SDocCellsController),
    loadScript(vendorAsset('sdocs-cells-select.js'), () => window.SDocCellsSelection),
    loadScript(vendorAsset('sdocs-cells-ui.js'), () => window.SDocCellsUI),
    loadStyle(vendorAsset('sdocs-cells.css'), 'smalldocs-sdk-cells-styles'),
  ]);
  return { cells, formula, controller, selection, ui };
}

function sourceForCode(cells, pre, source) {
  const fence = String((pre && pre.dataset.sdocsFence) || '');
  const info = fence.replace(/^cells(?:\s+|$)/i, '');
  const parsed = cells.parseFenceInfo(info);
  const name = String(parsed.name || '').replace(/"/g, '');
  const workbook = String(parsed.workbook || '').replace(/"/g, '');
  if (!name && !workbook) return source;
  let directive = 'sdoc-cells: name="' + name + '"';
  if (workbook) directive += ' workbook="' + workbook + '"';
  return directive + '\n' + source;
}

export async function mount(context) {
  if (!context.root.querySelector('code.language-cells')) return;
  const api = await ensureCells();
  if (context.signal.aborted) return;

  const state = { currentMeta: context.meta };
  const selection = api.selection.create({ window, document });
  const renderer = api.ui.create({
    window,
    document,
    state,
    cells: api.cells,
    formula: api.formula,
    controller: api.controller,
    selection,
    installMarkedExtension: false,
    controls: context.options.controls,
    resizeClassTarget: context.shell,
    isActive() { return !context.signal.aborted; },
    setKnownHTML,
    // Fullscreen depends on the production focus and edit adapters. Until
    // those are instance-capable, omit the canonical button rather than
    // replacing it with a second spreadsheet experience.
    capabilities: { fullscreen: false },
    sourceForCode(code, pre, source) {
      return sourceForCode(api.cells, pre, source);
    },
    loadFeature(name) {
      if (name !== 'xlsx') return Promise.reject(new Error('Spreadsheet feature is unavailable: ' + name));
      return loadScript(vendorAsset('sdocs-cells-xlsx.js'), () => window.SDocCellsXlsx);
    },
  });
  try {
    renderer.processCells(context.root);
  } catch (error) {
    renderer.destroy();
    selection.destroy();
    throw error;
  }
  if (context.signal.aborted) {
    renderer.destroy();
    selection.destroy();
    return;
  }
  return () => {
    renderer.destroy();
    selection.destroy();
  };
}
