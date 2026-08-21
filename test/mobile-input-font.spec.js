const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });

async function expectFontFloor(page, selectors) {
  for (const selector of selectors) {
    const size = await page.locator(selector).evaluate(element =>
      parseFloat(getComputedStyle(element).fontSize));
    expect(size, selector).toBeGreaterThanOrEqual(16);
  }
}

test('Cloud account forms keep text controls at 16px on mobile', async ({ page }) => {
  await page.goto('/public/cloud-sign-in.html');
  await expectFontFloor(page, ['#email', '#code']);

  await page.goto('/public/cloud-test-login.html');
  await expectFontFloor(page, ['#test-email', '#test-secret']);

  await page.goto('/public/cloud-authorize.html');
  await expectFontFloor(page, ['#user-code']);

  await page.goto('/public/cloud-invite.html');
  await expectFontFloor(page, ['#invite-first-name', '#invite-last-name']);

  await page.goto('/public/cloud-checkout.html');
  await expectFontFloor(page, [
    '#checkout-profile-first-name', '#checkout-profile-last-name',
    '#checkout-workspace', '#checkout-team-name',
  ]);

  await page.goto('/public/cloud-admin.html', { waitUntil: 'domcontentloaded' });
  await expectFontFloor(page, ['#domain-input', '#invite-email']);
});

test('Library search and date fields keep text controls at 16px on mobile', async ({ page }) => {
  await page.goto('/public/library/library.html?demo=1');
  await expectFontFloor(page, ['#q']);
  await page.locator('[data-facet="since"]').click();
  await expectFontFloor(page, [
    '.date-range-input[data-end="from"]',
    '.date-range-input[data-end="to"]',
  ]);
});

test('Editor text controls and fullscreen overlays keep the mobile font floor', async ({ page }) => {
  await page.goto('/docs');
  await page.waitForFunction(() => window.SDocs && window.SDocs.codeFocus);
  await expectFontFloor(page, [
    '#_sd_raw', '#_sd_comment-pref-author', '#_sd_ctrl-base-size-num',
    '#_sd_ctrl-font-family', '#_sd_info-feedback',
  ]);

  await page.evaluate(() => {
    var codeAuthor = document.createElement('input');
    codeAuthor.className = 'sdoc-cc-pref-author';
    codeAuthor.id = 'mobile-code-author-test';
    document.body.appendChild(codeAuthor);
    var codeComment = document.createElement('textarea');
    codeComment.className = 'sdoc-cc-input';
    codeComment.id = 'mobile-code-comment-test';
    document.body.appendChild(codeComment);
    var formula = document.createElement('input');
    formula.className = 'sdoc-cells-focus-value';
    formula.id = 'mobile-formula-test';
    document.body.appendChild(formula);
  });
  await expectFontFloor(page, [
    '#mobile-code-author-test', '#mobile-code-comment-test', '#mobile-formula-test',
  ]);
});

test('Shape playground text controls keep the mobile font floor', async ({ page }) => {
  await page.goto('/public/shapes.html');
  await expectFontFloor(page, ['#dsl']);
});
