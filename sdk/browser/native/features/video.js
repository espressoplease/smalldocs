import { loadScript, loadStyle, vendorAsset } from '../assets.js';

export async function mount(context) {
  const blocks = Array.from(context.root.querySelectorAll('code.language-video')).slice(0, 50);
  if (!blocks.length) return;
  const [video] = await Promise.all([
    loadScript(vendorAsset('sdocs-video.js'), () => window.SDocVideo),
    loadStyle(vendorAsset('sdocs-video-reader.css'), 'smalldocs-sdk-video-reader-styles'),
  ]);
  if (context.signal.aborted) return;
  const renderer = video.createRenderer({
    document,
    Blob,
    isActive() {
      return !context.signal.aborted;
    },
  });
  renderer.processVideo(context.root);
}
