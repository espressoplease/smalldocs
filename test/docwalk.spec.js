// @ts-check
const { test, expect } = require('@playwright/test');
const BASE = process.env.SDOCS_TEST_BASE || '/docs';

async function openWalk(page, body, annotations, meta) {
  await page.goto(BASE);
  await page.waitForFunction(() =>
    window.SDocs && window.SDocs.docwalk && window.SDocs.commentsUi && window.SDocs.render);
  await page.evaluate(({ body, annotations, meta }) => {
    window.SDocs.currentBody = body;
    window.SDocs.currentMeta = Object.assign({ docwalk: true, annotations }, meta || {});
    window.SDocs.render();
  }, { body, annotations, meta });
}

test('renders ordered Markdown annotations as a guided walkthrough', async ({ page }) => {
  const body = '# Intro\n\nFirst paragraph.\n\n## Detail\n\nSecond paragraph.\n';
  await openWalk(page, body, [
    { line: 7, text: 'Read the **detail** first.' },
    { line: 1, text: 'Then return to the title.' },
  ]);

  const cards = page.locator('.sdoc-docwalk-card');
  await expect(cards).toHaveCount(2);
  const first = page.locator('.sdoc-docwalk-card[data-docwalk-step="0"]');
  const second = page.locator('.sdoc-docwalk-card[data-docwalk-step="1"]');
  await expect(first).toContainText('Step 1 of 2');
  await expect(first.locator('strong')).toHaveText('detail');
  await expect(second).toContainText('Step 2 of 2');
  await expect(first).toHaveClass(/is-active/);
  await expect(page.locator('.sdoc-docwalk-inline.sdoc-docwalk-target-active')).toHaveText('Second paragraph.');
});

test('document notes use the shared walkthrough card without a left rail', async ({ page }) => {
  await openWalk(page, '# Target\n', [{ line: 1, text: 'Shared chrome.' }]);

  const card = page.locator('.sdoc-docwalk-card');
  await expect(card).toHaveClass(/sdoc-walkthrough-card/);
  await expect(card.locator('.sdoc-docwalk-step')).toHaveClass(/sdoc-walkthrough-step/);
  await expect(card.locator('[data-docwalk="next"]')).toHaveClass(/sdoc-walkthrough-nav/);

  const style = await card.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      borderTop: computed.borderTopWidth,
      borderRight: computed.borderRightWidth,
      borderBottom: computed.borderBottomWidth,
      borderLeft: computed.borderLeftWidth,
      radius: computed.borderRadius,
      shadow: computed.boxShadow,
    };
  });
  expect(style).toEqual({
    borderTop: '0px',
    borderRight: '0px',
    borderBottom: '0px',
    borderLeft: '0px',
    radius: '5px',
    shadow: expect.stringContaining('2px'),
  });
});

test('Next, Prev, restart, and arrow keys move the active document target', async ({ page }) => {
  const body = '# First\n\nMiddle.\n\n# Last\n';
  await openWalk(page, body, [
    { line: 1, text: 'first' },
    { line: 3, text: 'middle' },
    { line: 5, text: 'last' },
  ]);

  await page.locator('.sdoc-docwalk-card.is-active [data-docwalk="next"]').click();
  await expect(page.locator('.sdoc-docwalk-card.is-active .sdoc-docwalk-position')).toHaveText('Step 2 of 3');
  await expect(page.locator('.sdoc-docwalk-inline.sdoc-docwalk-target-active')).toHaveText('Middle.');

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.sdoc-docwalk-card.is-active .sdoc-docwalk-position')).toHaveText('Step 3 of 3');
  await expect(page.locator('h1').last()).toHaveClass(/sdoc-docwalk-target-active/);

  await page.locator('.sdoc-docwalk-card.is-active [data-docwalk="restart"]').click();
  await expect(page.locator('.sdoc-docwalk-card.is-active .sdoc-docwalk-position')).toHaveText('Step 1 of 3');
  await expect(page.locator('h1').first()).toHaveClass(/sdoc-docwalk-target-active/);

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.sdoc-docwalk-card.is-active .sdoc-docwalk-position')).toHaveText('Step 1 of 3');
});

