const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildWorkbook, valuesFor } = require('../cli/lib/cells-verify');
const FX = require('../cli/shared/sdocs-cells-formula');
const { buildUrl, decompressFromBase64Url } = require('../cli/lib/url');
const { parseFrontMatter } = require('../cli/shared/sdocs-yaml');
const { renderSamples } = require('../scripts/build-homepage-samples');
const directory = path.join(__dirname, '../public/homepage/examples');
const samples = require('../public/homepage/examples/samples.json');
const read = file => fs.readFileSync(path.join(directory, file), 'utf8');

function calculate(file, replacement) {
  let source = read(file);
  if (replacement) source = replacement(source);
  return buildWorkbook(source).workbooks.flatMap(book => {
    const grids = FX.recalcWorkbook(book.sheets);
    return book.sheets.map((sheet, i) => ({ name: sheet.name, values: valuesFor(sheet.model, grids[i]) }));
  });
}
const value = (sheets, name, label, column = 1) => Number(sheets.find(sheet => sheet.name === name).values.find(row => row[0] === label)[column]);

test('retry workbook matches exhaustive outcome enumeration, including boundary cases', () => {
  const file = 'retry-amplification-study.md';
  for (const p of [0, .2, .8, 1]) {
    const sheets = calculate(file, source => source.replace('Response loss probability,0.2', 'Response loss probability,' + p));
    let work = 0;
    for (let k = 1; k <= 3; k++) work += k * p ** (k - 1) * (1 - p);
    work += 3 * p ** 3;
    expect(value(sheets, 'Expected', 'Expected executions per operation')).toBeCloseTo(work, 10);
    expect(value(sheets, 'Expected', 'Unknown client outcome probability')).toBeCloseTo(p ** 3, 10);
    expect(value(sheets, 'Expected', 'Effects with durable keys')).toBe(10000);
  }
  const noRetry = calculate(file, source => source.replace('Total attempts,3', 'Total attempts,1'));
  expect(value(noRetry, 'Expected', 'Duplicate-effect probability without keys')).toBe(0);
  expect(value(calculate(file), 'Nesting', '5', 2)).toBe(243);
});

test('finance workbooks reconcile the statements and respond to changed assumptions', () => {
  const sheets = calculate('costco-cash-engine.md');
  expect(value(sheets, 'CashBridge', 'Reconciliation difference')).toBe(0);
  expect(value(sheets, 'CashBridge', 'Operating cash flow less capex')).toBe(7837);
  expect(value(sheets, 'Stress', 'Total incremental cash required')).toBeCloseTo(239886 / 364 * 5, 8);
  const noStress = calculate('costco-cash-engine.md', source => source
    .replace('Inventory days increase,3', 'Inventory days increase,0')
    .replace('Payable days reduction,2', 'Payable days reduction,0'));
  expect(value(noStress, 'Stress', 'Post-capex cash after timing stress')).toBe(7837);
  const growth = calculate('working-capital-in-five-slides.md');
  expect(value(growth, 'Model', 'Operating working capital')).toBe(130);
  expect(value(growth, 'Model', 'Operating working capital', 2)).toBe(260);
  expect(value(growth, 'Model', 'Additional funding needed', 2)).toBe(130);
});

test('the embedded reproduction programs run and agree with the published results', () => {
  for (const file of ['retry-amplification-study.md', 'costco-cash-engine.md', 'newton-convergence.md']) {
    const python = read(file).match(/~~~python\n([\s\S]*?)\n~~~/)[1];
    const output = execFileSync('python3', ['-c', python], { encoding: 'utf8' });
    expect(output).toContain(file.startsWith('retry') ? '20%,1.2400,0.8000%,20.0000%' : file.startsWith('newton') ? 'Cycle: [0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0]' : 'Post-capex cash after stress: 4541.86');
  }
});

test('the date-picker bug reproduces in US time zones and the fix preserves every calendar date', () => {
  const blocks = [...read('date-picker-bug-report.md').matchAll(/~~~javascript\n([\s\S]*?)\n~~~/g)].map(match => match[1]);
  for (const timezone of ['America/Los_Angeles', 'America/New_York', 'Europe/London', 'Asia/Tokyo']) {
    const output = execFileSync(process.execPath, ['-e', blocks.join('\n')], {
      encoding: 'utf8', env: { ...process.env, TZ: timezone }
    }).trim().split('\n');
    expect(output[0]).toBe('2026-01-01');
    expect(output[1]).toBe(timezone.startsWith('America/') ? 'Dec 31, 2025' : 'Jan 1, 2026');
    expect(output[2]).toBe('Jan 1, 2026');
  }
});

