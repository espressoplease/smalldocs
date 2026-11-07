const { test, expect } = require('@playwright/test');
const BASE = process.env.SDOCS_TEST_BASE_URL || 'http://localhost:3000';

const listSource = '# Delivery plan\n\n7. Confirm the **budget**.\n\n   Keep this second paragraph with the first item.\n\n   - Hosting\n   - Research\n\n8. Name the reviewer.\n\n   > Check the delivery date.\n\n9. Send the report.\n\n- First bullet\n\n  A paragraph inside this bullet.\n\n  3. Nested ordered item\n  4. Another nested item\n\n- Last bullet\n';
const richSource = listSource + '\n| Service | Region | Owner |\n| :--- | :---: | ---: |\n| API | Europe | Platform |\n| Importer | America | Research |\n\n~~~mermaid\nflowchart LR\nDraft[Draft] --> Review[Review]\n~~~\n\n```chart\n{"type":"bar","labels":["Hosting","Research"],"values":[100,200]}\n```\n\n```cells\nItem,Amount\nHosting,100\nResearch,200\nTotal,=SUM(B2:B3)\n```\n\n~~~slide\ngrid 100 56.25 bg=#ffffff\nr 5 5 90 40 | Delivery readiness\n~~~\n\nA formula $x^2 + y^2$ stays intact.\n\n$$\nx + y = z\n$$\n';

async function load(page, source) {
  await page.goto(BASE + '/docs');
  await page.waitForFunction(() => window.SDocs?._appReady);
  await page.evaluate(source => { SDocs.loadText(source); SDocs.setAllSectionsOpen(true); SDocs.setMode('read'); }, source);
  return page.evaluate(() => SDocs.currentBody);
}
async function write(page) { await page.locator('#_sd_btn-write').click(); await expect(page.locator('#_sd_write')).toBeVisible(); }
async function read(page) { await page.locator('#_sd_btn-read').click(); await expect(page.locator('#_sd_rendered')).toBeVisible(); }
async function caret(page, selector, offset) {
  await page.locator(selector).evaluate((el, offset) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text = walker.nextNode();
    while (text && offset > text.textContent.length) { offset -= text.textContent.length; text = walker.nextNode(); }
    const range = document.createRange(); range.setStart(text || el, text ? offset : 0); range.collapse(true);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.getElementById('_sd_write').focus();
  }, offset);
}

test('entering and leaving edit mode without changes preserves the complete source', async ({ page }) => {
  const original = await load(page, richSource);
  for (let i = 0; i < 3; i++) { await write(page); await page.waitForTimeout(100); await read(page); }
  expect(await page.evaluate(() => SDocs.currentBody)).toBe(original);
});

test('editing one table cell preserves other blocks and restores every rich renderer', async ({ page }) => {
  await load(page, richSource); await write(page);
  await caret(page, '#_sd_write table tbody tr:first-child td:first-child', 3);
  await page.keyboard.insertText(' gateway'); await read(page);
  await expect(page.locator('#_sd_rendered table tbody tr:first-child td:first-child')).toHaveText('API gateway');
  await expect(page.locator('#_sd_rendered .sdoc-mermaid-stage > svg')).toBeVisible();
  await expect(page.locator('#_sd_rendered .sdoc-chart canvas')).toBeVisible();
  await expect(page.locator('#_sd_rendered .sdoc-cells-grid')).toBeVisible();
  await expect(page.locator('#_sd_rendered .sdoc-slide')).toBeVisible();
  const body = await page.evaluate(() => SDocs.currentBody);
  expect(body).toContain(listSource.trim());
  expect(body).toContain('~~~mermaid\nflowchart LR\nDraft[Draft] --> Review[Review]\n~~~');
  await expect(page.locator('#_sd_rendered table th').nth(1)).toHaveCSS('text-align', 'center');
  await expect(page.locator('#_sd_rendered table th').nth(2)).toHaveCSS('text-align', 'right');
});

