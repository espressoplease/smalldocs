import { loadScript, vendorAsset } from '../assets.js';
import { openOverlay } from '../overlay.js';
import { downloadBlob, safeFilename } from '../download.js';
import { parseMarkdown, sanitizeHTML, setKnownHTML } from '../runtime.js';

const EXPAND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>';
const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>';
const PREVIOUS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
const NEXT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

function button(label, icon, text) {
  const control = document.createElement('button');
  control.type = 'button';
  control.className = 'smalldocs-control';
  control.setAttribute('aria-label', label);
  control.title = label;
  setKnownHTML(control, icon + (text ? '<span>' + text + '</span>' : ''));
  return control;
}

function nestedContext(context, root, signal) {
  return Object.assign({}, context, {
    root,
    signal: signal || context.signal,
    cleanups: [],
    options: {
      navigation: false,
      sections: { collapsible: false, defaultOpen: true },
      controls: { copy: false, fullscreen: false, download: false },
    },
  });
}

async function mountNested(feature, root, context, signal) {
  const activeSignal = signal || context.signal;
  if (activeSignal.aborted) return;
  const module = await import('./' + feature + '.js');
  if (activeSignal.aborted) return;
  const nested = nestedContext(context, root, activeSignal);
  const cleanup = await module.mount(nested);
  const cleanups = nested.cleanups.slice();
  if (typeof cleanup === 'function') cleanups.push(cleanup);
  const combined = () => {
    for (let index = cleanups.length - 1; index >= 0; index -= 1) {
      try { cleanups[index](); } catch (_) {}
    }
  };
  if (activeSignal.aborted) {
    combined();
    return;
  }
  return combined;
}

async function ensureSlides(context) {
  const [shapes, stdlib, resolve, renderer] = await Promise.all([
    loadScript(vendorAsset('sdocs-shapes.js'), () => window.SDocShapes),
    loadScript(vendorAsset('sdocs-slide-stdlib.js'), () => window.SDocSlideStdlib),
    loadScript(vendorAsset('sdocs-slide-resolve.js'), () => window.SDocSlideResolve),
    loadScript(vendorAsset('sdocs-shape-render.js'), () => window.SDocShapeRender),
  ]);
  const runtime = {
    parseMarkdown,
    sanitizeHTML,
    setKnownHTML,
    shapes,
    styles: context.assets.styles,
    icons: null,
    processCharts(root, options, signal) { return mountNested('charts', root, context, signal); },
    processMath(root, options, signal) { return mountNested('math', root, context, signal); },
    processMermaid(root, options, signal) { return mountNested('mermaid', root, context, signal); },
  };
  return {
    shapes,
    resolve,
    stdlib,
    renderer,
    runtime,
    signal: context.signal,
    id: context.id,
    renderNumber: 0,
    exportBusy: false,
  };
}

function slideText(dsl, shapes) {
  try {
    return shapes.parse(dsl).shapes.map((shape) => shape.content || '').filter(Boolean).join('\n');
  } catch (_) {
    return dsl;
  }
}

function renderSlide(dsl, api, className) {
  const wrapper = document.createElement('div');
  wrapper.className = className || 'sdoc-slide';
  wrapper.dataset.dsl = dsl;
  const stage = document.createElement('div');
  wrapper.appendChild(stage);
  const result = api.renderer.renderShapes(dsl, stage, {
    copyButtons: true,
    runtime: api.runtime,
    signal: api.signal,
    resourcePrefix: api.id + '-slide-' + (++api.renderNumber),
  });
  wrapper._sdocsShapeResult = result;
  wrapper._sdocsPending = result.ready || result.pending || Promise.resolve();
  if (result.errors && result.errors.length) {
    const error = document.createElement('pre');
    error.className = 'smalldocs-slide-errors';
    error.textContent = result.errors.map((entry) => entry.message || String(entry)).join('\n');
    wrapper.appendChild(error);
  }
  return wrapper;
}

