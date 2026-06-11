// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Code-comments end-to-end tests - the comment mode in the fullscreen code
 * view (sdocs-code-focus.js + sdocs-code-comments.js).
 *
 * A reader annotates an open source file. Notes anchor to a source line or a
 * whole method and persist in localStorage keyed by the file. These tests drive
 * the overlay the way a user would (hover a line, click +, type, save) and
 * assert on the resulting DOM and on persistence across a close / reopen.
 *
 * The overlay is opened directly via SDocs.codeFocus.open(pre) rather than
 * through the auto-open-on-load path, so each test controls its own source.
 */

const RUBY = [
  'class PriceCache',
  '  CACHE_TTL = 300',
  '',
  '  def initialize(store:)',
  '    @store = store',
  '  end',
  '',
  '  # Fetch a price, falling back to upstream on a miss.',
  '  def fetch(symbol)',
  '    entry = @store[symbol]',
  '    return entry if entry',
  '    refresh(symbol)',
  '  end',
  'end',
].join('\n');

// Open a fresh overlay over a fenced code block. Clears any persisted notes for
// a clean slate (storage is keyed by content hash, so reruns would otherwise
// accumulate).
async function openCode(page, lang, code) {
  await page.evaluate(() => {
    try { Object.keys(localStorage).filter(function (k) { return k.indexOf('sdocs:codeComments') === 0; })
      .forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
  });
  await page.evaluate(({ lang, code }) => {
    window.SDocs.currentBody = '```' + lang + '\n' + code + '\n```\n';
    window.SDocs.currentMeta = {};
    window.SDocs.render();
    var pre = document.querySelector('#_sd_rendered pre');
    window.SDocs.codeFocus.open(pre);
  }, { lang, code });
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
}

async function enterCommentMode(page) {
  const btn = page.locator('.sdoc-code-focus [data-act="comment"]');
  if (!(await page.locator('.sdoc-code-focus.sdoc-cc-on').count())) await btn.click();
  await expect(page.locator('.sdoc-code-focus.sdoc-cc-on')).toBeVisible();
}

// Hover a line, reveal its +, click it, type, save. Returns nothing; assert on
// DOM afterwards.
async function addNote(page, ln, text, grain) {
  if (grain) await page.locator('.sdoc-cc-grain [data-grain="' + grain + '"]').click();
  await page.locator('.sdoc-cl-row[data-ln="' + ln + '"] .sdoc-cl-code').hover();
  // The + is a single element moved into the hovered row's gutter; in method
  // grain it lands on the method header rather than the hovered line, so click
  // it wherever it currently is.
  await page.locator('.sdoc-cc-add').click();
  await page.locator('.sdoc-cc-composer .sdoc-cc-input').fill(text);
  await page.locator('.sdoc-cc-composer [data-cc="save"]').click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.SDocs && window.SDocs.codeFocus && window.SDocs.render);
});

test('toggles comment mode on and off', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await enterCommentMode(page);
  await expect(page.locator('.sdoc-code-focus [data-act="comment"]')).toHaveClass(/active/);
  await page.locator('.sdoc-code-focus [data-act="comment"]').click();
  await expect(page.locator('.sdoc-code-focus.sdoc-cc-on')).toHaveCount(0);
});

test('adds a line comment with a card, marker, and count', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await enterCommentMode(page);
  await addNote(page, 1, 'magic number?');
  const card = page.locator('.sdoc-cc-thread[data-ln="1"] .sdoc-cc-card-body');
  await expect(card).toHaveText('magic number?');
  await expect(page.locator('.sdoc-cc-thread[data-ln="1"] .sdoc-cc-card-kind')).toHaveText('line');
  await expect(page.locator('.sdoc-cl-row[data-ln="1"].sdoc-cc-has-comment')).toHaveCount(1);
  await expect(page.locator('.sdoc-cc-count')).toHaveText('1 note');
});

test('adds a method comment that anchors to the signature and badges as method', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await enterCommentMode(page);
  // hover a line in the body of `def fetch` (line index 9), method grain anchors
  // the note to the signature line (index 8).
  await addNote(page, 9, 'extract a fetcher', 'method');
  await expect(page.locator('.sdoc-cc-thread-method[data-ln="8"]')).toHaveCount(1);
  await expect(page.locator('.sdoc-cc-thread[data-ln="8"] .sdoc-cc-card-kind')).toHaveText('method');
});

test('method hover highlights the whole method range', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await enterCommentMode(page);
  await page.locator('.sdoc-cc-grain [data-grain="method"]').click();
  await page.locator('.sdoc-cl-row[data-ln="9"] .sdoc-cl-code').hover();
  // def fetch (8) through its end. Expect more than one highlighted row.
  await expect(page.locator('.sdoc-cl-row.sdoc-cc-mhl').first()).toBeVisible();
  const n = await page.locator('.sdoc-cl-row.sdoc-cc-mhl').count();
  expect(n).toBeGreaterThan(1);
});

test('edits a comment in place', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await enterCommentMode(page);
  await addNote(page, 1, 'first');
  await page.locator('.sdoc-cc-thread[data-ln="1"] [data-cc="edit"]').click();
  await page.locator('.sdoc-cc-composer .sdoc-cc-input').fill('second');
  await page.locator('.sdoc-cc-composer [data-cc="save"]').click();
  await expect(page.locator('.sdoc-cc-thread[data-ln="1"] .sdoc-cc-card-body')).toHaveText('second');
  await expect(page.locator('.sdoc-cc-count')).toHaveText('1 note');
});

