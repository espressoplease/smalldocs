const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

for (const width of [390, 1440]) {
  for (const windows of [false, true]) {
    test('signup stays primary and optional installation copies exact commands at ' + width + (windows ? ' on Windows' : ''), async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(win => {
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copiedText = text; } } });
        Object.defineProperty(navigator, 'userAgentData', { value: { platform: win ? 'Windows' : 'macOS' } });
      }, windows);
      const authRequests = [];
      page.on('request', request => { if (request.url().includes('/api/cloud/auth/')) authRequests.push(request.url()); });
      await page.goto('/home-next');
      await expect(page.locator('.homepage-google')).toHaveCount(3);
      await expect(page.locator('[data-install-form]')).toHaveCount(3);
      for (const area of await page.locator('.homepage-start').all()) {
        await expect(area.locator('.homepage-google')).toBeVisible();
        await expect(area.locator('[data-install-form]')).toBeVisible();
        await expect(area.locator('[data-home-cli]')).not.toBeVisible();
        const direct = area.getByText('Install directly', { exact: true });
        const signupSize = await area.locator('.homepage-google').boundingBox();
        const directSize = await direct.boundingBox();
        expect(directSize.width).toBeCloseTo(signupSize.width, 0);
        expect(directSize.height).toBeCloseTo(signupSize.height, 0);
        await direct.click();
        const framing = await area.locator('.homepage-direct-panel').evaluate(panel => {
          const reference = getComputedStyle(document.querySelector('#learn .install-panel'));
          const style = getComputedStyle(panel);
          return [style.backgroundColor === reference.backgroundColor, style.padding === reference.padding];
        });
        expect(framing).toEqual([true, true]);
        const card = area.locator('[data-home-install]');
        await card.getByText('Install yourself', { exact: true }).click();
        const cli = await card.locator('[data-home-cli]').textContent();
        expect(cli).toBe(windows ? 'npm i -g sdocs-dev' : 'curl -fsSL https://smalldocs.org/install | sh');
        await card.getByRole('button', { name: 'Copy CLI command', exact: true }).click();
        expect(await page.evaluate(() => window.copiedText)).toBe(cli);
        await expect(card.locator('[data-install-copy="cli"] path[d="m20 6-11 11-5-5"]')).toHaveCount(1);
        const skill = await card.locator('[data-home-skill]').textContent();
        expect(skill).toContain('/agent-skills/cloud --global --yes');
        await card.getByRole('button', { name: 'Copy skill command', exact: true }).click();
        expect(await page.evaluate(() => window.copiedText)).toBe(skill);

        await card.getByRole('button', { name: 'Copy setup prompt', exact: true }).click();
        const prompt = await card.locator('[data-home-prompt]').textContent();
        expect(await page.evaluate(() => window.copiedText)).toBe(prompt);
        expect(prompt).toContain('/public/getting-started.md');
        expect(prompt).toContain('meaningful tags');
        expect(prompt.indexOf('npx --yes')).toBeLessThan(prompt.indexOf('sdoc cloud login'));
        await expect(card.locator('[data-install-copy-status]')).toContainText('Paste it into your coding agent');
        await expect(card.locator('[data-install-copy="prompt"]')).toHaveAccessibleName('Copied');
        await expect(card.locator('[data-install-copy="prompt"]')).toHaveAccessibleName('Copy setup prompt');
      }
      expect(authRequests).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}

test('clipboard failure keeps selectable prompt text and does not show a success tick', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } } }));
  await page.goto('/home-next');
  await page.getByText('Install directly', { exact: true }).first().click();
  const card = page.locator('[data-home-install]').first();

  await card.getByRole('button', { name: 'Copy setup prompt', exact: true }).click();
  await expect(card.locator('[data-install-copy-status]')).toContainText('Select the text and copy it');
  await expect(card.locator('[data-home-prompt]')).toBeVisible();
  await expect(card.locator('.done')).toHaveCount(0);
});

test('commands remain readable when JavaScript is unavailable', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage(); await page.goto('http://localhost:3000/home-next');
    await expect(page.locator('[data-home-cli]')).toHaveCount(3);
    await page.getByText('Install directly', { exact: true }).first().click();
    await page.getByText('Install yourself', { exact: true }).first().click();
    await expect(page.locator('[data-home-cli]').first()).toBeVisible();
    await expect(page.locator('[data-home-cli]').first()).toContainText('curl -fsSL');
    await expect(page.locator('[data-home-skill]').first()).toContainText('/agent-skills/cloud');
  } finally { await context.close(); }
});
