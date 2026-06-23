// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Cross-surface comment parity (one store rendered in both surfaces).
 *
 * U3: a prose inline comment made on code text in the reader also shows in the
 * fullscreen viewer (read-only there - edited back in the reader).
 */

const DOC = '```ruby\nclass A\n  def run\n    1\n  end\nend\n```\n';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.SDocs && window.SDocs.codeFocus && window.SDocComments);
});

test('a prose inline comment on code shows in the viewer, identical and editable', async ({ page }) => {
  await page.evaluate((body) => {
    var S = window.SDocs, SDC = window.SDocComments;
    S.currentBody = body;
    S.currentMeta = {};
    S.render();
    var res = SDC.addSelectionComment(S.currentMeta,
      { quote: 'def run', prefix: '', suffix: '', block: 'pre:0' },
      { text: 'rename run', author: 'u', color: '#ffbb00' });
    S.currentMeta = res.meta;
    S.render();
    S.codeFocus.open(document.querySelector('#_sd_rendered pre'), { comment: true });
  }, DOC);
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  // the prose comment appears as a card below the line with its text...
  await expect(page.locator('.sdoc-code-focus .sdoc-cc-thread .sdoc-cc-card-body'))
    .toHaveText('rename run');
  // ...a precise mark over the quoted phrase...
  await expect(page.locator('.sdoc-code-focus .sdoc-cc-token-mark')).toHaveText('def run');
  // ...and it is editable here too (has a delete), same as in the reader.
  await expect(page.locator('.sdoc-cc-thread [data-cc="delete"]')).toHaveCount(1);
  // deleting it in the viewer removes it from the document (routes to the prose store)
  await page.locator('.sdoc-cc-thread [data-cc="delete"]').click();
  await expect(page.locator('.sdoc-code-focus .sdoc-cc-thread')).toHaveCount(0);
  const left = await page.evaluate(() => (window.SDocs.currentMeta.comments || []).length);
  expect(left).toBe(0);
});

// The legibility guarantee: a comment card must never overlap the code text.
// This fails if any comment is rendered inline in a code line (the bug we kept
// hitting); cards below their line cannot overlap.
test('comment cards never overlap code text in the viewer', async ({ page }) => {
  const LINES = [
    'def fetch(symbol, store):',
    '    entry = store.get(symbol)',
    '    if entry is not None:',
    '        return entry',
    '    return refresh(symbol)',
  ];
  await page.evaluate((lines) => {
    var S = window.SDocs, SDC = window.SDocComments, CC = window.SDocsCodeComments;
    var NL = String.fromCharCode(10);
    S.currentBody = '```python' + NL + lines.join(NL) + NL + '```' + NL;
    // one of each kind on the same listing
    var list = CC.addComment([], { kind: 'line', block: 'pre:0', line: 1, anchorText: 'entry = store.get(symbol)', text: 'a line comment that is fairly long so it would surely overlap if inline' }, { author: 'u', color: '#ffbb00' }).list;
    list = CC.addComment(list, { kind: 'token', block: 'pre:0', line: 2, quote: 'entry', anchorText: 'if entry is not None:', text: 'token note' }, { author: 'u', color: '#ffbb00' }).list;
    var meta = SDC.setComments({}, list);
    meta = SDC.addSelectionComment(meta, { quote: 'refresh', prefix: '', suffix: '', block: 'pre:0' }, { text: 'a prose comment on code, also long enough to overlap if it were inline', author: 'u', color: '#ffbb00' }).meta;
    S.currentMeta = meta;
    S.render();
    S.codeFocus.open(document.querySelector('#_sd_rendered pre'), { comment: true });
  }, LINES);
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  await page.locator('.sdoc-cl-code .hljs-keyword').first().waitFor({ timeout: 5000 }).catch(() => {});
  // every comment card sits clear of every code line's text (no box-on-box overlap)
  const overlap = await page.evaluate(() => {
    var codes = Array.from(document.querySelectorAll('.sdoc-code-focus-lines .sdoc-cl-row:not(.sdoc-cc-thread) .sdoc-cl-code'));
    var cards = Array.from(document.querySelectorAll('.sdoc-code-focus-lines .sdoc-cc-card'));
    for (var i = 0; i < cards.length; i++) {
      var a = cards[i].getBoundingClientRect();
      for (var j = 0; j < codes.length; j++) {
        var b = codes[j].getBoundingClientRect();
        var v = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        var h = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        if (v > 2 && h > 2) return { card: cards[i].textContent.slice(0, 30), code: (codes[j].textContent || '').slice(0, 30) };
      }
    }
    return null;
  });
  expect(overlap).toBeNull();
  // and there are no inline pills spliced into the code
  await expect(page.locator('.sdoc-cl-code .sdoc-cc-pill')).toHaveCount(0);
});

test('a code comment shows in the reader (read-only) in comment mode', async ({ page }) => {
  await page.evaluate((body) => {
    var S = window.SDocs;
    S.currentBody = body;
    S.currentMeta = { comments: [
      { id: 'c1', kind: 'token', block: 'pre:0', line: 1, quote: 'def run', anchorText: '  def run', text: 'rename run', author: 'u', color: '#ffbb00' },
    ] };
    S.render();
    S.setMode('comment');
  }, DOC);
  // the code comment is anchored on the code block in the reader, with its card
  await expect(page.locator('#_sd_rendered pre span.sdoc-anchor[data-c="c1"]')).toHaveText('def run');
  await expect(page.locator('#_sd_rendered .sdoc-card[data-c="c1"]')).toContainText('rename run');
  // read-only foreign card: no delete affordance (edited in the viewer)
  await expect(page.locator('.sdoc-card[data-c="c1"].sdoc-card-foreign .sdoc-card-delete')).toHaveCount(0);
});