test('a line inside a multiline paragraph highlights only that rendered line', async ({ page }) => {
  const body = 'Opening line\nwith **important** detail\nand closing context.\n';
  await openWalk(page, body, [{ line: 2, text: 'Focus here.' }]);

  const mark = page.locator('.sdoc-docwalk-inline');
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveText('with important detail');
  await expect(mark).toHaveClass(/sdoc-docwalk-target-active/);
  await expect(page.locator('#_sd_rendered p').first()).not.toHaveClass(/sdoc-docwalk-target-active/);
});

test('an explicit quote highlights exact characters inside prose', async ({ page }) => {
  const body = 'Choose the reliable path before the fast path.\n';
  await openWalk(page, body, [{
    line: 1, quote: 'reliable path', text: 'This phrase is the decision.',
  }]);

  const mark = page.locator('.sdoc-docwalk-inline.sdoc-docwalk-target-active');
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveText('reliable path');
  await expect(page.locator('#_sd_rendered > p').first())
    .toContainText('Choose the reliable path before the fast path.');
});

test('a source range highlights every rendered block it crosses', async ({ page }) => {
  const body = '# Heading\n\nParagraph.\n';
  await openWalk(page, body, [{ line: 1, endLine: 3, text: 'Read these together.' }]);

  await expect(page.locator('h1.sdoc-docwalk-target-active')).toHaveCount(1);
  await expect(page.locator('p .sdoc-docwalk-inline.sdoc-docwalk-target-active')).toHaveCount(1);
  await expect(page.locator('.sdoc-docwalk-card')).toHaveCount(1);
});

test('lines inside sheets and slides target the whole rich block', async ({ page }) => {
  const body = [
    '# Rich blocks',
    '',
    '```cells',
    'Name,Value',
    'A,2',
    '```',
    '',
    '```slide',
    'grid 100 56.25',
    'r 10 10 80 20 | Review this slide',
    '```',
  ].join('\n');
  await openWalk(page, body, [
    { line: 5, text: 'Check the sheet.' },
    { line: 10, text: 'Then review the slide.' },
  ]);

  await expect(page.locator('.sdoc-cells.sdoc-docwalk-target-active')).toHaveCount(1);
  await expect(page.locator('.sdoc-slide.sdoc-docwalk-target')).toHaveCount(1);
  await page.locator('.sdoc-docwalk-card.is-active [data-docwalk="next"]').click();
  await expect(page.locator('.sdoc-slide.sdoc-docwalk-target-active')).toHaveCount(1);
  await expect(page.locator('.sdoc-cells.sdoc-docwalk-target-active')).toHaveCount(0);
});

test('a tabbed sheet highlights the complete workbook frame', async ({ page }) => {
  const body = [
    '```cells Inputs',
    'Metric,Value',
    'Readers,120',
    '```',
    '',
    '```cells Summary',
    'Metric,Value',
    'Completed,106.8',
    '```',
  ].join('\n');
  await openWalk(page, body, [{ line: 8, text: 'Review the summary.' }], {
    'cells-tabs': true,
  });

  const pane = page.locator('.sdoc-cells-pane.sdoc-docwalk-target-active');
  await expect(pane).toHaveCount(1);
  await expect(pane.locator('.sdoc-cells-pane-tab.is-active')).toHaveText('Summary');
  const highlight = await pane.evaluate((element) => ({
    outline: getComputedStyle(element).outlineWidth,
    shadow: getComputedStyle(element).boxShadow,
  }));
  expect(highlight.outline).toBe('0px');
  expect(highlight.shadow).not.toBe('none');
});