test('a small edit preserves ordered starts, item paragraphs, quotes and nested list order', async ({ page }) => {
  await load(page, listSource); await write(page);
  await caret(page, '#_sd_write > ol > li:nth-child(2) > p', 0);
  await page.keyboard.insertText('Please '); await read(page);
  await expect(page.locator('#_sd_rendered > ol')).toHaveAttribute('start', '7');
  await expect(page.locator('#_sd_rendered > ol > li:first-child > p')).toHaveCount(2);
  await expect(page.locator('#_sd_rendered > ol > li:first-child > ul > li')).toHaveText(['Hosting', 'Research']);
  await expect(page.locator('#_sd_rendered > ol > li:nth-child(2) > blockquote')).toContainText('Check the delivery date.');
  await expect(page.locator('#_sd_rendered > ul > li:first-child > ol')).toHaveAttribute('start', '3');
  await expect(page.locator('#_sd_rendered > ol > li:nth-child(2)')).toContainText('Please Name the reviewer.');
});

test('literal markdown punctuation, links, inline code and hard breaks survive another paragraph edit', async ({ page }) => {
  const source = '# Text\n\nLiteral \\*stars\\*, \\[brackets\\], a \\# heading and a backslash \\\\.\n\nUse ``a`b`` and [the guide](https://example.com/guide "Guide").  \nA hard break.\n\nEdit here.\n';
  const original = await load(page, source); await write(page);
  await caret(page, '#_sd_write > p:last-child', 9); await page.keyboard.insertText(' now'); await read(page);
  expect(await page.evaluate(() => SDocs.currentBody)).toBe(original.replace('Edit here.', 'Edit here now.'));
});

test('pending editor timers cannot replace another document after leaving edit mode', async ({ page }) => {
  await load(page, '# First\n\nFirst text.'); await write(page);
  await caret(page, '#_sd_write p', 5); await page.keyboard.insertText(' changed'); await read(page);
  await page.evaluate(() => SDocs.loadText('# Second\n\nSecond text.'));
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => SDocs.currentBody)).toBe('# Second\n\nSecond text.');
});


async function select(page, selector) {
  await page.locator(selector).evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(range); document.getElementById('_sd_write').focus(); });
}

for (const marker of ['7.', '-']) {
  test('Enter splits a ' + marker + ' list item without losing the following items', async ({ page }) => {
    await load(page, marker + ' First item\n' + (marker === '-' ? '-' : '8.') + ' Last item\n'); await write(page);
    await caret(page, '#_sd_write li:first-child', 5); await page.keyboard.press('Enter'); await page.keyboard.insertText('New '); await read(page);
    await expect(page.locator('#_sd_rendered li')).toHaveText(['First', 'New  item', 'Last item']);
    if (marker === '7.') await expect(page.locator('#_sd_rendered ol')).toHaveAttribute('start', '7');
  });
}

test('Tab and Shift+Tab work inside a loose list paragraph', async ({ page }) => {
  await load(page, '- First\n\n- Second\n\n  Details.\n\n- Last\n'); await write(page);
  await caret(page, '#_sd_write > ul > li:nth-child(2) > p:first-child', 3); await page.keyboard.press('Tab'); await read(page);
  await expect(page.locator('#_sd_rendered ul ul li')).toContainText(['Second']);
  await write(page); await caret(page, '#_sd_write ul ul li p:first-child', 3); await page.keyboard.press('Shift+Tab'); await read(page);
  await expect(page.locator('#_sd_rendered > ul > li')).toHaveCount(3);
  await expect(page.locator('#_sd_rendered')).toContainText('Details.');
});

