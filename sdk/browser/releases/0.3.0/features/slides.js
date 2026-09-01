import { loadScript, loadStyle, sdkAsset, vendorAsset } from '../assets.js';
import { downloadBlob, safeFilename } from '../download.js';
import { parseMarkdown, sanitizeHTML, setKnownHTML } from '../runtime.js';

const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>';

function button(label, icon, text) {
  const control = document.createElement('button');
  control.type = 'button';
  control.className = 'smalldocs-control';
  control.setAttribute('aria-label', label);
  control.title = label;
  setKnownHTML(control, icon + (text ? '<span>' + text + '</span>' : ''));
  return control;
}

function nestedContext(context, root, signal, featureOptions) {
  return Object.assign({}, context, {
    root,
    signal: signal || context.signal,
    allowDetached: true,
    chartOptions: featureOptions,
    cleanups: [],
    options: {
      navigation: false,
      sections: { collapsible: false, defaultOpen: true },
      controls: { copy: false, fullscreen: false, download: false },
    },
  });
}

async function mountNested(feature, root, context, signal, featureOptions) {
  const activeSignal = signal || context.signal;
  if (activeSignal.aborted) return;
  const module = await import('./' + feature + '.js');
  if (activeSignal.aborted) return;
  const nested = nestedContext(context, root, activeSignal, featureOptions);
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
  const [shapes, stdlib, resolve, renderer, reader, presentation, mobileBundle] = await Promise.all([
    loadScript(vendorAsset('sdocs-shapes.js'), () => window.SDocShapes),
    loadScript(vendorAsset('sdocs-slide-stdlib.js'), () => window.SDocSlideStdlib),
    loadScript(vendorAsset('sdocs-slide-resolve.js'), () => window.SDocSlideResolve),
    loadScript(vendorAsset('sdocs-shape-render.js'), () => window.SDocShapeRender),
    loadScript(vendorAsset('sdocs-slide-reader.js'), () => window.SDocSlideReader),
    loadScript(vendorAsset('sdocs-present.js'), () => window.SDocPresent),
    loadScript(vendorAsset('sdocs-zoom-math.js'), () => window.SDocZoomMath).then((zoomMath) =>
      loadScript(vendorAsset('sdocs-present-mobile.js'), () => window.SDocPresentMobile)
        .then((mobile) => ({ zoomMath, mobile }))),
    loadStyle(sdkAsset('slide-reader.css'), 'smalldocs-sdk-slide-reader-styles'),
  ]);
  const runtime = {
    parseMarkdown,
    sanitizeHTML,
    setKnownHTML,
    shapes,
    styles: context.assets.styles,
    icons: null,
    processCharts(root, options, signal) { return mountNested('charts', root, context, signal, options); },
    processMath(root, options, signal) { return mountNested('math', root, context, signal); },
    processMermaid(root, options, signal) { return mountNested('mermaid', root, context, signal); },
  };
  return {
    shapes,
    resolve,
    stdlib,
    renderer,
    reader,
    presentation,
    mobile: mobileBundle.mobile,
    zoomMath: mobileBundle.zoomMath,
    runtime,
    signal: context.signal,
    id: context.id,
    renderNumber: 0,
    exportBusy: false,
  };
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
      () => window.__SmallDocsSdkIcons,
    );
    if (context.signal.aborted) return;
  }
  let slides = [];
  let mobilePresenter = null;
  const presenter = context.options.controls.fullscreen
    ? api.presentation.create({
      root: context.root,
      styleSource: context.root,
      renderer: api.renderer,
      clipboard: navigator.clipboard,
      copy: context.options.controls.copy,
      setHTML: setKnownHTML,
      mobile: () => mobilePresenter,
      history: false,
      getSlides: () => slides,
      exportPdf: context.options.controls.download
        ? () => exportPdf(context, slides, api)
        : null,
      exportPptx: context.options.controls.download
        ? () => exportPptx(context, slides, api)
        : null,
      renderOptions(dsl, slideIndex, kind) {
        return {
          copyButtons: context.options.controls.copy && kind === 'stage',
          runtime: api.runtime,
          signal: api.signal,
          resourcePrefix: api.id + '-presentation-' + kind + '-' + slideIndex + '-' + (++api.renderNumber),
        };
      },
    })
    : null;
  if (presenter) {
    mobilePresenter = api.mobile.create({
      zoomMath: api.zoomMath,
      setHTML: setKnownHTML,
      go: (index) => presenter.go(index),
      close: () => presenter.close(),
      refit: () => presenter.refit(),
    });
  }
  const controller = api.reader.create({
    shapes: api.shapes,
    renderer: api.renderer,
    resolver: api.resolve,
    templates: api.stdlib.templates,
    selector: 'code.language-slide, code.language-slides',
    clipboard: navigator.clipboard,
    setHTML: setKnownHTML,
    present: presenter
      ? (slideIndex, currentSlides) => {
        slides = currentSlides;
        presenter.open(slideIndex);
      }
      : null,
    renderOptions(dsl, slideIndex) {
      return {
        copyButtons: context.options.controls.copy,
        runtime: api.runtime,
        signal: api.signal,
        resourcePrefix: api.id + '-slide-' + slideIndex + '-' + (++api.renderNumber),
      };
    },
  });
  const rendered = controller.process(context.root);
  slides = rendered.slides;
  try {
    await rendered.ready;
  } catch (error) {
    context.root.dataset.sdocsSlideError = error instanceof Error ? error.message : String(error);
    throw error;
  }
  if (context.signal.aborted) return;
  const cleanup = () => {
    if (presenter) presenter.close();
    controller.destroy();
  };
  if (!slides.length || !context.options.controls.download) return cleanup;
  const downloads = document.createElement('div');
  downloads.className = 'smalldocs-slide-downloads';
  const pdf = button('Download slides as PDF', DOWNLOAD_ICON, 'PDF');
  const pptx = button('Download slides as PowerPoint', DOWNLOAD_ICON, 'PowerPoint');
  pdf.addEventListener('click', () => exportPdf(context, slides, api).catch((error) => { pdf.dataset.error = error.message; }));
  pptx.addEventListener('click', () => exportPptx(context, slides, api).catch((error) => { pptx.dataset.error = error.message; }));
  downloads.append(pdf, pptx);
  const firstSlide = context.root.querySelector('.sdoc-slide');
  if (firstSlide) firstSlide.before(downloads);
  return cleanup;
}