function copyText(text, control) {
  navigator.clipboard.writeText(text).then(() => {
    control.dataset.copied = 'true';
    setTimeout(() => delete control.dataset.copied, 1200);
  }).catch(() => { control.dataset.copyFailed = 'true'; });
}

function present(context, slides, start, api) {
  let active = start;
  let activeNode = null;
  const overlay = openOverlay(context, {
    label: 'Slide presentation',
    title: context.meta.title || 'Slides',
    actions(actions) {
      const previous = button('Previous slide', PREVIOUS_ICON);
      const counter = document.createElement('output');
      counter.className = 'smalldocs-slide-counter';
      const next = button('Next slide', NEXT_ICON);
      const copy = button('Copy slide text', COPY_ICON);
      previous.addEventListener('click', () => show(active - 1));
      next.addEventListener('click', () => show(active + 1));
      copy.addEventListener('click', () => copyText(slideText(slides[active].dsl, api.shapes), copy));
      actions.append(previous, counter, next, copy);
      function show(index) {
        active = (index + slides.length) % slides.length;
        if (activeNode && activeNode._sdocsShapeResult && activeNode._sdocsShapeResult.destroy) {
          activeNode._sdocsShapeResult.destroy();
        }
        if (activeNode) activeNode.remove();
        activeNode = renderSlide(slides[active].dsl, api, 'sdoc-slide smalldocs-slide-focus');
        overlay.stage.appendChild(activeNode);
        counter.value = (active + 1) + ' / ' + slides.length;
      }
      requestAnimationFrame(() => {
        if (!overlay.overlay.isConnected) return;
        show(active);
      });
    },
    onClose() {
      if (activeNode && activeNode._sdocsShapeResult && activeNode._sdocsShapeResult.destroy) {
        activeNode._sdocsShapeResult.destroy();
      }
      activeNode = null;
    },
  });
}

async function exportPdf(context, slides, api) {
  if (api.exportBusy) return;
  api.exportBusy = true;
  try {
    const pdfLib = await loadScript('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js', () => window.PDFLib);
    const exporter = await loadScript(vendorAsset('sdocs-slide-pdf.js'), () => window.SDocSlidePdf);
    const doc = await pdfLib.PDFDocument.create();
    const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
    const bold = await doc.embedFont(pdfLib.StandardFonts.HelveticaBold);
    const mono = await doc.embedFont(pdfLib.StandardFonts.Courier);
    const fonts = { body: font, bodyBold: bold, heading: bold, headingBold: bold, mono };
    for (const entry of slides) {
      api.renderer.setRuntime(api.runtime);
      const parsed = api.shapes.parse(entry.dsl);
      const pageWidth = 1280;
      const pageHeight = pageWidth * parsed.grid.h / parsed.grid.w;
      const page = doc.addPage([pageWidth, pageHeight]);
      await exporter.drawSlide({
        dsl: entry.dsl,
        page,
        pdfDoc: doc,
        pdfLib,
        shapes: api.shapes,
        renderer: api.renderer,
        root: context.root,
        fonts,
        bounds: { x: 0, y: 0, w: pageWidth, h: pageHeight },
      });
    }
    downloadBlob(new Blob([await doc.save()], { type: 'application/pdf' }),
      safeFilename(context.meta.title, 'slides') + '.pdf');
  } finally {
    api.exportBusy = false;
  }
}

