module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n── Video Tests ─────────────────────────────────\n');

  // The pure core of sdocs-video.js is UMD: required directly here, the
  // browser-only DOM renderer (guarded on window.SDocs) is skipped. This is
  // the security boundary - id extraction + validation + embed-url build -
  // so it is the part worth pinning in Node.
  const V = require('../public/sdocs-video.js');

  const ID = 'dQw4w9WgXcQ'; // 11 chars

  // ── extractYouTubeId: accepted shapes ──
  test('extractYouTubeId: bare 11-char id', () => {
    assert.strictEqual(V.extractYouTubeId(ID), ID);
  });
  test('extractYouTubeId: watch URL', () => {
    assert.strictEqual(V.extractYouTubeId('https://www.youtube.com/watch?v=' + ID), ID);
  });
  test('extractYouTubeId: watch URL with extra params before v', () => {
    assert.strictEqual(V.extractYouTubeId('https://www.youtube.com/watch?feature=x&v=' + ID + '&t=10'), ID);
  });
  test('extractYouTubeId: youtu.be short URL', () => {
    assert.strictEqual(V.extractYouTubeId('https://youtu.be/' + ID + '?t=5'), ID);
  });
  test('extractYouTubeId: embed URL', () => {
    assert.strictEqual(V.extractYouTubeId('https://www.youtube.com/embed/' + ID), ID);
  });
  test('extractYouTubeId: shorts URL', () => {
    assert.strictEqual(V.extractYouTubeId('https://youtube.com/shorts/' + ID), ID);
  });
  test('extractYouTubeId: nocookie host', () => {
    assert.strictEqual(V.extractYouTubeId('https://www.youtube-nocookie.com/embed/' + ID), ID);
  });
  test('extractYouTubeId: m. mobile host', () => {
    assert.strictEqual(V.extractYouTubeId('https://m.youtube.com/watch?v=' + ID), ID);
  });

  // ── extractYouTubeId: rejected shapes (the trust boundary) ──
  test('extractYouTubeId: rejects non-youtube host', () => {
    assert.strictEqual(V.extractYouTubeId('https://evil.com/watch?v=' + ID), null);
  });
  test('extractYouTubeId: rejects host that merely contains youtube.com', () => {
    assert.strictEqual(V.extractYouTubeId('https://youtube.com.evil.com/embed/' + ID), null);
  });
  test('extractYouTubeId: rejects javascript: scheme', () => {
    assert.strictEqual(V.extractYouTubeId('javascript:alert(1)//' + ID), null);
  });
  test('extractYouTubeId: rejects id with wrong length', () => {
    assert.strictEqual(V.extractYouTubeId('short'), null);
    assert.strictEqual(V.extractYouTubeId('waytoolongforanid12345'), null);
  });
  test('extractYouTubeId: rejects id with illegal chars', () => {
    assert.strictEqual(V.extractYouTubeId('abc"<script>x'), null);
    assert.strictEqual(V.extractYouTubeId('abcd efgh ij'), null);
  });
  test('extractYouTubeId: empty / null', () => {
    assert.strictEqual(V.extractYouTubeId(''), null);
    assert.strictEqual(V.extractYouTubeId(null), null);
  });

  // ── parseStart ──
  test('parseStart: plain seconds', () => assert.strictEqual(V.parseStart('90'), 90));
  test('parseStart: 90s suffix', () => assert.strictEqual(V.parseStart('90s'), 90));
  test('parseStart: 1m30s', () => assert.strictEqual(V.parseStart('1m30s'), 90));
  test('parseStart: 1h2m3s', () => assert.strictEqual(V.parseStart('1h2m3s'), 3723));
  test('parseStart: m:ss clock', () => assert.strictEqual(V.parseStart('1:30'), 90));
  test('parseStart: h:mm:ss clock', () => assert.strictEqual(V.parseStart('1:02:03'), 3723));
  test('parseStart: junk -> 0', () => assert.strictEqual(V.parseStart('soon'), 0));

  // ── parseVideoSource ──
  test('parseVideoSource: url only', () => {
    const r = V.parseVideoSource('https://youtu.be/' + ID);
    assert.strictEqual(r.id, ID);
    assert.strictEqual(r.start, 0);
    assert.strictEqual(r.title, '');
  });
  test('parseVideoSource: title + start directives', () => {
    const r = V.parseVideoSource('https://youtu.be/' + ID + '\ntitle: My clip\nstart: 1:30');
    assert.strictEqual(r.id, ID);
    assert.strictEqual(r.start, 90);
    assert.strictEqual(r.title, 'My clip');
  });
  test('parseVideoSource: start pulled from t= param when no directive', () => {
    const r = V.parseVideoSource('https://www.youtube.com/watch?v=' + ID + '&t=45s');
    assert.strictEqual(r.start, 45);
  });
  test('parseVideoSource: directive start overrides url param', () => {
    const r = V.parseVideoSource('https://www.youtube.com/watch?v=' + ID + '&t=45s\nstart: 10');
    assert.strictEqual(r.start, 10);
  });
  test('parseVideoSource: empty block -> error', () => {
    assert.ok(V.parseVideoSource('   \n  ').error);
  });
  test('parseVideoSource: bad url -> error, no id', () => {
    const r = V.parseVideoSource('https://evil.com/x');
    assert.ok(r.error);
    assert.strictEqual(r.id, undefined);
  });

  // ── buildEmbedUrl: always nocookie + rel=0, only ever a validated id ──
  test('buildEmbedUrl: nocookie host + rel=0', () => {
    const u = V.buildEmbedUrl({ id: ID });
    assert.strictEqual(u, 'https://www.youtube-nocookie.com/embed/' + ID + '?rel=0');
  });
  test('buildEmbedUrl: appends start', () => {
    const u = V.buildEmbedUrl({ id: ID, start: 90 });
    assert.strictEqual(u, 'https://www.youtube-nocookie.com/embed/' + ID + '?rel=0&start=90');
  });
  test('buildEmbedUrl: never standard youtube.com', () => {
    const u = V.buildEmbedUrl({ id: ID });
    assert.ok(u.indexOf('youtube-nocookie.com') !== -1);
    assert.ok(!/\/\/(?:www\.)?youtube\.com\//.test(u));
  });

  // End-to-end: a hostile block can never yield an embed url.
  test('hostile source never reaches buildEmbedUrl', () => {
    const r = V.parseVideoSource('"><iframe src=javascript:alert(1)>');
    assert.ok(r.error, 'must be rejected at parse');
  });
};
