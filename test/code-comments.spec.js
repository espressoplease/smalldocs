// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Code-comments end-to-end tests - the comment mode in the fullscreen code
 * view (sdocs-code-focus.js + sdocs-code-comments.js).
 *
 * A reader annotates an open source file. Notes anchor to a source line or a
 * whole method and live in the document's front matter (currentMeta.comments),
 * exactly like prose comments - so they travel with a short link / share / export.
 * These tests drive the overlay the way a user would (hover a line, click +,
 * type, save) and assert on the resulting DOM, the document, and persistence
 * across a close / reopen.
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

// Open a fresh overlay over a fenced code block. Notes live in the document, so
// resetting currentMeta to {} (below) is the clean slate for each run.
async function openCode(page, lang, code) {
  await page.evaluate(({ lang, code }) => {
    window.SDocs.currentBody = '```' + lang + '\n' + code + '\n```\n';
    window.SDocs.currentMeta = {};
    window.SDocs.render();
    var pre = document.querySelector('#_sd_rendered pre');
    window.SDocs.codeFocus.open(pre);
  }, { lang, code });
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  await settleHighlight(page);
}

// Wait for the one-shot highlight upgrade to settle so its row rebuild can't
// land mid-interaction and move the hover affordance.
async function settleHighlight(page) {
  await page.locator('.sdoc-cl-code .hljs-keyword').first().waitFor({ timeout: 5000 }).catch(function () {});
}

// Close and reopen the overlay over the same rendered code, settling highlight.
async function reopen(page) {
  await page.evaluate(() => window.SDocs.codeFocus.close());
  await page.evaluate(() => window.SDocs.codeFocus.open(document.querySelector('#_sd_rendered pre')));
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  await settleHighlight(page);
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
  // Line grain: each row owns its "+" in the gutter, so target that row's.
  // Method grain: the single tall tab spanning the hovered method.
  if (grain === 'method') await page.locator('.sdoc-cc-madd').click();
  else await page.locator('.sdoc-cl-row[data-ln="' + ln + '"] .sdoc-cc-add').click();
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
  await expect(page.locator('.sdoc-cl-row[data-ln="1"].sdoc-cc-has-comment')).toHaveCount(1);
  await expect(page.locator('.sdoc-cc-count')).toHaveText('1 note');
});

test('adds a method comment that anchors to the signature', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await enterCommentMode(page);
  // hover a line in the body of `def fetch` (line index 9), method grain anchors
  // the note to the signature line (index 8).
  await addNote(page, 9, 'extract a fetcher', 'method');
  await expect(page.locator('.sdoc-cc-thread-method[data-ln="8"]')).toHaveCount(1);
  await expect(page.locator('.sdoc-cc-thread[data-ln="8"] .sdoc-cc-card-body')).toHaveText('extract a fetcher');
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

// A method whose body comment is long enough to soft-wrap onto a second visual
// line. The line-number gutter must fill the full height of that wrapped row,
// otherwise a method / comment highlight shows through the gutter on the
// continuation line and the number margin looks ragged.
const WRAPPING = [
  'function demo() {',
  '  // ' + 'this is a deliberately long inline comment written so that it has to soft wrap onto a second visual line inside the focus view code column making this row taller than a single line',
  '  return 1;',
  '}',
].join('\n');

test('the line-number gutter fills the full height of a soft-wrapped row', async ({ page }) => {
  await openCode(page, 'javascript', WRAPPING);
  await enterCommentMode(page);
  await page.locator('.sdoc-cc-grain [data-grain="method"]').click();
  await page.locator('.sdoc-cl-row[data-ln="1"] .sdoc-cl-code').hover();
  // the comment row (1) must actually wrap: taller than the single-line code row (2)
  const codeRow = await page.locator('.sdoc-cl-row[data-ln="2"]').boundingBox();
  const wrapRow = await page.locator('.sdoc-cl-row[data-ln="1"]').boundingBox();
  expect(wrapRow.height).toBeGreaterThan(codeRow.height * 1.5);
  // the gutter background must cover the whole wrapped row, not just line one
  const gutter = await page.locator('.sdoc-cl-row[data-ln="1"] .sdoc-cl-gutter').boundingBox();
  expect(gutter.height).toBeGreaterThanOrEqual(wrapRow.height - 1);
});

test('the method add affordance spans the method height and leaves a stripe', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await enterCommentMode(page);
  await page.locator('.sdoc-cc-grain [data-grain="method"]').click();
  await page.locator('.sdoc-cl-row[data-ln="10"] .sdoc-cl-code').hover(); // inside def fetch
  const tab = page.locator('.sdoc-cc-madd.show');
  await expect(tab).toBeVisible();
  const box = await tab.boundingBox();
  const rowBox = await page.locator('.sdoc-cl-row[data-ln="10"]').boundingBox();
  expect(box.height).toBeGreaterThan(rowBox.height * 2); // spans multiple lines
  // save a method note, then a persistent stripe marks the whole method
  await page.locator('.sdoc-cc-madd').click();
  await page.locator('.sdoc-cc-composer .sdoc-cc-input').fill('refactor');
  await page.locator('.sdoc-cc-composer [data-cc="save"]').click();
  expect(await page.locator('.sdoc-cl-row.sdoc-cc-method-marked').count()).toBeGreaterThan(2);
});

