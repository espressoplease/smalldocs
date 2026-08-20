const { test, expect } = require('@playwright/test');
const zlib = require('zlib');

function compressedDocument(markdown) {
  return zlib.brotliCompressSync(Buffer.from(markdown), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
  }).toString('base64url');
}

test.use({ serviceWorkers: 'block' });

test('document sign-in keeps the document fragment out of authentication requests', async ({ page }) => {
  const markdown = '# Private return test\n\n' + 'Content which remains in this browser. '.repeat(300);
  const documentUrl = '/docs#md=' + compressedDocument(markdown);
  await page.goto(documentUrl);
  await expect(page.getByRole('heading', { name: 'Private return test' })).toBeVisible();

  await page.locator('.doc-site-nav').evaluate(nav => {
    const link = document.createElement('a');
    link.className = 'doc-site-action doc-site-sign-in';
    link.href = '/cloud/sign-in?return=%2Fdocs';
    link.setAttribute('data-sdocs-sign-in-return', '');
    link.textContent = 'Sign in';
    nav.insertBefore(link, nav.querySelector('.doc-site-menu'));
    window.SDocs.wireDocumentSiteNavigation();
  });

  await page.locator('[data-sdocs-sign-in-return]').click();
  await expect(page).toHaveURL(/\/cloud\/sign-in\?return=/);
  const authUrl = new URL(page.url());
  expect(authUrl.searchParams.get('return')).toBe('/docs?sdocs_resume=1');
  expect(page.url()).not.toContain('md=');
  expect(page.url().length).toBeLessThan(180);
  await page.goto('/public/cloud-sign-in.html?return=' + encodeURIComponent('/docs?sdocs_resume=1'));
  await expect(page.locator('#return-label')).toHaveText('your document');
  await expect(page.locator('.return-input').first()).toHaveValue('/docs?sdocs_resume=1');

  await page.goto('/docs?sdocs_resume=1');
  await expect(page.getByRole('heading', { name: 'Private return test' })).toBeVisible();
  expect(page.url()).toContain('/docs#md=');
  await expect.poll(() => page.evaluate(() =>
    sessionStorage.getItem('sdocs-cloud-sign-in-return-v1'))).toBeNull();
});

test('sign-in never renders an arbitrary return URL as page copy', async ({ page }) => {
  await page.goto('/public/cloud-sign-in.html?return=' +
    encodeURIComponent('/unexpected/' + 'x'.repeat(4000)));
  await expect(page.locator('#return-label')).toHaveText('the previous page');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth -
    document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});
