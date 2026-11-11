const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

const topics = {
  'Getting started': 'Make a getting-started document',
  'Libraries and tags': 'default library on this computer',
  Search: 'sdoc cloud search --help',
  Diagrams: 'sdoc diagrams',
  Slides: 'sdoc slides verify FILE.md --json',
  Spreadsheets: 'sdoc cells verify FILE.md --json',
  Charts: 'sdoc charts',
  Comments: 'sdoc cloud comments --help',
  'Editing and history': 'sdoc cloud edit --help',
  'Code files': 'sdoc code',
  'Interactive tools': 'sdoc apps',
  'Teams and billing': 'sdoc cloud billing --help',
};

for (const width of [1440, 390]) {
  test('Learn copies feature demos without navigating on every sidebar at ' + width, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    for (const pathname of ['/docs', '/public/library/library.html?demo=1', '/public/cloud-admin.html']) {
      await page.goto(pathname);
      if (width === 390) await page.getByRole('button', {
        name: pathname === '/docs' ? 'Open SmallDocs menu' : 'Open menu', exact: true,
      }).click();
      await page.getByRole('button', { name: 'Learn', exact: true }).click();
      const panel = page.locator('[data-learn-panel]');
      await expect(panel).toContainText('Choose a feature to copy its prompt.');
      await expect(panel.getByRole('link', { name: 'Open homepage', exact: true })).toHaveAttribute('href', '/home');
      const before = page.url();
      for (const [label, instruction] of Object.entries(topics)) {
        const button = panel.getByRole('button', { name: label, exact: true });
        await button.click();
        await expect(panel.getByRole('status')).toHaveText(label + ' prompt copied. Paste it into your agent for an explanation and a demo.');
        const prompt = await page.evaluate(() => navigator.clipboard.readText());
        expect(prompt).toContain(new URL(before).origin + '/cloud/admin?panel=install');
        expect(prompt).toContain(instruction);
        expect(prompt).toContain('new tagged Cloud document');
        expect(prompt).toContain('return its Cloud URL');
        expect(prompt).not.toContain('cloud-staging.smalldocs.org');
        await expect(button).toHaveAttribute('title', 'Copied. Paste this prompt into your agent.');
        await expect(page).toHaveURL(before);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (pathname === '/docs') {
        await panel.getByRole('button', { name: 'Diagrams', exact: true }).click();
        await panel.evaluate(element => element.scrollIntoView({ block: 'start' }));
        await page.screenshot({ path: testInfo.outputPath('learn-' + width + '.png') });
      }
    }
  });
}

test('Learn provides the selected prompt when clipboard access is denied and recovers on a later copy', async ({ page }) => {
  await page.goto('/docs');
  await page.getByRole('button', { name: 'Learn', exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async () => { throw new Error('Permission denied'); } } });
  });
  const panel = page.locator('[data-learn-panel]');
  await panel.getByRole('button', { name: 'Comments', exact: true }).click();
  const fallback = panel.getByRole('textbox', { name: 'Prompt to copy' });
  await expect(fallback).toBeVisible();
  await expect(fallback).toBeFocused();
  await expect(fallback).toHaveValue(/sdoc cloud comments --help/);
  expect(await fallback.evaluate(el => el.selectionEnd - el.selectionStart)).toBe((await fallback.inputValue()).length);
  await expect(panel.getByRole('status')).toContainText('Copy the selected prompt');
  await expect(panel.getByRole('status')).not.toContainText('prompt copied');
  await page.evaluate(() => { navigator.clipboard.writeText = async text => { window.copiedLearnPrompt = text; }; });
  await panel.getByRole('button', { name: 'Charts', exact: true }).click();
  await expect(fallback).toBeHidden();
  expect(await page.evaluate(() => window.copiedLearnPrompt)).toContain('sdoc charts');
  await expect(panel.getByRole('status')).toContainText('Charts prompt copied');
});

test('Learn prompt buttons work from the keyboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/docs');
  const learn = page.getByRole('button', { name: 'Learn', exact: true });
  await learn.focus();
  await page.keyboard.press('Enter');
  const first = page.getByRole('button', { name: 'Getting started', exact: true });
  await expect(first).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Open homepage', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-learn-status]')).toContainText('Getting started prompt copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Make a getting-started document');
});
