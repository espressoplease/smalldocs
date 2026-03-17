// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

/** Navigate to write mode and wait for the editor to be ready */
async function gotoWriteMode(page) {
  await page.goto(BASE + '/#mode=write');
  await page.waitForSelector('#write[contenteditable="true"]');
  await page.evaluate(() => document.getElementById('write').focus());
}

/** Set the write area innerHTML and focus it */
async function setWriteHTML(page, html) {
  await page.evaluate((h) => {
    const w = document.getElementById('write');
    w.innerHTML = h;
    w.focus();
  }, html);
}

/** Get the write area innerHTML */
async function getWriteHTML(page) {
  return page.evaluate(() => document.getElementById('write').innerHTML);
}

/** Place a collapsed cursor at a text offset inside a selector */
async function placeCursor(page, selector, offset) {
  await page.evaluate(({ sel, off }) => {
    const el = document.querySelector(sel);
    const textNode = el.firstChild;
    const range = document.createRange();
    range.setStart(textNode, off);
    range.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }, { sel: selector, off: offset });
}

/** Place cursor at end of an element */
async function placeCursorAtEnd(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }, selector);
}

/** Select a text range within a single text node */
async function selectTextRange(page, selector, start, end) {
  await page.evaluate(({ sel, s, e }) => {
    const el = document.querySelector(sel);
    const textNode = el.firstChild;
    const range = document.createRange();
    range.setStart(textNode, s);
    range.setEnd(textNode, e);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, { sel: selector, s: start, e: end });
}

/** Select all contents of an element */
async function selectAll(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }, selector);
}

/** Check if the current cursor is inside a given tag */
async function cursorIsInside(page, tagName) {
  return page.evaluate((tag) => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return false;
    let el = sel.anchorNode;
    if (el && el.nodeType !== 1) el = el.parentElement;
    const w = document.getElementById('write');
    while (el && el !== w) {
      if (el.tagName === tag) return true;
      el = el.parentElement;
    }
    return false;
  }, tagName);
}

/** Dispatch a keydown event on the write element */
async function dispatchEnter(page) {
  await page.evaluate(() => {
    const w = document.getElementById('write');
    const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    w.dispatchEvent(e);
  });
}

// ─────────────────────────────────────────────
// Inline code toggle
// ─────────────────────────────────────────────

test.describe('Inline code', () => {
  test('wraps selected text in <code>', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p>Hello world test</p>');
    await selectTextRange(page, '#write p', 6, 11);
    await page.click('#wb-code');
    const html = await getWriteHTML(page);
    expect(html).toContain('<code>world</code>');
  });

  test('toggle off: unwraps <code> instead of nesting', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p>Hello <code>world</code> test</p>');
    await selectAll(page, '#write p code');
    await page.click('#wb-code');
    const html = await getWriteHTML(page);
    expect(html).not.toContain('<code>');
    expect(html).toContain('world');
  });

  test('no selection: inserts empty <code> span to type into', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p>Hello world</p>');
    await placeCursor(page, '#write p', 5);
    await page.click('#wb-code');
    const hasCode = await page.evaluate(() => !!document.querySelector('#write p code'));
    expect(hasCode).toBe(true);
  });

  test('Ctrl+E shortcut wraps selected text', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p>Hello world test</p>');
    await selectTextRange(page, '#write p', 6, 11);
    await page.keyboard.press('Meta+e');
    const html = await getWriteHTML(page);
    expect(html).toContain('<code>world</code>');
  });

  test('Ctrl+E toggle off unwraps', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p>Hello <code>world</code> test</p>');
    await selectAll(page, '#write p code');
    await page.keyboard.press('Meta+e');
    const html = await getWriteHTML(page);
    expect(html).not.toContain('<code>');
  });
});

// ─────────────────────────────────────────────
// Heading toggle
// ─────────────────────────────────────────────

