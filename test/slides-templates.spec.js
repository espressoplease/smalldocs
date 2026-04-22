// @ts-check
// Playwright tests for slide templates (@template / @extends).
// Covers: template slides don't render, consumers pick up slot content,
// partial fills retain the template's placeholder, unknown template
// surfaces an error badge.
const { test, expect } = require('@playwright/test');

async function renderBody(page, body) {
  await page.goto('/');
  await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function', null, { timeout: 5000 });
  await page.evaluate((b) => {
    const parsed = window.SDocYaml.parseFrontMatter(b);
    window.SDocs.currentMeta = parsed.meta;
    window.SDocs.currentBody = parsed.body;
    if (parsed.meta.styles) window.SDocs.applyStylesFromMeta(parsed.meta.styles);
    window.SDocs.render();
  }, body);
  await page.waitForTimeout(200);
}

function deck(blocks) {
  return '# Deck\n\n' + blocks.map((b) => '~~~slide\n' + b + '\n~~~').join('\n\n') + '\n';
}

test.describe('Slide templates', () => {
  test('template slide does not render; consumers do', async ({ page }) => {
    await renderBody(page, deck([
      '@template hero\ngrid 16 9\nr 0 0 16 4 #title fill=#1e40af color=#fff | placeholder',
      '@extends hero\n#title: First',
      '@extends hero\n#title: Second',
    ]));
    const slides = await page.$$('.sdoc-slide');
    expect(slides.length).toBe(2);
  });

  test('consumer content replaces template placeholder in the matching shape', async ({ page }) => {
    await renderBody(page, deck([
      '@template hero\ngrid 16 9\nr 0 0 16 4 #title fill=#1e40af color=#fff | placeholder title',
      '@extends hero\n#title: Hello world',
    ]));
    const text = await page.evaluate(() => {
      const host = document.querySelector('.sdoc-slide .shape-md');
      return host && host.shadowRoot ? host.shadowRoot.textContent.trim() : '';
    });
    expect(text).toContain('Hello world');
    expect(text).not.toContain('placeholder title');
  });

  test('multi-line slot content renders as markdown list', async ({ page }) => {
    await renderBody(page, deck([
      '@template layout\ngrid 16 9\nr 0 0 16 9 #body align=left valign=top | placeholder',
      '@extends layout\n#body:\n- one\n- two\n- three',
    ]));
    // The shape-md host uses shadow DOM, so query through it.
    const items = await page.evaluate(() => {
      const host = document.querySelector('.sdoc-slide .shape-md');
      if (!host || !host.shadowRoot) return null;
      return Array.from(host.shadowRoot.querySelectorAll('li')).map((li) => li.textContent.trim());
    });
    expect(items).toEqual(['one', 'two', 'three']);
  });

  test('partial fill retains template placeholder for unset slots', async ({ page }) => {
    await renderBody(page, deck([
      '@template layout\ngrid 16 9\nr 0 0 16 3 #title | placeholder title\nr 0 3 16 6 #body | placeholder body',
      '@extends layout\n#title: Just the title',
    ]));
    const text = await page.evaluate(() => {
      const hosts = document.querySelectorAll('.sdoc-slide .shape-md');
      return Array.from(hosts)
        .map((h) => (h.shadowRoot ? h.shadowRoot.textContent.trim() : ''))
        .join(' | ');
    });
    expect(text).toContain('Just the title');
    expect(text).toContain('placeholder body');
  });

  test('unknown template surfaces an error badge', async ({ page }) => {
    await renderBody(page, deck(['@extends ghost\n#title: Hi']));
    const badge = await page.$('.sdoc-slide-errbadge');
    expect(badge).not.toBeNull();
    const txt = await badge.textContent();
    expect(txt).toContain('unknown template');
  });
});
