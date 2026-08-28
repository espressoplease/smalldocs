const { test, expect } = require('@playwright/test');
const zlib = require('zlib');

const documentSource = `# Responsive chart

## Revenue

\`\`\`chart
{
  "type": "mixed",
  "title": "Where annual revenue growth came from",
  "subtitle": "Reported attribution applied to the annual increase in revenue",
  "labels": ["2021", "2022", "2023", "2024", "2025"],
  "datasets": [
    {"label": "Existing customers", "type": "bar", "values": [302, 485, 295, 417, 557]},
    {"label": "New customers", "type": "line", "values": [123, 162, 159, 139, 186]}
  ],
  "dataLabels": false,
  "legendPosition": "bottom",
  "aspectRatio": 1.8
}
\`\`\`
`;

function documentUrl() {
  const compressed = zlib.brotliCompressSync(Buffer.from(documentSource), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
  });
  const payload = compressed.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return '/docs#md=' + payload;
}

async function openChart(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(documentUrl(), { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await expect(page.locator('.sdoc-chart canvas')).toBeVisible({ timeout: 15000 });
  return page.locator('.sdoc-chart canvas').evaluate((canvas) => ({
    width: canvas.offsetWidth,
    height: canvas.offsetHeight,
  }));
}

test('authored chart aspect ratio remains intact on desktop', async ({ page }) => {
  const size = await openChart(page, 1440, 900);
  expect(size.width / size.height).toBeGreaterThan(1.75);
  expect(size.width / size.height).toBeLessThan(1.85);
});

test('wide authored chart gets a readable plotting surface on mobile', async ({ page }) => {
  const size = await openChart(page, 390, 844);
  expect(size.width).toBeGreaterThan(320);
  expect(size.height).toBeGreaterThan(500);
  expect(size.width / size.height).toBeLessThan(0.7);
});