test.describe('Heading toggle', () => {
  for (const level of [1, 2, 3, 4, 5]) {
    test(`H${level} button toggles off when already H${level}`, async ({ page }) => {
      await gotoWriteMode(page);
      await setWriteHTML(page, `<h${level}>My Heading</h${level}>`);
      await placeCursorAtEnd(page, `#write h${level}`);
      await page.click(`#wb-h${level}`);
      const html = await getWriteHTML(page);
      expect(html).not.toContain(`<h${level}>`);
      expect(html).toContain('My Heading');
    });
  }

  test('H2 button converts P to H2', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p>Some text</p>');
    await placeCursorAtEnd(page, '#write p');
    await page.click('#wb-h2');
    const html = await getWriteHTML(page);
    expect(html).toContain('<h2>');
  });

  test('H1 button converts H3 to H1', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<h3>Some text</h3>');
    await placeCursorAtEnd(page, '#write h3');
    await page.click('#wb-h1');
    const html = await getWriteHTML(page);
    expect(html).toContain('<h1>');
    expect(html).not.toContain('<h3>');
  });

  test('Paragraph button converts heading to P', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<h2>Heading</h2>');
    await placeCursorAtEnd(page, '#write h2');
    await page.click('#wb-p');
    const html = await getWriteHTML(page);
    expect(html).not.toContain('<h2>');
  });
});

// ─────────────────────────────────────────────
// Blockquote
// ─────────────────────────────────────────────

test.describe('Blockquote', () => {
  test('toolbar button wraps paragraph in blockquote', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p>Some text</p>');
    await placeCursorAtEnd(page, '#write p');
    await page.click('#wb-bq');
    const html = await getWriteHTML(page);
    expect(html).toContain('<blockquote>');
  });

  test('toolbar button unwraps blockquote', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<blockquote><p>Quote text</p></blockquote>');
    await placeCursorAtEnd(page, '#write blockquote p');
    await page.click('#wb-bq');
    const html = await getWriteHTML(page);
    expect(html).not.toContain('<blockquote>');
    expect(html).toContain('Quote text');
  });

  test('Enter on empty line inside blockquote exits it', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<blockquote><p>Quote text</p><p><br></p></blockquote>');
    // Place cursor in the empty paragraph
    await page.evaluate(() => {
      const emptyP = document.querySelectorAll('#write blockquote p')[1];
      const range = document.createRange();
      range.selectNodeContents(emptyP);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await dispatchEnter(page);
    const inBQ = await cursorIsInside(page, 'BLOCKQUOTE');
    expect(inBQ).toBe(false);
  });

  test('Enter on empty blockquote replaces it with paragraph', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<blockquote><p><br></p></blockquote>');
    await page.evaluate(() => {
      const p = document.querySelector('#write blockquote p');
      const range = document.createRange();
      range.selectNodeContents(p);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await dispatchEnter(page);
    const html = await getWriteHTML(page);
    expect(html).not.toContain('<blockquote>');
  });

  test('blockquote content preserved after exit', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<blockquote><p>Keep this</p><p><br></p></blockquote>');
    await page.evaluate(() => {
      const emptyP = document.querySelectorAll('#write blockquote p')[1];
      const range = document.createRange();
      range.selectNodeContents(emptyP);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await dispatchEnter(page);
    const html = await getWriteHTML(page);
    expect(html).toContain('Keep this');
    expect(html).toContain('<blockquote>');
  });
});

// ─────────────────────────────────────────────
// Code block
// ─────────────────────────────────────────────

test.describe('Code block', () => {
  test('Enter inside code block stays in code block', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<pre><code>line1</code></pre>');
    await placeCursorAtEnd(page, '#write pre code');
    await dispatchEnter(page);
    const inPre = await cursorIsInside(page, 'PRE');
    expect(inPre).toBe(true);
  });

  test('double-empty trailing lines trigger exit via input handler', async ({ page }) => {
    // In a real browser, execCommand('insertLineBreak') inserts <br> elements.
    // N enters = N+1 trailing BRs (extra is browser caret placeholder).
    // The input handler fires during execCommand and checks trailing BRs >= 3.
    await gotoWriteMode(page);
    const result = await page.evaluate(() => {
      const w = document.getElementById('write');
      w.innerHTML = '<pre><code>some code</code></pre>';
      w.focus();
      const pre = w.querySelector('pre');
      const code = pre.querySelector('code');
      // Simulate state after 2 Enters (3 trailing BRs)
      // Set flag BEFORE modifying DOM (matching real handler order)
      window.SDocs._checkCodeBlockExit = pre;
      // Simulate what execCommand('insertLineBreak') x2 produces
      code.innerHTML = 'some code<br><br><br>';
      // Fire input event as execCommand would
      w.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertLineBreak' }));
      return { html: w.innerHTML, hasParagraph: !!w.querySelector('p') };
    });
    expect(result.html).toContain('<pre><code>some code</code></pre>');
    expect(result.hasParagraph).toBe(true);
  });

  test('code block content preserved after exit', async ({ page }) => {
    await gotoWriteMode(page);
    const result = await page.evaluate(() => {
      const w = document.getElementById('write');
      w.innerHTML = '<pre><code>keep this</code></pre>';
      w.focus();
      const pre = w.querySelector('pre');
      const code = pre.querySelector('code');
      window.SDocs._checkCodeBlockExit = pre;
      code.innerHTML = 'keep this<br><br><br>';
      w.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertLineBreak' }));
      return w.innerHTML;
    });
    expect(result).toContain('keep this');
    expect(result).toContain('<p>');
  });

  test('single Enter does NOT trigger exit (only 2 trailing BRs)', async ({ page }) => {
    await gotoWriteMode(page);
    const result = await page.evaluate(() => {
      const w = document.getElementById('write');
      w.innerHTML = '<pre><code>some code</code></pre>';
      w.focus();
      const pre = w.querySelector('pre');
      const code = pre.querySelector('code');
      window.SDocs._checkCodeBlockExit = pre;
      // 1 Enter = 2 trailing BRs (below threshold of 3)
      code.innerHTML = 'some code<br><br>';
      w.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertLineBreak' }));
      return { html: w.innerHTML, hasParagraph: !!w.querySelector('p') };
    });
    expect(result.hasParagraph).toBe(false);
  });

  test('toolbar code block button inserts pre/code', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p>Some text</p>');
    await placeCursorAtEnd(page, '#write p');
    await page.click('#wb-codeblock');
    const html = await getWriteHTML(page);
    expect(html).toContain('<pre><code>');
  });

  test('toolbar code block button toggles off when in code block', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<pre><code>some code</code></pre>');
    await placeCursorAtEnd(page, '#write pre code');
    await page.click('#wb-codeblock');
    const html = await getWriteHTML(page);
    expect(html).not.toContain('<pre>');
    expect(html).toContain('some code');
  });
});

