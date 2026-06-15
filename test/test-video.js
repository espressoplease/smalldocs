const path = require('path');

module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n── Video Block Tests ────────────────────────────\n');

  const video = require(path.join(__dirname, '..', 'public', 'sdocs-video.js'));

  // Minimal DOM stub so buildVideo runs in Node. Element properties (.src,
  // .controls, .muted…) are plain assignments; we just record them.
  function fakeDoc() {
    function el(tag) {
      return {
        tagName: String(tag).toUpperCase(),
        className: '',
        children: [],
        attrs: {},
        textContent: '',
        setAttribute(k, v) { this.attrs[k] = v; },
        appendChild(c) { this.children.push(c); return c; },
      };
    }
    return { createElement: el };
  }
  function build(cfg) { return video.buildVideo(cfg, fakeDoc()); }
  function childVideo(fig) { return fig.children.find(c => c.tagName === 'VIDEO'); }

  // ── safeUrl: scheme allowlist ──

  test('safeUrl: allows http/https/relative/root/protocol-relative', () => {
    assert.strictEqual(video.safeUrl('https://x.com/a.mp4'), 'https://x.com/a.mp4');
    assert.strictEqual(video.safeUrl('http://x.com/a.mp4'), 'http://x.com/a.mp4');
    assert.strictEqual(video.safeUrl('/demos/a.mp4'), '/demos/a.mp4');
    assert.strictEqual(video.safeUrl('demos/a.mp4'), 'demos/a.mp4');
    assert.strictEqual(video.safeUrl('//cdn.x.com/a.mp4'), '//cdn.x.com/a.mp4');
  });

  test('safeUrl: rejects javascript/data/vbscript and blanks', () => {
    assert.strictEqual(video.safeUrl('javascript:alert(1)'), null);
    assert.strictEqual(video.safeUrl('data:video/mp4;base64,AAAA'), null);
    assert.strictEqual(video.safeUrl('vbscript:msgbox(1)'), null);
    assert.strictEqual(video.safeUrl(''), null);
    assert.strictEqual(video.safeUrl(undefined), null);
  });

  // ── bool parsing ──

  test('bool: truthy/falsy words and bare flag', () => {
    assert.strictEqual(video.bool('true'), true);
    assert.strictEqual(video.bool(''), true);   // bare `autoplay:` with no value
    assert.strictEqual(video.bool('yes'), true);
    assert.strictEqual(video.bool('false'), false);
    assert.strictEqual(video.bool('0'), false);
    assert.strictEqual(video.bool(undefined, false), false);
    assert.strictEqual(video.bool('garbage', true), true); // falls back to default
  });

  // ── parseConfig ──

  test('parseConfig: key:value lines', () => {
    const c = video.parseConfig('src: /a.mp4\nposter: /p.jpg\ncaption: Hello world\nloop: true');
    assert.strictEqual(c.src, '/a.mp4');
    assert.strictEqual(c.poster, '/p.jpg');
    assert.strictEqual(c.caption, 'Hello world');
    assert.strictEqual(c.loop, 'true');
  });

  test('parseConfig: a bare URL line becomes the src', () => {
    const c = video.parseConfig('https://x.com/clip.mp4');
    assert.strictEqual(c.src, 'https://x.com/clip.mp4');
  });

  test('parseConfig: colon inside a value is preserved', () => {
    const c = video.parseConfig('caption: Chapter 3:30 onwards');
    assert.strictEqual(c.caption, 'Chapter 3:30 onwards');
  });

  // ── buildVideo: DOM shape + security ──

  test('buildVideo: valid src yields a controllable video', () => {
    const fig = build({ src: '/demos/a.mp4' });
    assert.strictEqual(fig.className, 'sdoc-video');
    const v = childVideo(fig);
    assert.ok(v, 'a video element is appended');
    assert.strictEqual(v.src, '/demos/a.mp4');
    assert.strictEqual(v.controls, true, 'controls default on');
    assert.strictEqual(v.attrs.playsinline, '');
  });

  test('buildVideo: javascript: src renders an error, no video element', () => {
    const fig = build({ src: 'javascript:alert(1)' });
    assert.ok(/sdoc-video-error/.test(fig.className));
    assert.strictEqual(childVideo(fig), undefined, 'no video element built');
    assert.ok(/valid src/.test(fig.textContent));
  });

  test('buildVideo: autoplay forces muted', () => {
    const v = childVideo(build({ src: '/a.mp4', autoplay: 'true' }));
    assert.strictEqual(v.autoplay, true);
    assert.strictEqual(v.muted, true, 'autoplay implies muted so browsers allow it');
  });

  test('buildVideo: controls can be turned off for a background loop', () => {
    const v = childVideo(build({ src: '/a.mp4', controls: 'false', loop: 'true' }));
    assert.strictEqual(v.controls, false);
    assert.strictEqual(v.loop, true);
  });

  test('buildVideo: poster passes the same URL guard', () => {
    const good = childVideo(build({ src: '/a.mp4', poster: '/p.jpg' }));
    assert.strictEqual(good.poster, '/p.jpg');
    const bad = childVideo(build({ src: '/a.mp4', poster: 'javascript:1' }));
    assert.strictEqual(bad.poster, undefined, 'unsafe poster dropped');
  });

  test('buildVideo: caption rendered via textContent', () => {
    const fig = build({ src: '/a.mp4', caption: '<script>x</script>' });
    const cap = fig.children.find(c => c.tagName === 'FIGCAPTION');
    assert.ok(cap);
    // textContent assignment means the markup is inert text, never parsed.
    assert.strictEqual(cap.textContent, '<script>x</script>');
  });
};
