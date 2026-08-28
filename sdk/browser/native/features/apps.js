import { loadScript, loadStyle, vendorAsset } from '../assets.js';
import { openOverlayLease } from '../overlay.js';
import { setKnownHTML } from '../runtime.js';

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
    sdkVersion: '0.2.0',
    isActive() {
      return !context.signal.aborted;
    },
    mountSurface(surface, options) {
      return openOverlayLease(context, {
        surface,
        mount: context.shell,
        initialFocus: options.initialFocus,
        beforeClose: options.beforeClose,
      });
    },
  });
  const result = renderer.process(context.root);
  await result.ready;
  if (context.signal.aborted) {
    renderer.destroy('update');
    return;
  }
  return (reason) => renderer.destroy(reason);
}
