import { loadScript, vendorAsset } from '../assets.js';
import { openOverlay } from '../overlay.js';
import { downloadBlob, safeFilename } from '../download.js';
import { setKnownHTML } from '../runtime.js';

const EXPAND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>';
const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>';

function button(label, icon) {
  const control = document.createElement('button');
  control.type = 'button';
  control.className = 'smalldocs-control';
  control.setAttribute('aria-label', label);
  control.title = label;
  setKnownHTML(control, icon);
  return control;
}

async function ensureCells() {
  const cells = await loadScript(vendorAsset('sdocs-cells.js'), () => window.SDocCells);
  const formula = await loadScript(vendorAsset('sdocs-cells-formula.js'), () => window.SDocCellsFormula);
  return { cells, formula };
}

function fenceDetails(pre, model, index, cells) {
  const info = String(pre.dataset.sdocsFence || '').replace(/^cells\s*/i, '');
  const parsed = cells.parseFenceInfo(info);
  return {
    workbook: parsed.workbook || '__block-' + index,
    name: parsed.name || model.name || 'Sheet ' + (index + 1),
  };
}

function resultCell(model, results, row, column) {
  const cell = model.cells[row][column];
  const computed = results && results[row] && results[row][column];
  if (computed && computed.kind === 'error') return computed.code || '#ERROR!';
  if (computed && Object.prototype.hasOwnProperty.call(computed, 'value')) return computed.value;
  return cell.value;
}

function renderGrid(sheet, cells) {
  const shell = document.createElement('div');
  shell.className = 'smalldocs-cells-grid-shell';
  const nameBox = document.createElement('output');
  nameBox.className = 'smalldocs-cells-address';
  nameBox.textContent = 'A1';
  const formulaBox = document.createElement('output');
  formulaBox.className = 'smalldocs-cells-formula';
  const status = document.createElement('output');
  status.className = 'smalldocs-cells-status';
  status.textContent = sheet.name;
  const bar = document.createElement('div');
  bar.className = 'smalldocs-cells-bar';
  bar.append(nameBox, formulaBox);
  const scroll = document.createElement('div');
  scroll.className = 'smalldocs-cells-scroll';
  const table = document.createElement('table');
  table.className = 'smalldocs-cells-table';
  table.setAttribute('aria-label', sheet.name);
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.appendChild(document.createElement('th'));
  for (let column = 0; column < sheet.model.cols; column += 1) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = cells.colName(column);
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  const tbody = document.createElement('tbody');
  for (let row = 0; row < sheet.model.rows; row += 1) {
    const tr = document.createElement('tr');
    const rowHead = document.createElement('th');
    rowHead.scope = 'row';
    rowHead.textContent = String(row + 1);
    tr.appendChild(rowHead);
    for (let column = 0; column < sheet.model.cols; column += 1) {
      const cell = sheet.model.cells[row][column];
      const td = document.createElement('td');
      td.tabIndex = 0;
      td.dataset.address = cells.colName(column) + (row + 1);
      td.dataset.raw = cell.raw;
      td.textContent = String(resultCell(sheet.model, sheet.results, row, column) ?? '');
      if (cell.type === 'number' || cell.raw.charAt(0) === '=') td.classList.add('is-number');
      td.addEventListener('focus', () => {
        table.querySelectorAll('td.is-selected').forEach((entry) => entry.classList.remove('is-selected'));
        td.classList.add('is-selected');
        nameBox.textContent = td.dataset.address;
        formulaBox.textContent = td.dataset.raw;
        status.textContent = td.dataset.address + '  ' + td.textContent;
      });
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  scroll.appendChild(table);
  shell.append(bar, scroll, status);
  return shell;
}

function renderWorkbook(group, cells) {
  const surface = document.createElement('div');
  surface.className = 'sdoc-cells smalldocs-cells';
  const tabs = document.createElement('div');
  tabs.className = 'smalldocs-cells-tabs';
  tabs.setAttribute('role', 'tablist');
  const panels = document.createElement('div');
  panels.className = 'smalldocs-cells-panels';
  group.sheets.forEach((sheet, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'smalldocs-cells-tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(index === 0));
    tab.textContent = sheet.name;
    const panel = document.createElement('div');
    panel.className = 'smalldocs-cells-panel';
    panel.setAttribute('role', 'tabpanel');
    panel.hidden = index !== 0;
    panel.appendChild(renderGrid(sheet, cells));
    tab.addEventListener('click', () => {
      tabs.querySelectorAll('[role="tab"]').forEach((entry) => entry.setAttribute('aria-selected', String(entry === tab)));
      Array.from(panels.children).forEach((entry) => { entry.hidden = entry !== panel; });
    });
    tabs.appendChild(tab);
    panels.appendChild(panel);
  });
  surface.append(tabs, panels);
  return surface;
}

async function downloadWorkbook(group, filename) {
  const writer = await loadScript(vendorAsset('sdocs-cells-xlsx.js'), () => window.SDocCellsXlsx);
  const bytes = writer.buildXlsxWorkbook(group.sheets.map((sheet) => ({
    name: sheet.name,
    model: sheet.model,
  })), group.sheets.map((sheet) => sheet.results));
  downloadBlob(new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), filename);
}

export async function mount(context) {
  const blocks = Array.from(context.root.querySelectorAll('code.language-cells')).slice(0, 100);
  if (!blocks.length) return;
  const api = await ensureCells();
  if (context.signal.aborted) return;
  const groups = new Map();
  blocks.forEach((code, index) => {
    const pre = code.closest('pre');
    if (!pre) return;
    const model = api.cells.parseCells(code.textContent || '');
    const details = fenceDetails(pre, model, index, api.cells);
    const key = details.workbook;
    if (!groups.has(key)) groups.set(key, { id: key, sheets: [], blocks: [] });
    const group = groups.get(key);
    group.sheets.push({ name: details.name, model, results: null });
    group.blocks.push(pre);
  });

  groups.forEach((group) => {
    const results = api.formula.recalcWorkbook(group.sheets.map((sheet) => ({ name: sheet.name, model: sheet.model })));
    group.sheets.forEach((sheet, index) => { sheet.results = results[index]; });
    const card = document.createElement('section');
    card.className = 'smalldocs-cells-card';
    const tools = document.createElement('div');
    tools.className = 'smalldocs-feature-tools';
    const surface = renderWorkbook(group, api.cells);
    card.append(tools, surface);
    group.blocks[0].replaceWith(card);
    group.blocks.slice(1).forEach((pre) => pre.remove());

    if (context.options.controls.fullscreen) {
      const expand = button('Open spreadsheet in fullscreen', EXPAND_ICON);
      expand.addEventListener('click', () => {
        const overlay = openOverlay(context, { label: 'Spreadsheet', title: group.sheets.map((sheet) => sheet.name).join(' / ') });
        const clone = renderWorkbook(group, api.cells);
        clone.classList.add('smalldocs-cells-focus');
        overlay.stage.appendChild(clone);
      });
      tools.appendChild(expand);
    }
    if (context.options.controls.download) {
      const download = button('Download spreadsheet XLSX', DOWNLOAD_ICON);
      download.addEventListener('click', () => downloadWorkbook(
        group,
        safeFilename(context.meta.title || group.id, 'spreadsheet') + '.xlsx'
      ));
      tools.appendChild(download);
    }
  });
}
