// @ts-check
const { test, expect } = require('@playwright/test');

const CANARY = '--sdocs-authored-css-canary';
const CANARY_RULE = '#_sd_btn-read, .sdoc-code-focus { ' + CANARY + ': authored; }';
const STYLE_BLOCK = '<div><style>' + CANARY_RULE + '</style><p>Readable prose.</p></div>';

async function openReader(page) {
  await page.goto('/new');
  await page.waitForFunction(() => window.SDocs && window.SDocs._appReady && typeof window.SDocs.loadText === 'function');
  await page.evaluate(() => window.SDocs.setMode('read', true));
}

async function loadDocument(page, source, mode = 'read') {
  await page.evaluate(({ source, mode }) => {
    window.SDocs.loadText(source, 'style-isolation.md');
    window.SDocs.setMode(mode, true);
  }, { source, mode });
}

async function expectChromeUnaffected(page) {
  expect(await page.locator('#_sd_btn-read').evaluate((element, property) =>
    getComputedStyle(element).getPropertyValue(property).trim(), CANARY)).toBe('');
}

test.beforeEach(async ({ page }) => { await openReader(page); });

for (const mode of ['read', 'write', 'comment']) {
  test('prose style blocks cannot affect app chrome in ' + mode + ' mode', async ({ page }) => {
    await loadDocument(page, '# Style isolation\n\n' + STYLE_BLOCK, mode);
    const surface = page.locator(mode === 'write' ? '#_sd_write' : '#_sd_rendered');
    await expect(surface).toContainText('Readable prose.');
    await expectChromeUnaffected(page);
    await expect(surface.locator('style')).toHaveCount(0);
  });
}

test('prose comment text remains literal and cannot add styles', async ({ page }) => {
  await loadDocument(page, 'Comment target.', 'comment');
  await page.evaluate((text) => {
    const added = window.SDocComments.addBlockComment(window.SDocs.currentMeta, { block: 'p:0' }, {
      text, author: 'Reviewer', color: '#ffbb00',
    });
    window.SDocs.currentMeta = added.meta;
    window.SDocs.syncAll('comment');
  }, STYLE_BLOCK);
  const card = page.locator('.sdoc-card');
  await expect(card).toContainText(STYLE_BLOCK);
  await expect(card.locator('style')).toHaveCount(0);
  await expectChromeUnaffected(page);
});

test('document annotation Markdown cannot add global styles', async ({ page }) => {
  await page.evaluate((text) => {
    window.SDocs.currentBody = 'Annotation target.';
    window.SDocs.currentMeta = { docwalk: true, annotations: [{ line: 1, text }] };
    window.SDocs.render();
    window.SDocs.setMode('read', true);
  }, STYLE_BLOCK);
  const card = page.locator('.sdoc-docwalk-card');
  await expect(card).toContainText('Readable prose.');
  await expect(card.locator('style')).toHaveCount(0);
  await expectChromeUnaffected(page);
});

test('code annotation Markdown cannot add global styles', async ({ page }) => {
  await page.evaluate((text) => {
    window.SDocs.currentBody = '```js\nconst answer = 42;\n```';
    window.SDocs.currentMeta = { annotations: [{ line: 1, text }] };
    window.SDocs.render();
    window.SDocs.setMode('read', true);
    window.SDocs.codeFocus.open(document.querySelector('#_sd_rendered pre'));
  }, STYLE_BLOCK);
  const card = page.locator('.sdoc-ann-card');
  await expect(card).toContainText('Readable prose.');
  await expect(card.locator('style')).toHaveCount(0);
  await expectChromeUnaffected(page);
  expect(await page.locator('.sdoc-code-focus').evaluate((element, property) =>
    getComputedStyle(element).getPropertyValue(property).trim(), CANARY)).toBe('');
});

test('YAML document styles still apply to reading and editing surfaces', async ({ page }) => {
  const source = '---\nstyles:\n  color: "#123456"\n  baseFontSize: 19\n  fontFamily: Georgia\n---\n# Styled heading\n\nStyled paragraph.';
  await loadDocument(page, source);
  await expect(page.locator('#_sd_rendered p')).toHaveCSS('color', 'rgb(18, 52, 86)');
  await expect(page.locator('#_sd_rendered p')).toHaveCSS('font-size', '19px');
  await expect(page.locator('#_sd_rendered p')).toHaveCSS('font-family', /Georgia/);
  await page.evaluate(() => window.SDocs.setMode('write', true));
  await expect(page.locator('#_sd_write p')).toHaveCSS('color', 'rgb(18, 52, 86)');
  await expect(page.locator('#_sd_write p')).toHaveCSS('font-size', '19px');
  await expect(page.locator('#_sd_write p')).toHaveCSS('font-family', /Georgia/);
});

test('sandboxed app HTML retains its CSS and JavaScript', async ({ page }) => {
  const source = '<!doctype html><html><head><title>Styled component</title><style>' + CANARY_RULE +
    '#fixture { color: rgb(12, 34, 56); font-size: 23px; }</style></head>' +
    '<body><p id="fixture">Component text</p><script>document.body.dataset.ready="yes";</script></body></html>';
  await loadDocument(page, '~~~sdoc-app\n' + source + '\n~~~');
  const component = page.frameLocator('.sdoc-app-frame');
  await expect(component.locator('#fixture')).toHaveCSS('color', 'rgb(12, 34, 56)');
  await expect(component.locator('#fixture')).toHaveCSS('font-size', '23px');
  await expect(component.locator('body')).toHaveAttribute('data-ready', 'yes');
  await expectChromeUnaffected(page);
});

test('slide shadow styles stay scoped and preserve authored typography', async ({ page }) => {
  const source = [
    '# Slide typography', '', '~~~slide', 'grid 100 56.25',
    'r 5 5 90 46 size=24px h1Scale=1.4 pScale=0.6 |',
    '  <div><style>' + CANARY_RULE + '.slide-copy { color: rgb(33, 66, 99); }</style></div>',
    '', '  # Slide title', '',
    '  <p class="slide-copy" style="font-weight: 600;">Slide body</p>', '~~~',
  ].join('\n');
  await loadDocument(page, source);
  const host = page.locator('.sdoc-slide .shape-md');
  await expect(host.locator('h1')).toHaveText('Slide title');
  await expect(host.locator('h1')).toHaveCSS('font-size', '33.6px');
  await expect(host.locator('p')).toHaveCSS('font-size', '14.4px');
  await expect(host.locator('p')).toHaveCSS('color', 'rgb(33, 66, 99)');
  await expect(host.locator('p')).toHaveCSS('font-weight', '600');
  expect(await host.evaluate(element => element.shadowRoot.querySelectorAll('style').length)).toBeGreaterThanOrEqual(2);
  await expectChromeUnaffected(page);
});