test('Backspace joins paragraphs, Undo restores them and Redo repeats the join', async ({ page }) => {
  await load(page, '# Text\n\nFirst.\n\nSecond.\n'); await write(page);
  await caret(page, '#_sd_write p:last-child', 0); await page.keyboard.press('Backspace');
  await expect(page.locator('#_sd_write > p')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z'); await expect(page.locator('#_sd_write > p')).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+Shift+z'); await read(page);
  await expect(page.locator('#_sd_rendered > p')).toHaveText(['First.Second.']);
});

test('task checkboxes are editable and do not turn their parent into a task', async ({ page }) => {
  await load(page, '- Parent\n  - [ ] Child\n  - [x] Complete\n\n- Other\n'); await write(page);
  await page.locator('#_sd_write input[type=checkbox]').first().check(); await read(page);
  await expect(page.locator('#_sd_rendered > ul > li:first-child > input')).toHaveCount(0);
  await expect(page.locator('#_sd_rendered input[type=checkbox]')).toHaveCount(2);
  await expect(page.locator('#_sd_rendered input[type=checkbox]').first()).toBeChecked();
});

test('editing a zero-based ordered list preserves its start', async ({ page }) => {
  await load(page, '0. Zero\n1. One\n'); await write(page);
  await caret(page, '#_sd_write li:first-child', 4); await page.keyboard.insertText('!'); await read(page);
  await expect(page.locator('#_sd_rendered ol')).toHaveAttribute('start', '0');
});

test('editing literal punctuation in the same paragraph does not create formatting', async ({ page }) => {
  await load(page, '# Text\n\nLiteral \\*stars\\*, \\[brackets\\], a backslash \\\\, ``a`b`` and [guide](https://example.com/a_(b) "A guide").\n'); await write(page);
  await caret(page, '#_sd_write p', 0); await page.keyboard.insertText('Updated '); await read(page);
  await expect(page.locator('#_sd_rendered p')).toHaveText('Updated Literal *stars*, [brackets], a backslash \\, a`b and guide.');
  await expect(page.locator('#_sd_rendered em')).toHaveCount(0);
  await expect(page.locator('#_sd_rendered p a')).toHaveAttribute('href', 'https://example.com/a_(b)');
  await expect(page.locator('#_sd_rendered p a')).toHaveAttribute('title', 'A guide');
  await expect(page.locator('#_sd_rendered code')).toHaveText('a`b');
});

test('reference links, CRLF, tabs and repeated paragraphs survive an edit in another block', async ({ page }) => {
  const source = '# Guide\r\n\r\n[Guide][ref]\r\n\r\n[ref]: https://example.com "Reference"\r\n\r\nSame paragraph.\r\n\r\nSame paragraph.\r\n\r\n\tconst x = 1;\r\n\r\nEnd.\r\n';
  const original = await load(page, source); await write(page);
  await caret(page, '#_sd_write p:last-child', 3); await page.keyboard.insertText(' now'); await read(page);
  expect(await page.evaluate(() => SDocs.currentBody)).toBe(original.replace('End.', 'End now.'));
  await expect(page.locator('#_sd_rendered p a')).toHaveAttribute('title', 'Reference');
});

test('deleting a block beside a reference definition retains the linked target', async ({ page }) => {
  await load(page, '# Guide\n\n[Guide][ref]\n\n[ref]: https://example.com\n\nDelete this.\n\nKeep this.\n'); await write(page);
  await select(page, '#_sd_write > p:nth-of-type(2)'); await page.keyboard.press('Backspace'); await read(page);
  await expect(page.locator('#_sd_rendered p a')).toHaveAttribute('href', 'https://example.com');
  await expect(page.locator('#_sd_rendered')).toContainText('Keep this.');
});

test('nested code fences retain their full language info and internal blank lines after a list edit', async ({ page }) => {
  await load(page, '- Before\n\n  ~~~~js title="Example"\n  const x = 1;\n\n\n  const y = `value`;\n  ~~~~\n\n- After\n'); await write(page);
  await caret(page, '#_sd_write li:first-child > p', 6); await page.keyboard.insertText('!'); await read(page);
  expect(await page.evaluate(() => SDocs.currentBody)).toContain('~~~~js title="Example"');
  await expect(page.locator('#_sd_rendered pre code')).toHaveText('const x = 1;\n\n\nconst y = `value`;\n');
});

test('table edits retain literal pipes, inline formatting, newlines and column alignment', async ({ page }) => {
  await load(page, '| Name | Detail |\n| :--- | ---: |\n| API | **Bold**, `a\\|b`<br>Second |\n'); await write(page);
  await caret(page, '#_sd_write td:last-child', 0); await page.keyboard.insertText('Use '); await read(page);
  await expect(page.locator('#_sd_rendered tbody tr')).toHaveCount(1);
  await expect(page.locator('#_sd_rendered td')).toHaveCount(2);
  await expect(page.locator('#_sd_rendered td strong')).toHaveText('Use Bold');
  await expect(page.locator('#_sd_rendered td code')).toHaveText('a|b');
  await expect(page.locator('#_sd_rendered td br')).toHaveCount(1);
});

test('replacing the active document cancels pending edits and replaces the visible editor', async ({ page }) => {
  await load(page, '# First\n\nFirst text.'); await write(page);
  await caret(page, '#_sd_write p', 5); await page.keyboard.insertText(' changed');
  await page.evaluate(() => SDocs.loadText('# Second\n\nSecond text.'));
  await expect(page.locator('#_sd_write')).toContainText('Second text.'); await page.waitForTimeout(650); await read(page);
  expect(await page.evaluate(() => SDocs.currentBody)).toBe('# Second\n\nSecond text.');
});

test('reselecting write mode and toggling the theme retain unsaved typing and caret', async ({ page }) => {
  await load(page, '# Guide\n\nKeep typing.'); await write(page);
  await caret(page, '#_sd_write p', 4); await page.keyboard.insertText(' one');
  await page.evaluate(() => { SDocs.setMode('write'); document.getElementById('_sd_btn-theme').click(); });
  await page.keyboard.insertText(' two'); await read(page);
  await expect(page.locator('#_sd_rendered p')).toHaveText('Keep one two typing.');
});

test('blockquote toggle retains the caret, saves without another keystroke and supports Undo', async ({ page }) => {
  await load(page, '# Guide\n\n> Quote.\n'); await write(page);
  await caret(page, '#_sd_write blockquote p', 6); await page.locator('#_sd_wb-bq').click();
  await page.keyboard.insertText(' More.');
  await expect(page.locator('#_sd_write > p')).toHaveText('Quote. More.');
  await page.keyboard.press('ControlOrMeta+z'); await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#_sd_write blockquote')).toContainText('Quote.');
});

test('inline-code toolbar formatting autosaves without typing and supports Undo', async ({ page }) => {
  await load(page, '# Guide\n\nHello world.\n'); await write(page);
  await select(page, '#_sd_write p'); await page.locator('#_sd_wb-code').click();
  await expect.poll(() => page.evaluate(() => SDocs.currentBody)).toContain('`Hello world.`');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#_sd_write p code')).toHaveCount(0); await read(page);
  await expect(page.locator('#_sd_rendered p')).toHaveText('Hello world.');
});

const fs = require('fs'), path = require('path');
test('the delivery example keeps both Mermaid diagrams, workbook formulas and slides after a table edit', async ({ page }) => {
  const source = fs.readFileSync(path.join(__dirname, 'fixtures/comment-rich-elements.md'), 'utf8');
  await load(page, source); await write(page); await caret(page, '#_sd_write tbody tr:first-child td:first-child', 3);
  await page.keyboard.insertText(' updated'); await read(page);
  await expect(page.locator('.sdoc-mermaid-stage > svg')).toHaveCount(2);
  await expect(page.locator('.sdoc-cells-grid')).not.toHaveCount(0);
  await expect(page.locator('.sdoc-slide')).toHaveCount(2);
  expect(await page.evaluate(() => SDocs.currentBody)).toContain('=Budget!B5');
  expect(await page.evaluate(() => SDocs.currentBody)).toContain('sequenceDiagram');
});

test('code editing retains line breaks, blank lines and backticks when saved', async ({ page }) => {
  await load(page, '````js\nconst x = 1;\n\n\nconst y = `yes`;\n````\n'); await write(page);
  await caret(page, '#_sd_write pre code', 12); await page.keyboard.press('Enter'); await page.keyboard.insertText('const z = 2;'); await read(page);
  await expect(page.locator('#_sd_rendered pre code')).toHaveText('const x = 1;\nconst z = 2;\n\n\nconst y = `yes`;\n');
});

test('a partial selection converted to a code block keeps text on both sides and can undo', async ({ page }) => {
  await load(page, 'Before sample after.\n'); await write(page);
  await page.locator('#_sd_write p').evaluate(el => { const r=document.createRange();r.setStart(el.firstChild,7);r.setEnd(el.firstChild,13);const s=getSelection();s.removeAllRanges();s.addRange(r); });
  await page.locator('#_sd_wb-codeblock').click();
  await expect(page.locator('#_sd_write')).toContainText('Before '); await expect(page.locator('#_sd_write')).toContainText(' after.');
  await expect(page.locator('#_sd_write pre code')).toContainText('sample');
  await page.keyboard.press('ControlOrMeta+z'); await read(page);
  await expect(page.locator('#_sd_rendered p')).toHaveText('Before sample after.');
});

test('task changes and list indent can be undone and redone', async ({ page }) => {
  await load(page, '- [ ] First\n- [ ] Second\n'); await write(page);
  await page.locator('#_sd_write input').first().check(); await caret(page, '#_sd_write li:first-child', 0);
  await page.keyboard.press('ControlOrMeta+z'); await expect(page.locator('#_sd_write input').first()).not.toBeChecked();
  await page.keyboard.press('ControlOrMeta+Shift+z'); await expect(page.locator('#_sd_write input').first()).toBeChecked();
  await caret(page, '#_sd_write li:last-child', 3); await page.keyboard.press('Tab');
  await expect(page.locator('#_sd_write ul ul')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z'); await expect(page.locator('#_sd_write ul ul')).toHaveCount(0);
  await read(page); await expect(page.locator('#_sd_rendered input')).toHaveCount(2);
});

test('undo history cannot bring back the previous document', async ({ page }) => {
  await load(page, 'First document.'); await write(page); await caret(page, '#_sd_write p', 5); await page.keyboard.insertText(' edited');
  await page.evaluate(() => SDocs.loadText('Second document.'));
  await page.keyboard.press('ControlOrMeta+z'); await read(page);
  await expect(page.locator('#_sd_rendered p')).toHaveText('Second document.');
});

test('HTML blocks, footnote definitions and comment metadata survive an unrelated edit', async ({ page }) => {
  const source = '---\ncomments: [{"id":"c1","kind":"inline","quote":"Keep","text":"Keep this note.","author":"Ana"}]\n---\n\n# Guide\n\n<div><details><summary>More</summary>Raw HTML content.</details></div>\n\nA reference[^note].\n\n[^note]: Footnote content.\n\nKeep this paragraph.\n\nEdit here.\n';
  const original = await load(page, source); const meta = await page.evaluate(() => structuredClone(SDocs.currentMeta.comments));
  await write(page); await caret(page, '#_sd_write p:last-child', 4); await page.keyboard.insertText(' now'); await read(page);
  expect(await page.evaluate(() => SDocs.currentBody)).toBe(original.replace('Edit here.', 'Edit now here.'));
  expect(await page.evaluate(() => SDocs.currentMeta.comments)).toEqual(meta);
});

test('composition text does not trigger markdown conversion or enter shortcuts mid-composition', async ({ page }) => {
  await load(page, 'Start.'); await write(page);
  await page.locator('#_sd_write').evaluate(w => { w.innerHTML='<p>- composing</p>'; const p=w.firstChild;const r=document.createRange();r.selectNodeContents(p);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r); w.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',isComposing:true})); });
  await expect(page.locator('#_sd_write > ul')).toHaveCount(0);
  await read(page); await expect(page.locator('#_sd_rendered p')).toHaveText('- composing');
});

test('mobile edit mode keeps table text, nested lists and the read-mode renderers', async ({ page }) => {
  await page.setViewportSize({width:390,height:844}); await load(page, richSource); await write(page);
  await caret(page, '#_sd_write > ol > li:last-child > p', 0); await page.keyboard.insertText('Please '); await read(page);
  await expect(page.locator('#_sd_rendered > ol > li:last-child')).toContainText('Please Send the report.');
  await expect(page.locator('.sdoc-mermaid-stage > svg')).toBeVisible();
  await expect(page.locator('.sdoc-slide')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('formatting with leading or trailing spaces retains its visible meaning after editing', async ({ page }) => {
  await load(page, 'Some **bold** and *italic*.\n'); await write(page);
  await caret(page, '#_sd_write strong', 4); await page.keyboard.insertText(' '); await read(page);
  await expect(page.locator('#_sd_rendered strong')).toHaveText('bold');
  await expect(page.locator('#_sd_rendered em')).toHaveText('italic');
});

test('images keep their alt text, URL and title during a nearby edit in the same paragraph', async ({ page }) => {
  await load(page, 'Before ![a \\[label\\]](https://example.com/image_(1).png "Image title") after.\n'); await write(page);
  await caret(page, '#_sd_write p', 0); await page.keyboard.insertText('Updated '); await read(page);
  await expect(page.locator('#_sd_rendered img')).toHaveAttribute('src', 'https://example.com/image_(1).png');
  await expect(page.locator('#_sd_rendered img')).toHaveAttribute('alt', 'a [label]');
  await expect(page.locator('#_sd_rendered img')).toHaveAttribute('title', 'Image title');
});

for (const [name, source] of [
  ['nested mixed lists', '3. First\n   - Nested **bold**\n     8. Deep one\n     9. Deep two\n4. Last\n'],
  ['list paragraphs and code', '- First\n\n  A paragraph.\n\n  ```js\n  const x = 1;\n  ```\n\n  > Quote\n\n- Last\n'],
  ['ordered starts beyond nine', '19. First\n\n    Another paragraph.\n\n    - Nested\n\n20. Last\n'],
  ['task list siblings', '- [x] First\n  - [ ] Nested\n- [ ] Last\n'],
]) {
  test(name + ' keep their structure through repeated edits and mode switches', async ({ page }) => {
    await load(page, source);
    const expected = await page.locator('#_sd_rendered').evaluate(root => {
      function tree(el) { return [el.tagName, el.getAttribute('start'), el.type === 'checkbox' ? el.checked : null, Array.from(el.children).filter(e => e.matches('p,ol,ul,li,pre,code,blockquote,input,strong')).map(tree)]; }
      return Array.from(root.children).map(tree);
    });
    for (let i=0;i<3;i++) { await write(page); await caret(page, '#_sd_write > :first-child > li:first-child', name === 'task list siblings' ? 1 : 0); await page.keyboard.insertText('X'); await read(page); }
    expect(await page.locator('#_sd_rendered').evaluate(root => {
      function tree(el) { return [el.tagName, el.getAttribute('start'), el.type === 'checkbox' ? el.checked : null, Array.from(el.children).filter(e => e.matches('p,ol,ul,li,pre,code,blockquote,input,strong')).map(tree)]; }
      return Array.from(root.children).map(tree);
    })).toEqual(expected);
    await expect(page.locator('#_sd_rendered')).toContainText('XXXFirst');
  });
}