test('deletes a comment', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await enterCommentMode(page);
  await addNote(page, 1, 'gone soon');
  await page.locator('.sdoc-cc-thread[data-ln="1"] [data-cc="delete"]').click();
  await expect(page.locator('.sdoc-cc-thread')).toHaveCount(0);
  await expect(page.locator('.sdoc-cl-row[data-ln="1"].sdoc-cc-has-comment')).toHaveCount(0);
});

test('an empty composer does not save', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await enterCommentMode(page);
  await page.locator('.sdoc-cl-row[data-ln="1"] .sdoc-cl-code').hover();
  await page.locator('.sdoc-cl-row[data-ln="1"] .sdoc-cc-add').click();
  await page.locator('.sdoc-cc-composer [data-cc="save"]').click();
  // composer stays, nothing committed
  await expect(page.locator('.sdoc-cc-composer')).toHaveCount(1);
  await expect(page.locator('.sdoc-cc-thread[data-ln="1"]:not(.sdoc-cc-composer)')).toHaveCount(0);
});

test('Escape cancels the composer first, then closes the overlay', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await enterCommentMode(page);
  await page.locator('.sdoc-cl-row[data-ln="1"] .sdoc-cl-code').hover();
  await page.locator('.sdoc-cl-row[data-ln="1"] .sdoc-cc-add').click();
  await expect(page.locator('.sdoc-cc-composer')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sdoc-cc-composer')).toHaveCount(0);
  await expect(page.locator('.sdoc-code-focus')).toBeVisible(); // overlay survives
  await page.keyboard.press('Escape');
  await expect(page.locator('.sdoc-code-focus')).toHaveCount(0); // now it closes
});

test('notes persist across a close and reopen of the same file', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await enterCommentMode(page);
  await addNote(page, 1, 'sticky note');
  // close, then reopen the same content (storage is content-keyed)
  await page.evaluate(() => window.SDocs.codeFocus.close());
  await page.evaluate(() => {
    var pre = document.querySelector('#_sd_rendered pre');
    window.SDocs.codeFocus.open(pre);
  });
  await page.locator('.sdoc-code-focus [data-act="comment"]').click();
  await expect(page.locator('.sdoc-cc-thread[data-ln="1"] .sdoc-cc-card-body')).toHaveText('sticky note');
});

test('the granularity choice is remembered across reopen', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await enterCommentMode(page);
  await page.locator('.sdoc-cc-grain [data-grain="method"]').click();
  await expect(page.locator('.sdoc-cc-grain [data-grain="method"]')).toHaveClass(/active/);
  await page.evaluate(() => window.SDocs.codeFocus.close());
  await page.evaluate(() => {
    var pre = document.querySelector('#_sd_rendered pre');
    window.SDocs.codeFocus.open(pre);
  });
  await page.locator('.sdoc-code-focus [data-act="comment"]').click();
  await expect(page.locator('.sdoc-cc-grain [data-grain="method"]')).toHaveClass(/active/);
});

test('folding a method hides its note; navigating to it reveals it', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  // give the structural language defs a moment so the method folds as a leaf
  await page.waitForTimeout(400);
  await enterCommentMode(page);
  await addNote(page, 9, 'inside fetch'); // line comment inside def fetch body
  await expect(page.locator('.sdoc-cc-thread[data-ln="9"]')).toBeVisible();
  // collapse def fetch (header at line 8)
  await page.locator('.sdoc-cl-row[data-ln="8"] button.sdoc-cl-fold').click();
  await expect(page.locator('.sdoc-cc-thread[data-ln="9"]')).toBeHidden();
  // nav to the note reopens its method
  await page.locator('.sdoc-code-focus [data-act="cc-next"]').click();
  await expect(page.locator('.sdoc-cc-thread[data-ln="9"]')).toBeVisible();
});

test('navigation walks between notes and flashes the target', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await enterCommentMode(page);
  await addNote(page, 1, 'one');
  await addNote(page, 10, 'two');
  await expect(page.locator('.sdoc-cc-count')).toHaveText('2 notes');
  await page.locator('.sdoc-code-focus [data-act="cc-next"]').click();
  await expect(page.locator('.sdoc-cc-card.sdoc-cc-flash')).toHaveCount(1);
});

test('a note whose anchor line is gone is parked in the orphan list', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  // Seed storage with a note whose anchorText is absent from the source, under
  // the same content-hash key the overlay derives, then reopen so it loads.
  await page.evaluate(() => {
    var CC = window.SDocsCodeComments;
    var raw = document.querySelector('#_sd_rendered pre code').textContent;
    var h = 5381;
    for (var i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
    var key = 'sdocs:codeComments:hash:' + (h >>> 0).toString(36);
    var list = CC.addComment([], { kind: 'line', line: 1, anchorText: 'NOPE NOT HERE' }, { text: 'orphaned' }).list;
    localStorage.setItem(key, CC.serialize(list));
    window.SDocs.codeFocus.close();
    window.SDocs.codeFocus.open(document.querySelector('#_sd_rendered pre'));
  });
  await page.locator('.sdoc-code-focus [data-act="comment"]').click();
  await expect(page.locator('.sdoc-cc-orphans')).toHaveCount(1);
  await expect(page.locator('.sdoc-cc-orphans .sdoc-cc-card-body')).toHaveText('orphaned');
});