test('edits a comment in place', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await enterCommentMode(page);
  await addNote(page, 1, 'first');
  // Click the card body to edit, mirroring the markdown card's click-to-edit.
  await page.locator('.sdoc-cc-thread[data-ln="1"] .sdoc-cc-card-body').click();
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
  await expect(page.locator('.sdoc-cc-count')).toHaveText('1 note');
  // close, then reopen the same content (storage is content-keyed)
  await reopen(page);
  await page.locator('.sdoc-code-focus [data-act="comment"]').click();
  await expect(page.locator('.sdoc-cc-thread[data-ln="1"] .sdoc-cc-card-body')).toHaveText('sticky note');
});

test('the granularity choice is remembered across reopen', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await enterCommentMode(page);
  await page.locator('.sdoc-cc-grain [data-grain="method"]').click();
  await expect(page.locator('.sdoc-cc-grain [data-grain="method"]')).toHaveClass(/active/);
  await reopen(page);
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

test('a header copy button copies that section: a method copies itself, a class copies all of it', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await page.evaluate(() => {
    window.__copied = [];
    navigator.clipboard.writeText = function (t) { window.__copied.push(t); return Promise.resolve(); };
  });
  // def fetch header (line 8): copies just the method
  await page.locator('.sdoc-cl-row[data-ln="8"] .sdoc-cl-code').hover();
  await page.locator('.sdoc-cl-row[data-ln="8"] .sdoc-cl-copy').click();
  let copied = await page.evaluate(() => window.__copied[window.__copied.length - 1]);
  expect(copied).toContain('def fetch(symbol)');
  expect(copied).not.toContain('class PriceCache');
  expect(copied).not.toContain('def initialize');
  // class header (line 0): copies the whole class including every method
  await page.locator('.sdoc-cl-row[data-ln="0"] .sdoc-cl-code').hover();
  await page.locator('.sdoc-cl-row[data-ln="0"] .sdoc-cl-copy').click();
  copied = await page.evaluate(() => window.__copied[window.__copied.length - 1]);
  expect(copied).toContain('class PriceCache');
  expect(copied).toContain('def initialize');
  expect(copied).toContain('def fetch(symbol)');
});

test('copy-with-comments emits the code plus a notes list', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await enterCommentMode(page);
  // hidden until there are notes
  await expect(page.locator('.sdoc-cc-copyc')).toBeHidden();
  await addNote(page, 1, 'magic number?');
  await page.evaluate(() => {
    window.__copied = [];
    navigator.clipboard.writeText = function (t) { window.__copied.push(t); return Promise.resolve(); };
  });
  await expect(page.locator('.sdoc-cc-copyc')).toBeVisible();
  await page.locator('.sdoc-cc-copyc').click();
  const copied = await page.evaluate(() => window.__copied[window.__copied.length - 1]);
  expect(copied).toContain('```ruby');
  expect(copied).toContain('class PriceCache');
  expect(copied).toContain('Notes:');
  expect(copied).toContain('magic number?');
});

test('a note gives its parent headers a copy-with-comments button', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await enterCommentMode(page);
  // no notes yet, so no copy-with-comments buttons
  await expect(page.locator('.sdoc-cl-copyc')).toHaveCount(0);
  // a note inside def fetch (line 9) marks both the method header (8) and the class (0)
  await addNote(page, 9, 'memoise?');
  await expect(page.locator('.sdoc-cl-row[data-ln="0"] .sdoc-cl-copyc')).toHaveCount(1);
  await expect(page.locator('.sdoc-cl-row[data-ln="8"] .sdoc-cl-copyc')).toHaveCount(1);
  // def initialize (line 3) has no note, so no button there
  await expect(page.locator('.sdoc-cl-row[data-ln="3"] .sdoc-cl-copyc')).toHaveCount(0);
  // clicking the method's copies just that section with its note
  await page.evaluate(() => {
    window.__copied = [];
    navigator.clipboard.writeText = function (t) { window.__copied.push(t); return Promise.resolve(); };
  });
  await page.locator('.sdoc-cl-row[data-ln="8"] .sdoc-cl-copyc').click();
  const copied = await page.evaluate(() => window.__copied[window.__copied.length - 1]);
  expect(copied).toContain('def fetch(symbol)');
  expect(copied).toContain('Notes:');
  expect(copied).toContain('memoise?');
  expect(copied).not.toContain('def initialize');
});