async function exportPptx(context, slides, api) {
  if (api.exportBusy) return;
  api.exportBusy = true;
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', () => window.JSZip);
    const PptxGenJS = await loadScript('https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.min.js', () => window.PptxGenJS);
    const exporter = await loadScript(vendorAsset('sdocs-slide-pptx.js'), () => window.SDocSlidePptx);
    const presentation = new PptxGenJS();
    const firstGrid = api.shapes.parse(slides[0].dsl).grid;
    const slideWidth = 13.333;
    const slideHeight = Math.min(10, slideWidth * firstGrid.h / firstGrid.w);
    presentation.defineLayout({ name: 'SMALLDOCS_SDK', width: slideWidth, height: slideHeight });
    presentation.layout = 'SMALLDOCS_SDK';
    for (const entry of slides) {
      api.renderer.setRuntime(api.runtime);
      const slide = presentation.addSlide();
      await exporter.drawSlide({
        dsl: entry.dsl,
        slide,
        pres: presentation,
        pptxGenJS: PptxGenJS,
        shapes: api.shapes,
        renderer: api.renderer,
        root: context.root,
        slideW: slideWidth,
        slideH: slideHeight,
      });
    }
    downloadBlob(await presentation.write({ outputType: 'blob' }),
      safeFilename(context.meta.title, 'slides') + '.pptx');
  } finally {
    api.exportBusy = false;
  }
}

export async function mount(context) {
  const blocks = Array.from(context.root.querySelectorAll('code.language-slide, code.language-slides')).slice(0, 100);
  if (!blocks.length) return;
  const api = await ensureSlides(context);
  if (context.signal.aborted) return;
  const raw = blocks.map((code) => code.textContent || '');
  const resolved = api.resolve.resolveSlides(raw, api.shapes, { stdlib: api.stdlib.templates });
  const needsIcons = resolved.some(entry => !entry.skip && /(^|\n)\s*icon\b/.test(entry.dsl || ''));
  if (needsIcons) {
    api.runtime.icons = await loadScript(
      vendorAsset('sdocs-icons-data.js'),
      () => window.__SmallDocsSdk020Icons,
    );
    if (context.signal.aborted) return;
  }
  const slides = [];
  const pending = [];
  const renderedResults = [];
  blocks.forEach((code, index) => {
    const pre = code.closest('pre');
    if (!pre) return;
    const entry = resolved[index];
    if (entry.skip) {
      pre.remove();
      return;
    }
    try {
      const slide = { dsl: entry.dsl, source: raw[index] };
      const wrapper = renderSlide(slide.dsl, api, 'sdoc-slide smalldocs-slide');
      renderedResults.push(wrapper._sdocsShapeResult);
      pending.push(wrapper._sdocsPending);
      const tools = document.createElement('div');
      tools.className = 'smalldocs-feature-tools';
      if (context.options.controls.fullscreen) {
        const expand = button('Present slides', EXPAND_ICON);
        expand.addEventListener('click', () => present(context, slides, slides.indexOf(slide), api));
        tools.appendChild(expand);
      }
      wrapper.appendChild(tools);
      if (entry.errors && entry.errors.length) {
        const error = document.createElement('pre');
        error.className = 'smalldocs-slide-errors';
        error.textContent = entry.errors.map((item) => item.message || String(item)).join('\n');
        wrapper.appendChild(error);
      }
      pre.replaceWith(wrapper);
      slides.push(slide);
    } catch (error) {
      const fallback = document.createElement('pre');
      fallback.className = 'smalldocs-feature-error sdoc-slide-error';
      fallback.textContent = error.message + '\n\n' + raw[index];
      pre.replaceWith(fallback);
    }
  });
  await Promise.all(pending);
  if (context.signal.aborted) return;
  const cleanup = () => {
    renderedResults.forEach((result) => {
      if (result && result.destroy) result.destroy();
    });
  };
  if (!slides.length || !context.options.controls.download) return cleanup;
  const downloads = document.createElement('div');
  downloads.className = 'smalldocs-slide-downloads';
  const pdf = button('Download slides as PDF', DOWNLOAD_ICON, 'PDF');
  const pptx = button('Download slides as PowerPoint', DOWNLOAD_ICON, 'PowerPoint');
  pdf.addEventListener('click', () => exportPdf(context, slides, api).catch((error) => { pdf.dataset.error = error.message; }));
  pptx.addEventListener('click', () => exportPptx(context, slides, api).catch((error) => { pptx.dataset.error = error.message; }));
  downloads.append(pdf, pptx);
  slides[0].dsl && context.root.querySelector('.smalldocs-slide').before(downloads);
  return cleanup;
}
