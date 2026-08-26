import { loadScript, loadStyle, sdkAsset, vendorAsset } from '../assets.js';
import { setKnownHTML } from '../runtime.js';
import { mount as mountHighlight } from './highlight.js';

export async function mount(context) {
  const [readerFactory, focusFactory] = await Promise.all([
    loadScript(vendorAsset('sdocs-code-reader.js'), () => window.SDocCodeReader),
    loadScript(vendorAsset('sdocs-code-focus.js'), () => window.SDocCodeFocus),
    loadStyle(sdkAsset('code-reader.css'), 'smalldocs-sdk-code-reader-styles'),
  ]);
  if (context.signal.aborted) return;

  const adapter = {
    currentBody: context.body,
    currentMeta: context.meta,
    localMeta: null,
    renderedEl: context.root,
    embedMode: false,
    wholeFileCodeLang(body) {
      const text = String(body || '').replace(/^\uFEFF/, '').trim();
      if (!text.startsWith('```')) return null;
      const firstNewline = text.indexOf('\n');
      if (firstNewline < 0) return null;
      const language = text.slice(3, firstNewline).trim().toLowerCase();
      if (readerFactory.RESERVED[language]) return null;
      const rest = text.slice(firstNewline + 1);
      const close = rest.lastIndexOf('\n```');
      if (close < 0 || rest.slice(close + 4).trim()) return null;
      if (/(^|\n)```/.test(rest.slice(0, close))) return null;
      return language || 'code';
    },
    processHighlight(root) {
      // The canonical fullscreen viewer highlights in a detached holder before
      // it rebuilds the numbered rows. The normal document pass still requires
      // connected nodes so superseded renders cannot mutate discarded content.
      return mountHighlight({ ...context, root, allowDetached: true });
    },
  };

  const focus = focusFactory.create(adapter, {
    root: context.root,
    comments: false,
    controls: context.options.controls,
    setHTML: setKnownHTML,
    structuralAssetBase: sdkAsset('vendor/sdocs-code-lang/'),
  });
  const controls = readerFactory.create({
    root: context.root,
    focus,
    comments: false,
    annotations: false,
    controls: context.options.controls,
    setHTML: setKnownHTML,
  });
  controls.attach(context.root);

  return () => {
    controls.destroy();
    focus.destroy();
  };
}
