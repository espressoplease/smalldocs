// @ts-check
//
// Regression: saving / sharing while viewing in dark mode must NOT write the
// dark-resolved colours into the top-level (light) style slots. collectStyles
// is the single chokepoint every save/share/short-link funnels through.
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

const DOC = [
  '---',
  'styles:',
  '  background: "#ffffff"',
  '  color: "#1c1a17"',
  '  h3: { color: "#4d65ff" }',
  '  link: { color: "#4d65ff" }',
  '  dark:',
  '    background: "#1a120b"',
  '---',
  '',
  '# Heading',
  '',
  '### Sub heading',
  '',
  'A [link](https://x).',
].join('\n');

test('collectStyles emits the light palette even when viewing in dark mode', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForSelector('#_sd_rendered');
  await page.evaluate(() => window.SDocs.switchThemeAndUpdate('light'));
  await page.evaluate((md) => window.SDocs.loadText(md), DOC);

  // Sanity: in light mode the collector returns the authored light palette.
  const light = await page.evaluate(() => window.SDocs.collectStyles());
  expect(light.background).toBe('#ffffff');
  expect(light.h3.color).toBe('#4d65ff');

  // Switch to dark and collect again. The top-level (light) slots must be
  // unchanged - the dark theme's colours belong in the dark: block, not here.
  await page.evaluate(() => window.SDocs.switchThemeAndUpdate('dark'));
  const dark = await page.evaluate(() => window.SDocs.collectStyles());
  expect(dark.background).toBe('#ffffff');
  expect(dark.h3.color).toBe('#4d65ff');
  expect(dark.link.color).toBe('#4d65ff');
});

test('loading a doc while already in dark mode still collects the light palette', async ({ page }) => {
  // The real-world trigger: OS is dark, the doc opens in dark, the user
  // generates a short link without ever switching to light.
  await page.goto(BASE);
  await page.waitForSelector('#_sd_rendered');
  await page.evaluate(() => window.SDocs.switchThemeAndUpdate('dark'));
  await page.evaluate((md) => window.SDocs.loadText(md), DOC);

  const s = await page.evaluate(() => window.SDocs.collectStyles());
  expect(s.background).toBe('#ffffff');
  expect(s.h3.color).toBe('#4d65ff');
  // The authored dark: block must still round-trip.
  expect(s.dark && s.dark.background).toBe('#1a120b');
});