test('mathematics workbooks expose the reversal and the convergent square-root recurrence', () => {
  const simpson = calculate('simpsons-paradox.md');
  expect(value(simpson, 'Weights', 'Observed A minus B')).toBeCloseTo(.55 - 810 / 1100, 12);
  for (const w of [0, .25, .5, 1]) {
    const sheets = calculate('simpsons-paradox.md', source => source.replace('Common easy-problem weight,0.5', 'Common easy-problem weight,' + w));
    expect(value(sheets, 'Weights', 'Standardized A minus B')).toBeCloseTo(.1, 12);
  }
  const newton = calculate('newton-convergence.md');
  expect(value(newton, 'Checks', 'Final iterate')).toBeCloseTo(Math.sqrt(2), 12);
  expect(value(newton, 'Checks', 'Final residual')).toBeLessThan(1e-12);
});

test('homepage links retain the document sources, original science URLs and background colours', async ({ page }) => {
  await page.goto('/home-next');
  const links = page.locator('[data-sample]');
  await expect(links).toHaveCount(10);
  await expect(page.locator('#learn .trouble')).toHaveCount(0);
  await expect(page.locator('#learn a[href="/runnable-html"], #learn a[href="/developers"]')).toHaveCount(0);
  expect(await links.locator('.learn-item-prompt').allTextContents()).toEqual(samples.map(sample => '“' + sample.prompt + '”'));
  const html = fs.readFileSync(path.join(__dirname, '../public/homepage-next.html'), 'utf8');
  expect(html).toContain(renderSamples());
  for (const [index, sample] of samples.entries()) {
    const href = await links.nth(index).getAttribute('href');
    await expect(links.nth(index)).toHaveAttribute('target', '_blank');
    const tint = await links.nth(index).evaluate(link => getComputedStyle(link).backgroundColor);
    const colours = await links.nth(index).evaluate(link => [
      getComputedStyle(link).color,
      getComputedStyle(link.querySelector('.learn-item-prompt')).color
    ]);
    expect(colours[0]).toBe(colours[1]);
    const rgb = sample.background.match(/\w\w/g).map(pair => parseInt(pair, 16));
    expect(tint).toBe(`rgb(${rgb.join(', ')})`);
    if (sample.source) {
      const decoded = decompressFromBase64Url(new URL(href, 'http://localhost').hash.slice(1).replace(/^md=/, ''));
      expect(parseFrontMatter(decoded).body).toBe(parseFrontMatter(read(sample.source)).body);
      expect(parseFrontMatter(decoded).meta.styles.background).toBe(sample.background);
    } else expect(href).toBe(sample.url);
  }
});

for (const width of [390, 1440]) {
  for (const sample of samples.filter(sample => sample.source)) {
    test(sample.source + ' renders at width ' + width, async ({ page }) => {
      test.setTimeout(30000);
      await page.setViewportSize({ width, height: 900 });
      const url = buildUrl(read(sample.source), { url: '/docs' }).replace('/docs/#', '/docs#');
      await page.goto(url);
      const body = parseFrontMatter(read(sample.source)).body;
      const title = sample.source.includes('five-slides') ? body.match(/^#title: (.+)$/m)[1] : body.match(/^# (.+)$/m)[1];
      await expect(page.locator('#_sd_rendered')).toContainText(title);
      const expand = page.getByRole('button', { name: 'Expand all', exact: true });
      if (await expand.isVisible()) await expand.click();
      await expect(page.locator('.sdoc-slide-errbadge')).toHaveCount(0);
      if (sample.source.includes('five-slides')) await expect(page.locator('.sdoc-slide')).toHaveCount(5);
      if (sample.source.includes('study') || sample.category === 'Finance' || sample.category === 'Mathematics') {
        await page.locator('.sdoc-chart').first().scrollIntoViewIfNeeded();
        await expect(page.locator('canvas').first()).toBeVisible();
        await expect(page.locator('.sdoc-cells-grid').first()).toBeVisible();
      }
      const diagramCount = [...body.matchAll(/~~~mermaid\n/g)].length;
      if (diagramCount) {
        await expect(page.locator('.sdoc-mermaid-stage > svg')).toHaveCount(diagramCount, { timeout: 15000 });
        await expect(page.locator('.sdoc-mermaid-error-msg')).toHaveCount(0);
      }
      if (sample.category === 'Mathematics') {
        await expect(page.locator('#_sd_rendered .katex').first()).toBeVisible();
        await expect(page.locator('#_sd_rendered .katex-error')).toHaveCount(0);
      }
      if (sample.source === 'idempotent-order-api.md') {
        const positions = await page.evaluate(() => ({
          diagram: document.querySelector('.sdoc-mermaid').getBoundingClientRect().top,
          heading: document.querySelector('#_sd_rendered h2').getBoundingClientRect().top
        }));
        expect(positions.diagram).toBeLessThan(positions.heading);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const clipped = await page.locator('.sdoc-slide .shape-md').evaluateAll(shapes => shapes
        .filter(shape => shape.scrollHeight > shape.clientHeight + 2)
        .map(shape => shape.textContent));
      expect(clipped).toEqual([]);
    });
  }
}