test('a regular code fence hosts an inline card below its highlighted source line', async ({ page }) => {
  const body = '# Example\n\n```js\nconst alpha = 1;\nconst answer = alpha + 41;\n```\n';
  await openWalk(page, body, [{ line: 5, text: 'This calculation matters.' }]);

  await expect(page.locator('pre.sdoc-docwalk-code-source')).toBeHidden();
  await expect(page.locator('.sdoc-docwalk-code-row[data-code-line="2"]')).toHaveClass(/sdoc-docwalk-target-active/);
  await expect(page.locator('.agent-comment-btn')).toHaveCount(0);
  const card = page.locator('.sdoc-docwalk-card');
  await expect(card).toContainText('This calculation matters.');
  await expect(card.locator('xpath=ancestor::*[contains(@class,"sdoc-docwalk-code")]')).toHaveCount(1);

  const geometry = await page.evaluate(() => {
    const row = document.querySelector('.sdoc-docwalk-code-row[data-code-line="2"]');
    const card = document.querySelector('.sdoc-docwalk-card');
    const rr = row.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    return { rowBottom: rr.bottom, cardTop: cr.top };
  });
  expect(geometry.cardTop).toBeGreaterThanOrEqual(geometry.rowBottom);
  await expect(page.locator('.pre-wrapper .copy-btn')).toHaveCount(1);
  await expect(page.locator('.pre-wrapper .expand-btn')).toHaveCount(1);
});

test('a code quote highlights exact characters without washing the whole line', async ({ page }) => {
  const body = '```js\nconst answer = alpha + 41;\n```\n';
  await openWalk(page, body, [{
    line: 2, quote: 'alpha + 41', text: 'Only this expression is selected.',
  }]);

  const token = page.locator('.sdoc-docwalk-code-token.sdoc-docwalk-target-active');
  await expect(token).toHaveCount(1);
  await expect(token).toHaveText('alpha + 41');
  await expect(page.locator('.sdoc-docwalk-code-row.sdoc-docwalk-target-active')).toHaveCount(0);
});

test('inline and fullscreen code share one walkthrough cursor', async ({ page }) => {
  const body = 'Read this first.\n\n```js\nconst answer = alpha + 41;\n```\n';
  await openWalk(page, body, [
    { line: 1, text: 'The prose step.' },
    { line: 4, quote: 'alpha + 41', text: 'The code step.' },
  ]);

  await page.locator('.sdoc-docwalk-card.is-active [data-docwalk="next"]').click();
  await page.locator('.pre-wrapper .expand-btn').click();
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  await expect(page.locator('.sdoc-ann-row.sdoc-cw-active .sdoc-cw-pos')).toHaveText('Step 2 of 2');
  await expect(page.locator('.sdoc-ann-token-mark.sdoc-cw-token-active')).toHaveText('alpha + 41');
  await expect(page.locator('.sdoc-ann-row.sdoc-cw-active .sdoc-ann-card')).toContainText('The code step.');

  await page.locator('.sdoc-code-focus [data-act="close"]').click();
  await expect(page.locator('.sdoc-code-focus')).toHaveCount(0);
  await expect(page.locator('.sdoc-docwalk-card.is-active .sdoc-docwalk-position')).toHaveText('Step 2 of 2');
  await expect(page.locator('.sdoc-docwalk-code-token.sdoc-docwalk-target-active')).toHaveText('alpha + 41');

  await page.locator('.pre-wrapper .expand-btn').click();
  await page.locator('.sdoc-ann-row.sdoc-cw-active [data-cw="prev"]').click();
  await expect(page.locator('.sdoc-code-focus')).toHaveCount(0);
  await expect(page.locator('.sdoc-docwalk-card.is-active .sdoc-docwalk-position')).toHaveText('Step 1 of 2');
  await expect(page.locator('.sdoc-docwalk-inline.sdoc-docwalk-target-active')).toHaveText('Read this first.');
});

test('inactive document walkthrough metadata leaves the normal reader unchanged', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForFunction(() => window.SDocs && window.SDocs.docwalk && window.SDocs.render);
  await page.evaluate(() => {
    window.SDocs.currentBody = '# Ordinary\n\nText.\n';
    window.SDocs.currentMeta = { annotations: [{ line: 1, text: 'legacy code note' }] };
    window.SDocs.render();
  });
  await expect(page.locator('.sdoc-docwalk-card')).toHaveCount(0);
  await expect(page.locator('.sdoc-docwalk-target')).toHaveCount(0);
});
