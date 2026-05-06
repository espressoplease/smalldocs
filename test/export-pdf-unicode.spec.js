// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

// Capture PDF bytes by hooking URL.createObjectURL, then extract selectable
// text via pdf.js. Returns { status, text }.
async function exportAndExtract(page, md) {
  await page.goto(BASE);
  await page.waitForTimeout(500);
  await page.evaluate((content) => {
    window.SDocs.loadText(content, 'unicode.md');
  }, md);
  await page.waitForTimeout(500);

  return page.evaluate(async () => {
    function loadScript(src) {
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    await loadScript('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js');
    await loadScript('https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js');
    if (!window['pdfjsLib']) {
      await loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js';
    }

    let capturedBytes = null;
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = function(blob) {
      if (blob && blob.type === 'application/pdf') {
        blob.arrayBuffer().then(ab => { capturedBytes = new Uint8Array(ab); });
      }
      return origCreate.call(URL, blob);
    };

    document.getElementById('_sd_exp-pdf').click();
    for (let i = 0; i < 60 && !capturedBytes; i++) {
      await new Promise(r => setTimeout(r, 250));
    }
    URL.createObjectURL = origCreate;
    const status = document.getElementById('_sd_status-text').textContent;
    if (!capturedBytes) return { status, text: null };

    const pdf = await window.pdfjsLib.getDocument({ data: capturedBytes }).promise;
    let text = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const pg = await pdf.getPage(p);
      const tc = await pg.getTextContent();
      text += tc.items.map(it => it.str).join('\n') + '\n';
    }
    return { status, text };
  });
}

test.describe('PDF export - Unicode coverage', () => {
  test('box-drawing characters render and are selectable', async ({ page }) => {
    const md = [
      '# Box',
      '',
      '```',
      '┌──┐',
      '│ ok │',
      '└──┘',
      '```',
    ].join('\n');
    const { status, text } = await exportAndExtract(page, md);
    expect(status).toBe('PDF downloaded');
    expect(text).toContain('└');
    expect(text).toContain('┌');
    expect(text).toContain('│');
  });

  test('emoji renders in body text and is selectable', async ({ page }) => {
    // Rocket and party-popper - both in the standard Noto Emoji set we load
    // as a fallback when the user's primary font lacks emoji glyphs.
    const md = '# Emoji\n\nLaunch \u{1F680} party \u{1F389} done.\n';
    const { status, text } = await exportAndExtract(page, md);
    expect(status).toBe('PDF downloaded');
    expect(text).toContain('\u{1F680}');
    expect(text).toContain('\u{1F389}');
  });

  test('emoji renders inside inline code', async ({ page }) => {
    const md = '# Inline\n\nUse `\u{1F680}` to launch.\n';
    const { status, text } = await exportAndExtract(page, md);
    expect(status).toBe('PDF downloaded');
    expect(text).toContain('\u{1F680}');
  });

  test('zero-width space is stripped silently (does not count as omitted)', async ({ page }) => {
    // ZWSP is invisible in every renderer; we drop it without warning the user
    // because it has no visual effect even when "omitted".
    const md = '# ZWSP\n\nfoo​bar\n';
    const { status } = await exportAndExtract(page, md);
    expect(status).toBe('PDF downloaded'); // no omission count
  });

  test('characters no font supports are dropped, omission count surfaces', async ({ page }) => {
    // CJK ideographs are outside Inter (latin), JetBrainsMono full TTF, and
    // Noto Emoji. With our chain they should drop and the status bar should
    // tell the user.
    const md = '# CJK\n\nHello 你好 world\n';
    const { status, text } = await exportAndExtract(page, md);
    expect(status).toMatch(/PDF downloaded - 2 characters omitted/);
    // Visible text still arrives - just not the dropped chars.
    expect(text).toContain('Hello');
    expect(text).toContain('world');
    expect(text).not.toContain('你');
    expect(text).not.toContain('好');
  });

  test('multiple emoji in sequence each render in their own segment', async ({ page }) => {
    // Surrogate pair handling: each U+1F6xx character is two UTF-16 code units.
    // A bug in the splitter's `len += 2` step would chop emoji in half. Three
    // adjacent emoji exercise that boundary.
    const md = '# Three\n\n\u{1F680}\u{1F389}\u{1F4A1}\n';
    const { status, text } = await exportAndExtract(page, md);
    expect(status).toBe('PDF downloaded');
    expect(text).toContain('\u{1F680}');
    expect(text).toContain('\u{1F389}');
    expect(text).toContain('\u{1F4A1}');
  });

  test('repeated unrenderable char counts every occurrence, not just the first', async ({ page }) => {
    // The encodability cache is keyed by codepoint - a regression that cached
    // "this char drops" but only counted the first hit would silently misreport
    // the omission total to the user.
    const md = '# Repeat\n\n你你你你你\n';
    const { status } = await exportAndExtract(page, md);
    expect(status).toMatch(/PDF downloaded - 5 characters omitted/);
  });

  test('StandardFont fallback path: offline export still works', async ({ page }) => {
    // When font fetches fail, body falls back to StandardFonts.Helvetica and
    // mono to StandardFonts.Courier. Both are WinAnsi, so they throw on most
    // non-Latin1 chars - canEncodeChar's encodeText try/catch path is what
    // keeps the export from crashing in that scenario.
    await page.route('**/cdn.jsdelivr.net/**/JetBrainsMono*', (r) => r.abort());
    await page.route('**/cdn.jsdelivr.net/**/noto-emoji*', (r) => r.abort());
    await page.route('**/cdn.jsdelivr.net/fontsource/**', (r) => r.abort());

    const md = '# Offline\n\nPlain ASCII works.\n\nBox └ should drop.\n';
    const { status, text } = await exportAndExtract(page, md);
    // Export completes even with no embedded fonts available.
    expect(status).toMatch(/PDF downloaded/);
    expect(text).toContain('Plain ASCII works');
    // U+2514 is outside WinAnsi; the StandardFont's encodeText would have
    // thrown without our sanitizer/fallback. We expect it dropped silently.
    expect(text).not.toContain('└');
    expect(status).toMatch(/1 character omitted/);
  });
});