test('the summary-view toggle folds the whole file and stays in sync with the toolbar', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  const summary = page.locator('.sdoc-code-focus .sdoc-cf-summary');
  await expect(summary).toBeVisible();
  // Toggle it and assert the file folds and the chevron state flips, without
  // assuming the initial fold preference (it persists across files).
  const before = await summary.evaluate(el => el.classList.contains('is-open'));
  await summary.click();
  const after = await summary.evaluate(el => el.classList.contains('is-open'));
  expect(after).toBe(!before);
  if (after === false) {
    expect(await page.locator('.sdoc-cl-row.collapsed').count()).toBeGreaterThan(0);
  }
  // The toolbar fold-all button reflects the same state (one source of truth).
  const tb = await page.locator('.sdoc-code-focus [data-act="foldall"]')
    .evaluate(el => el.classList.contains('is-open'));
  expect(tb).toBe(after);
  // And toggling the toolbar button flips the summary chevron back in step.
  await page.locator('.sdoc-code-focus [data-act="foldall"]').click();
  const summaryAfter = await summary.evaluate(el => el.classList.contains('is-open'));
  expect(summaryAfter).toBe(before);
});

test('a note whose anchor line is gone is parked in the orphan list', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  // Seed the document with a note (tagged to this block, pre:0) whose anchorText
  // is absent from the source, then reopen so it loads from the front matter.
  await page.evaluate(() => {
    var CC = window.SDocsCodeComments;
    var list = CC.addComment([], { kind: 'line', line: 1, anchorText: 'NOPE NOT HERE', block: 'pre:0' }, { text: 'orphaned' }).list;
    window.SDocs.currentMeta = Object.assign({}, window.SDocs.currentMeta, { comments: list });
    window.SDocs.codeFocus.close();
    window.SDocs.codeFocus.open(document.querySelector('#_sd_rendered pre'));
  });
  await page.locator('.sdoc-code-focus [data-act="comment"]').click();
  await expect(page.locator('.sdoc-cc-orphans')).toHaveCount(1);
  await expect(page.locator('.sdoc-cc-orphans .sdoc-cc-card-body')).toHaveText('orphaned');
});

test('a code note is written into the document front matter so it travels with the doc', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await enterCommentMode(page);
  await addNote(page, 1, 'rides along');
  const notes = await page.evaluate(() => window.SDocs.currentMeta.comments);
  expect(Array.isArray(notes)).toBe(true);
  expect(notes.length).toBe(1);
  expect(notes[0].text).toBe('rides along');
  expect(notes[0].block).toBe('pre:0');
});

test('notes stay attached to their own code block in a multi-block document', async ({ page }) => {
  // Two separate code blocks in one document (keyword-bearing so the syntax
  // highlight settles quickly between opens).
  await page.evaluate(() => {
    window.SDocs.currentBody =
      '```ruby\ndef first\n  return 1\nend\n```\n\n' +
      '```ruby\ndef second\n  return 2\nend\n```\n';
    window.SDocs.currentMeta = {};
    window.SDocs.render();
  });
  await expect(page.locator('#_sd_rendered pre')).toHaveCount(2);
  // Comment on the FIRST block.
  await page.evaluate(() => window.SDocs.codeFocus.open(document.querySelectorAll('#_sd_rendered pre')[0]));
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  await settleHighlight(page);
  await enterCommentMode(page);
  await addNote(page, 0, 'note on block one');
  await page.evaluate(() => window.SDocs.codeFocus.close());
  // Open the SECOND block: it carries no notes of its own.
  await page.evaluate(() => window.SDocs.codeFocus.open(document.querySelectorAll('#_sd_rendered pre')[1]));
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  await settleHighlight(page);
  await page.locator('.sdoc-code-focus [data-act="comment"]').click();
  await expect(page.locator('.sdoc-cc-thread')).toHaveCount(0);
  // Reopen the FIRST block: its note is still there.
  await page.evaluate(() => window.SDocs.codeFocus.close());
  await page.evaluate(() => window.SDocs.codeFocus.open(document.querySelectorAll('#_sd_rendered pre')[0]));
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  await settleHighlight(page);
  await page.locator('.sdoc-code-focus [data-act="comment"]').click();
  await expect(page.locator('.sdoc-cc-thread[data-ln="0"] .sdoc-cc-card-body')).toHaveText('note on block one');
  // The document records the note under the first block.
  const blocks = await page.evaluate(() => (window.SDocs.currentMeta.comments || []).map(function (c) { return c.block; }));
  expect(blocks).toContain('pre:0');
});

