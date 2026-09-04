import { loadScript, loadStyle, vendorAsset } from '../assets.js';
import { downloadBlob } from '../download.js';
import { openOverlayLease } from '../overlay.js';
import { SDK_VERSION } from '../version.js';
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
  let focus = null;
  let editor = null;
  let focusPromise = null;
  function ensureFocus() {
    if (focus) return Promise.resolve(focus);
    if (focusPromise) return focusPromise;
    focusPromise = Promise.all([
      loadScript(vendorAsset('sdocs-cells-edit.js'), () => window.SDocCellsEdit),
      loadScript(vendorAsset('sdocs-cells-focus.js'), () => window.SDocCellsFocus),
    ]).then(([editorApi, focusApi]) => {
      if (context.signal.aborted) return null;
      editor = editorApi.create({
        window,
        document,
        cells: api.cells,
        formula: api.formula,
        sdkVersion: SDK_VERSION,
        isActive() { return !context.signal.aborted; },
      });
      focus = focusApi.create({
        window,
        document,
        cells: api.cells,
        formula: api.formula,
        controller: renderer.controller,
        editor,
        buildGrid: renderer.buildGrid,
        buildCopyControls: renderer.buildCopyControls,
        formatStats: renderer.formatStats,
        setKnownHTML,
        sdkVersion: SDK_VERSION,
        controls: context.options.controls,
        owner: context,
        themeSource: context.root,
        openOverlayLease,
        downloadBlob,
        isActive() { return !context.signal.aborted; },
        onEdited(model, wrapper) {
          if (wrapper && wrapper._cellsMarkEdited) wrapper._cellsMarkEdited();
        },
        loadFeature(name) {
          if (name !== 'xlsx') return Promise.reject(new Error('Spreadsheet feature is unavailable: ' + name));
          return loadScript(vendorAsset('sdocs-cells-xlsx.js'), () => window.SDocCellsXlsx);
        },
        onError(error) {
          if (window.console && window.console.error) window.console.error(error);
        },
      });
      return focus;
    }).catch((error) => {
      focusPromise = null;
      throw error;
    });
    return focusPromise;
  }
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
    capabilities: { fullscreen: context.options.controls.fullscreen },
    sourceForCode(code, pre, source) {
      return sourceForCode(api.cells, pre, source);
    },
    loadFeature(name) {
      if (name === 'focus') return ensureFocus();
      if (name === 'xlsx') {
        return loadScript(vendorAsset('sdocs-cells-xlsx.js'), () => window.SDocCellsXlsx);
      }
      return Promise.reject(new Error('Spreadsheet feature is unavailable: ' + name));
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
    if (focus) focus.destroy('update');
    renderer.destroy();
    selection.destroy();
    return;
  }
  return (reason) => {
    if (focus) focus.destroy(reason);
    renderer.destroy();
    selection.destroy();
  };
}