// ─────────────────────────────────────────────
// List behavior
// ─────────────────────────────────────────────

test.describe('Lists', () => {
  test('UL button creates unordered list', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p>Item text</p>');
    await placeCursorAtEnd(page, '#write p');
    await page.click('#wb-ul');
    const html = await getWriteHTML(page);
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>');
  });

  test('OL button creates ordered list', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p>Item text</p>');
    await placeCursorAtEnd(page, '#write p');
    await page.click('#wb-ol');
    const html = await getWriteHTML(page);
    expect(html).toContain('<ol>');
  });

  test('Tab indents list item', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<ul><li>Item 1</li><li>Item 2</li></ul>');
    await placeCursorAtEnd(page, '#write ul li:nth-child(2)');
    // Dispatch Tab keydown
    await page.evaluate(() => {
      const w = document.getElementById('write');
      w.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    const html = await getWriteHTML(page);
    // Item 2 should now be in a nested list
    const hasNestedUl = await page.evaluate(() => !!document.querySelector('#write ul ul'));
    expect(hasNestedUl).toBe(true);
  });

  test('Shift+Tab outdents nested list item', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<ul><li>Item 1<ul><li>Nested</li></ul></li></ul>');
    await placeCursorAtEnd(page, '#write ul ul li');
    await page.evaluate(() => {
      const w = document.getElementById('write');
      w.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    });
    const hasNestedUl = await page.evaluate(() => !!document.querySelector('#write ul ul'));
    expect(hasNestedUl).toBe(false);
  });
});

// ─────────────────────────────────────────────
// Bold / Italic / Strikethrough
// ─────────────────────────────────────────────

test.describe('Inline formatting', () => {
  test('Bold button applies bold', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p>Hello world</p>');
    await selectTextRange(page, '#write p', 6, 11);
    await page.click('#wb-bold');
    const html = await getWriteHTML(page);
    expect(html).toMatch(/<(b|strong)>world<\/(b|strong)>/);
  });

  test('Italic button applies italic', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p>Hello world</p>');
    await selectTextRange(page, '#write p', 6, 11);
    await page.click('#wb-italic');
    const html = await getWriteHTML(page);
    expect(html).toMatch(/<(i|em)>world<\/(i|em)>/);
  });

  test('Strikethrough button applies strikethrough', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p>Hello world</p>');
    await selectTextRange(page, '#write p', 6, 11);
    await page.click('#wb-strike');
    const html = await getWriteHTML(page);
    expect(html).toMatch(/<(s|strike)>world<\/(s|strike)>/);
  });

  test('Clear formatting removes inline styles', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p>Hello <b>world</b> test</p>');
    await selectAll(page, '#write p b');
    await page.click('#wb-clear');
    const html = await getWriteHTML(page);
    expect(html).not.toContain('<b>');
  });
});

