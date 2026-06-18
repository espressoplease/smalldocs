// @ts-check
//
// Touch pinch/pan WIRING for the Mermaid fullscreen focus modal.
//
// The arithmetic is pinned in test/test-zoom-math.js (Node, exact). This
// spec only proves the events are wired and the gesture state machine
// behaves: pinch-out zooms in, pinch-in zooms out, one finger pans, and the
// 2->1 finger handoff continues without a jump. Per the review, assertions
// here are COARSE (direction + continuity), never exact scale values -
// synthetic TouchEvent clientX rounding isn't worth pinning in a browser.
//
// The modal is opened directly on a hand-built wrapper with an inline SVG, so
// this test never touches the Mermaid CDN.
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

// Run the whole gesture inside one page.evaluate so rAF-batched transform
// writes are read at deterministic points. Returns parsed {tx,ty,scale}
// snapshots plus the raw transform strings (to assert no NaN).
async function runGesture(page) {
  return await page.evaluate(async () => {
    function nextFrame() {
      return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    function parse(s) {
      const t = /translate\(([-\d.eE]+)px,\s*([-\d.eE]+)px\)/.exec(s) || [];
      const sc = /scale\(([-\d.eE]+)\)/.exec(s) || [];
      return { tx: parseFloat(t[1]), ty: parseFloat(t[2]), scale: parseFloat(sc[1]), raw: s };
    }

    const wrap = document.createElement('div');
    wrap.className = 'sdoc-mermaid';
    wrap.style.background = '#ffffff';
    wrap.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150" width="200" height="150">'
      + '<rect width="200" height="150" fill="#eeeeee"/></svg>';
    document.body.appendChild(wrap);

    window.SDocs.SDocMermaidFocus.open(wrap);
    await nextFrame(); // let fit() lay out

    const stage = document.querySelector('.sdoc-mermaid-focus-stage');
    const svgWrap = document.querySelector('.sdoc-mermaid-focus-svg-wrap');
    const r = stage.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;

    const T = (id, x, y) => new Touch({ identifier: id, target: stage, clientX: x, clientY: y, pageX: x, pageY: y });
    const fire = (type, touches, changed) => stage.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true,
      touches, targetTouches: touches, changedTouches: changed || touches
    }));

    const initial = parse(svgWrap.style.transform);

    // ── pinch OUT: spread 80px -> 200px (zoom in) ──
    fire('touchstart', [T(1, cx - 40, cy), T(2, cx + 40, cy)]);
    fire('touchmove', [T(1, cx - 100, cy), T(2, cx + 100, cy)]);
    await nextFrame();
    const afterOut = parse(svgWrap.style.transform);

    // ── pinch IN: spread 200px -> 60px (zoom out) ──
    fire('touchmove', [T(1, cx - 30, cy), T(2, cx + 30, cy)]);
    await nextFrame();
    const afterIn = parse(svgWrap.style.transform);

    // ── 2->1 handoff: lift finger 2, finger 1 stays put ──
    fire('touchend', [T(1, cx - 30, cy)], [T(2, cx + 30, cy)]);
    const beforeHandoff = parse(svgWrap.style.transform);
    fire('touchmove', [T(1, cx - 30, cy)]); // no movement => no pan
    await nextFrame();
    const afterHandoff = parse(svgWrap.style.transform);

    // ── one-finger pan: drag +60 / +40 ──
    fire('touchmove', [T(1, cx + 30, cy + 40)]);
    await nextFrame();
    const afterPan = parse(svgWrap.style.transform);

    fire('touchend', [], [T(1, cx + 30, cy + 40)]);
    window.SDocs.SDocMermaidFocus.close();

    return { initial, afterOut, afterIn, beforeHandoff, afterHandoff, afterPan };
  });
}

test('two-finger pinch zooms, one-finger pans, 2->1 handoff does not jump', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForSelector('#_sd_rendered');
  // The focus module exposes its API on window.SDocs.
  await page.waitForFunction(() => window.SDocs && window.SDocs.SDocMermaidFocus);

  const g = await runGesture(page);

  // No transform string is ever NaN / malformed.
  for (const key of ['initial', 'afterOut', 'afterIn', 'beforeHandoff', 'afterHandoff', 'afterPan']) {
    expect(Number.isFinite(g[key].scale), `${key}.scale finite (${g[key].raw})`).toBeTruthy();
    expect(Number.isFinite(g[key].tx), `${key}.tx finite`).toBeTruthy();
    expect(Number.isFinite(g[key].ty), `${key}.ty finite`).toBeTruthy();
  }

  // Pinch out zooms in; pinch in then zooms back out.
  expect(g.afterOut.scale).toBeGreaterThan(g.initial.scale);
  expect(g.afterIn.scale).toBeLessThan(g.afterOut.scale);

  // The 2->1 handoff followed by a zero-movement touchmove must not move the
  // diagram: continuity, not just "didn't crash". (Re-seed bug would snap it
  // by roughly the inter-finger gap.)
  expect(Math.abs(g.afterHandoff.tx - g.beforeHandoff.tx)).toBeLessThan(0.5);
  expect(Math.abs(g.afterHandoff.ty - g.beforeHandoff.ty)).toBeLessThan(0.5);
  expect(Math.abs(g.afterHandoff.scale - g.beforeHandoff.scale)).toBeLessThan(1e-6);

  // After the handoff, one finger pans: +30 / +40 from the handoff anchor.
  expect(g.afterPan.tx - g.afterHandoff.tx).toBeGreaterThan(50);
  expect(g.afterPan.ty - g.afterHandoff.ty).toBeGreaterThan(30);
});

test('a gesture interrupted by close() leaves no stale state on reopen', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForSelector('#_sd_rendered');
  await page.waitForFunction(() => window.SDocs && window.SDocs.SDocMermaidFocus);

  const reopened = await page.evaluate(async () => {
    function nextFrame() { return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }
    function buildWrap() {
      const w = document.createElement('div');
      w.className = 'sdoc-mermaid';
      w.style.background = '#ffffff';
      w.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150" width="200" height="150"><rect width="200" height="150" fill="#eee"/></svg>';
      document.body.appendChild(w);
      return w;
    }
    const F = window.SDocs.SDocMermaidFocus;

    F.open(buildWrap());
    await nextFrame();
    let stage = document.querySelector('.sdoc-mermaid-focus-stage');
    let svgWrap = document.querySelector('.sdoc-mermaid-focus-svg-wrap');
    const r = stage.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const T = (id, x, y) => new Touch({ identifier: id, target: stage, clientX: x, clientY: y, pageX: x, pageY: y });
    const fire = (type, touches) => stage.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: touches }));

    // Start a pinch then yank the modal closed mid-gesture (no touchend).
    fire('touchstart', [T(1, cx - 40, cy), T(2, cx + 40, cy)]);
    fire('touchmove', [T(1, cx - 90, cy), T(2, cx + 90, cy)]);
    F.close();

    // Reopen fresh: fit() should re-centre (tx == ty == 0), proving the
    // interrupted pinch's pinch/lastTouch/stageRect state didn't leak.
    F.open(buildWrap());
    await nextFrame();
    svgWrap = document.querySelector('.sdoc-mermaid-focus-svg-wrap');
    const m = /translate\(([-\d.eE]+)px,\s*([-\d.eE]+)px\)/.exec(svgWrap.style.transform) || [];
    const out = { tx: parseFloat(m[1]), ty: parseFloat(m[2]) };
    F.close();
    return out;
  });

  expect(Math.abs(reopened.tx)).toBeLessThan(0.5);
  expect(Math.abs(reopened.ty)).toBeLessThan(0.5);
});
