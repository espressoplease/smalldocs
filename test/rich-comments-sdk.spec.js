const { test, expect } = require('@playwright/test');
test('SDK sheets and diagrams keep their own controls when the host has comment mode', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/docs'); await page.waitForFunction(() => window.SDocs?._appReady);
  await page.evaluate(async () => {
    SDocs.loadText('# Host document\n\nA paragraph.'); SDocs.setMode('comment');
    const target = document.createElement('div'); target.id = 'sdk-comment-isolation'; document.body.appendChild(target);
    const { render } = await import('/sdk/0.3.1/smalldocs.js');
    window.richSdkView = await render(target, '```cells\nItem,Amount\nHosting,100\n```\n\n```mermaid\nflowchart LR\nA --> B\n```');
  });
  const target = page.locator('#sdk-comment-isolation');
  await expect(target.locator('.sdoc-cells-grid')).toBeVisible();
  await expect(target.locator('.sdoc-mermaid svg.sdoc-mermaid-svg')).toBeVisible();
  await expect(target.locator('.sdoc-cells-comment-add, .sdoc-diagram-add, .sdoc-gutter-add')).toHaveCount(0);
  await target.getByRole('button', { name: 'Open fullscreen', exact: true }).click();
  await expect(page.locator('.sdoc-cells-focus')).toBeVisible();
  await expect(page.locator('.sdoc-cells-focus .sdoc-cells-comment-add')).toHaveCount(0);
  await page.locator('.sdoc-cells-focus-close').click();
  await target.getByRole('button', { name: 'Open diagram in fullscreen', exact: true }).click();
  await expect(page.locator('.sdoc-mermaid-focus')).toBeVisible();
  await expect(page.locator('.sdoc-mermaid-focus .sdoc-diagram-add')).toHaveCount(0);
  await page.locator('.sdoc-mermaid-focus-close').click();
  await page.evaluate(() => window.richSdkView.destroy());
  await expect(target.locator('.sdoc-cells-grid, .sdoc-mermaid')).toHaveCount(0);
  expect(errors).toEqual([]);
});
