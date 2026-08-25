import { loadScript, vendorAsset } from '../assets.js';

function errorBlock(message) {
  const error = document.createElement('pre');
  error.className = 'smalldocs-feature-error sdoc-video-error';
  error.textContent = message;
  return error;
}

export async function mount(context) {
  const blocks = Array.from(context.root.querySelectorAll('code.language-video')).slice(0, 50);
  if (!blocks.length) return;
  const video = await loadScript(vendorAsset('sdocs-video.js'), () => window.SDocVideo);
  if (context.signal.aborted) return;
  blocks.forEach((code) => {
    const pre = code.closest('pre');
    if (!pre || !pre.isConnected) return;
    const source = code.textContent || '';
    if (new Blob([source]).size > 8192) {
      pre.replaceWith(errorBlock('Video block too large.'));
      return;
    }
    const parsed = video.parseVideoSource(source);
    if (parsed.error) {
      pre.replaceWith(errorBlock(parsed.error));
      return;
    }
    const wrapper = document.createElement('figure');
    wrapper.className = 'smalldocs-video sdoc-video';
    const frame = document.createElement('div');
    frame.className = 'smalldocs-video-frame sdoc-video-frame';
    const iframe = document.createElement('iframe');
    iframe.src = video.buildEmbedUrl(parsed);
    iframe.title = parsed.title || 'YouTube video player';
    iframe.loading = 'lazy';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen';
    iframe.setAttribute('allowfullscreen', '');
    frame.appendChild(iframe);
    wrapper.appendChild(frame);
    if (parsed.title) {
      const caption = document.createElement('figcaption');
      caption.className = 'smalldocs-video-caption sdoc-video-caption';
      const link = document.createElement('a');
      link.href = video.watchUrl(parsed);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = parsed.title;
      caption.appendChild(link);
      wrapper.appendChild(caption);
    }
    pre.replaceWith(wrapper);
  });
}
