// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

/**
 * Cells workbook groups (Stage A: isolation).
 *
 * A ```cells fence can name a workbook: ```cells alpha/Data. Blocks that share
 * a workbook id form one independent tabbed workbook. With `cells-tabs: tabbed`
 * two workbooks on a page must render two separate tab strips, switch
 * independently, resolve same-named sheets to their OWN data, and - in the
 * fullscreen overlay - show only their own workbook's tabs. The node + CLI
 * tests pin the resolution; these pin the browser behaviour that only the DOM
 * can show.
 */

// Built from an array so the ```cells fences don't clash with JS backticks.
const DOC = [
  '---',
  'cells-tabs: tabbed',
  '---',
  '',
  '# Workbook groups',
  '',
  '```cells alpha/Data',
  'Metric,Value',
  'A,10',
  '```',
  '',
  '```cells alpha/Secret',
  'S,42',
  '```',
  '',
  '```cells beta/Data',
  'Metric,Value',
  'A,99',
  '```',
  '',
  '```cells beta/Calc',
  'Local,=Data!B2',
  '```',
  '',
].join('\n');

async function load(page) {
  await page.goto(BASE + '/');
  await page.waitForFunction(() => window.SDocs && typeof window.SDocs.loadText === 'function');
  await page.evaluate((c) => window.SDocs.loadText(c, 'groups.md'), DOC);
  await page.waitForSelector('.sdoc-cells-pane');
}

test('two workbooks render two independent tabbed panes', async ({ page }) => {
  await load(page);
  const panes = page.locator('.sdoc-cells-pane');
  await expect(panes).toHaveCount(2);
  expect(await panes.nth(0).locator('.sdoc-cells-pane-tab').allTextContents()).toEqual(['Data', 'Secret']);
  expect(await panes.nth(1).locator('.sdoc-cells-pane-tab').allTextContents()).toEqual(['Data', 'Calc']);
});

test('a same-named sheet resolves its own workbook data, not the neighbour', async ({ page }) => {
  await load(page);
  // beta is the second pane; open its Calc tab and read =Data!B2.
  const beta = page.locator('.sdoc-cells-pane').nth(1);
  await beta.locator('.sdoc-cells-pane-tab', { hasText: 'Calc' }).click();
  // =Data!B2 must show 99 (beta's Data), never 10 (alpha's).
  await expect(beta.locator('.sdoc-cells-pane-body')).toContainText('99');
  await expect(beta.locator('.sdoc-cells-pane-body')).not.toContainText('10');
});

test('switching a tab in one pane leaves the other pane untouched', async ({ page }) => {
  await load(page);
  const alpha = page.locator('.sdoc-cells-pane').nth(0);
  const beta = page.locator('.sdoc-cells-pane').nth(1);
  await beta.locator('.sdoc-cells-pane-tab', { hasText: 'Calc' }).click();
  // alpha's active tab is still its first (Data).
  await expect(alpha.locator('.sdoc-cells-pane-tab.is-active')).toHaveText('Data');
});

test('fullscreen on a beta sheet shows only beta tabs', async ({ page }) => {
  await load(page);
  const beta = page.locator('.sdoc-cells-pane').nth(1);
  await beta.locator('.sdoc-cells-expand:visible').first().click();
  const focus = page.locator('.sdoc-cells-focus');
  await expect(focus).toBeVisible();
  expect(await focus.locator('.sdoc-cells-focus-tab').allTextContents()).toEqual(['Data', 'Calc']);
});