// A shared document's front matter (and thus its code comments) is authored by
// someone else and rendered in the reader's browser. These guard the inbound
// path: the model's sanitisers must run on load, and the list must be capped.
test('a hostile shared doc cannot smuggle a url() colour or control chars through code comments', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await page.evaluate(() => {
    window.SDocs.currentMeta = Object.assign({}, window.SDocs.currentMeta, {
      comments: [
        { id: 'c1', kind: 'line', block: 'pre:0', line: 1, anchorText: 'CACHE_TTL = 300',
          color: 'url(https://evil/p.gif)', text: 'see‮reversedbell', author: 'x' },
        { id: 'bad-id', kind: 'line', block: 'pre:0', line: 2, text: 'dropped' }, // invalid id
      ],
    });
    window.SDocs.codeFocus.close();
    window.SDocs.codeFocus.open(document.querySelector('#_sd_rendered pre'));
  });
  await page.locator('.sdoc-code-focus [data-act="comment"]').click();
  // colour is hex-gated: no url() reaches the CSS var
  const marker = await page.locator('.sdoc-cl-row[data-ln="1"]')
    .evaluate((el) => el.style.getPropertyValue('--sdoc-cc-marker'));
  expect(marker.toLowerCase()).not.toContain('url(');
  // bidi-override and control bytes stripped from the card body
  const body = await page.locator('.sdoc-cc-thread[data-ln="1"] .sdoc-cc-card-body').textContent();
  expect(body).not.toMatch(/[‮]/);
  // the malformed (invalid id) entry is dropped, so it never renders
  await expect(page.locator('.sdoc-cc-thread[data-ln="2"]:not(.sdoc-cc-composer)')).toHaveCount(0);
});

test('the "with comments" label is not shrunk on an indented (nested) method header', async ({ page }) => {
  // A nested method header carries a hanging indent (padding-left + negative
  // text-indent on .sdoc-cl-code). Because the copy buttons use all:unset,
  // text-indent (an inherited property) would leak in and slide the "with
  // comments" label left under its icon - only on the indented header. The
  // labels on the outer and the indented inner header must render the same width.
  await page.evaluate(() => {
    var S = window.SDocs, NL = String.fromCharCode(10);
    var lines = ['function outer() {', '  return function inner() {', '    return 1;', '  };', '}'];
    S.currentBody = '```js' + NL + lines.join(NL) + NL + '```' + NL;
    S.currentMeta = { comments: [
      { id: 'c1', kind: 'line', block: 'pre:0', line: 2, anchorText: '    return 1;', author: 'user', color: '#ffbb00', text: 'note' },
    ] };
    S.render();
    S.codeFocus.open(document.querySelector('#_sd_rendered pre'), { comment: true });
  });
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  await settleHighlight(page);
  // both the outer (line 0) and the nested, indented inner (line 1) header carry a
  // "with comments" copy; their labels must be the same rendered width.
  const widths = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.sdoc-code-focus .sdoc-cl-copyc span'))
      .map(s => Math.round(s.getBoundingClientRect().width)));
  expect(widths.length).toBeGreaterThanOrEqual(2);
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
});

test('code comments from a shared doc are capped to guard against a flood', async ({ page }) => {
  await openCode(page, 'ruby', RUBY);
  await page.evaluate(() => {
    var many = [];
    for (var i = 1; i <= 600; i++) {
      many.push({ id: 'c' + i, kind: 'line', block: 'pre:0', line: 1, anchorText: 'CACHE_TTL = 300', text: 'n' + i });
    }
    window.SDocs.currentMeta = Object.assign({}, window.SDocs.currentMeta, { comments: many });
    window.SDocs.codeFocus.close();
    window.SDocs.codeFocus.open(document.querySelector('#_sd_rendered pre'));
  });
  await page.locator('.sdoc-code-focus [data-act="comment"]').click();
  const threads = await page.locator('.sdoc-cc-thread:not(.sdoc-cc-composer)').count();
  expect(threads).toBeLessThanOrEqual(500);
  expect(threads).toBeGreaterThan(0);
});
