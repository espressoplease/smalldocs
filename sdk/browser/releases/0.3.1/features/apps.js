import { loadScript, loadStyle, vendorAsset } from '../assets.js';
import { openOverlayLease } from '../overlay.js';
import { setKnownHTML } from '../runtime.js';
import { SDK_VERSION } from '../version.js';

export async function mount(context) {
  if (!context.root.querySelector('code.language-sdoc-app')) return;
  const [apps] = await Promise.all([
    loadScript(vendorAsset('sdocs-html-components.js'), () => window.SDocHtmlComponents),
    loadStyle(vendorAsset('sdocs-html-component-reader.css'), 'smalldocs-sdk-html-component-styles'),
  ]);
  if (context.signal.aborted) return;

  const renderer = apps.create({
    window,
    document,
    runnerUrl: vendorAsset('sdocs-app-runner.html'),
    controls: context.options.controls,
    setHTML: setKnownHTML,
    sdkVersion: SDK_VERSION,
    isActive() {
      return !context.signal.aborted;
    },
    mountSurface(surface, options) {
      return openOverlayLease(context, {
        surface,
        initialFocus: options.initialFocus,
        beforeClose: options.beforeClose,
      });
    },
  });
  const abort = () => renderer.destroy('update');
  context.signal.addEventListener('abort', abort, { once: true });
  try {
    const result = renderer.process(context.root);
    await result.ready;
    if (context.signal.aborted) {
      renderer.destroy('update');
      return;
    }
  } finally {
    context.signal.removeEventListener('abort', abort);
  }
  return (reason) => renderer.destroy(reason);
}