// ─────────────────────────────────────────────
// Toolbar active state
// ─────────────────────────────────────────────

test.describe('Toolbar active state', () => {
  test('H2 button shows active when cursor is in H2', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<h2>Heading</h2>');
    await placeCursorAtEnd(page, '#write h2');
    // selectionchange fires async
    await page.waitForTimeout(50);
    const isActive = await page.evaluate(() =>
      document.getElementById('wb-h2').classList.contains('active')
    );
    expect(isActive).toBe(true);
  });

  test('P button shows active when cursor is in P', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p>Paragraph</p>');
    await placeCursorAtEnd(page, '#write p');
    await page.waitForTimeout(50);
    const isActive = await page.evaluate(() =>
      document.getElementById('wb-p').classList.contains('active')
    );
    expect(isActive).toBe(true);
  });

  test('BQ button shows active when cursor is directly in blockquote', async ({ page }) => {
    await gotoWriteMode(page);
    // Place cursor directly in blockquote (not inside a nested <p>)
    await setWriteHTML(page, '<blockquote>Direct quote text</blockquote>');
    await placeCursorAtEnd(page, '#write blockquote');
    await page.waitForTimeout(50);
    const isActive = await page.evaluate(() =>
      document.getElementById('wb-bq').classList.contains('active')
    );
    expect(isActive).toBe(true);
  });
});

// ─────────────────────────────────────────────
// Markdown shortcuts (typing triggers)
// ─────────────────────────────────────────────

test.describe('Markdown shortcuts', () => {
  test('typing "# " converts to H1', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p><br></p>');
    await placeCursorAtEnd(page, '#write p');
    // Type "# Hello" slowly to trigger input events
    await page.keyboard.type('# Hello', { delay: 30 });
    await page.waitForTimeout(100);
    const html = await getWriteHTML(page);
    expect(html).toContain('<h1>');
  });

  test('typing "## " converts to H2', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p><br></p>');
    await placeCursorAtEnd(page, '#write p');
    await page.keyboard.type('## Hello', { delay: 30 });
    await page.waitForTimeout(100);
    const html = await getWriteHTML(page);
    expect(html).toContain('<h2>');
  });

  test('typing "- " converts to bullet list', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p><br></p>');
    await placeCursorAtEnd(page, '#write p');
    await page.keyboard.type('- Item', { delay: 30 });
    await page.waitForTimeout(100);
    const html = await getWriteHTML(page);
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>');
  });

  test('typing "> " converts to blockquote', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p><br></p>');
    await placeCursorAtEnd(page, '#write p');
    await page.keyboard.type('> Quote', { delay: 30 });
    await page.waitForTimeout(100);
    const html = await getWriteHTML(page);
    expect(html).toContain('<blockquote>');
  });

  test('typing "---" converts to horizontal rule', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p><br></p>');
    await placeCursorAtEnd(page, '#write p');
    await page.keyboard.type('---', { delay: 30 });
    await page.waitForTimeout(100);
    const html = await getWriteHTML(page);
    expect(html).toContain('<hr>');
  });
});

// ─────────────────────────────────────────────
// Insert elements
// ─────────────────────────────────────────────

test.describe('Insert elements', () => {
  test('HR button inserts horizontal rule', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p>Before</p>');
    await placeCursorAtEnd(page, '#write p');
    await page.click('#wb-hr');
    const html = await getWriteHTML(page);
    expect(html).toContain('<hr>');
  });
});

// ─────────────────────────────────────────────
// Paste handling
// ─────────────────────────────────────────────

test.describe('Paste', () => {
  test('paste strips HTML and inserts plain text', async ({ page }) => {
    await gotoWriteMode(page);
    await setWriteHTML(page, '<p>Before </p>');
    await placeCursorAtEnd(page, '#write p');
    // Simulate paste with HTML content
    await page.evaluate(() => {
      const w = document.getElementById('write');
      const dt = new DataTransfer();
      dt.setData('text/plain', 'pasted text');
      dt.setData('text/html', '<b>pasted text</b>');
      const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      w.dispatchEvent(event);
    });
    const html = await getWriteHTML(page);
    expect(html).toContain('pasted text');
    expect(html).not.toContain('<b>pasted text</b>');
  });
});
