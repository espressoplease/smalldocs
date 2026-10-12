const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });
for (const width of [390, 1440]) {
  test('homepage experiment fits and exposes its sample documents at width ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/home-next');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('document format and library');
    await expect(page.locator('#learn .learn-item')).toHaveCount(8);
    await expect(page.locator('.sample-preview')).toHaveCount(0);
    await expect(page.locator('[data-install-form]')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const link of await page.locator('#learn .learn-item').all()) {
      expect(await link.getAttribute('href')).toMatch(/^(https:\/\/smalldocs\.org)?\//);
    }
    expect(errors).toEqual([]);
  });
}
for (let index = 0; index < 3; index++) {
  test('email form ' + index + ' reveals install commands only after a saved request', async ({ page }) => {
    let submitted;
    await page.route('**/api/install-interest', route => {
      submitted = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { ok: true } });
    });
    await page.goto('/home-next');
    const instructions = page.locator('#install-instructions');
    await expect(instructions).toBeHidden();
    const form = page.locator('[data-install-form]').nth(index);
    await form.locator('input').fill('reader@example.com');
    await form.locator('button').click();
    await expect(instructions).toBeVisible();
    expect(submitted).toEqual({ email: 'reader@example.com' });
    await expect(page.locator('[data-install-command]')).toContainText('smalldocs.org/install');
    await expect(page.locator('[data-install-form] input').first()).toHaveValue('reader@example.com');
  });
}
test('failed email submissions preserve the address and allow retry', async ({ page }) => {
  await page.route('**/api/install-interest', route => route.fulfill({ status: 502, json: { error: 'submission_failed' } }));
  await page.goto('/home-next');
  const form = page.locator('[data-install-form]').first();
  await form.locator('input').fill('reader@example.com');
  await form.locator('button').click();
  await expect(page.locator('.start-status').first()).toContainText('Try again');
  await expect(page.locator('#install-instructions')).toBeHidden();
  await expect(form.locator('input')).toHaveValue('reader@example.com');
  await expect(form.locator('button')).toBeEnabled();
});


test('installer copy uses the shared platform command', async ({ page }) => {
  await page.route('**/api/install-interest', route => route.fulfill({ status: 201, json: { ok: true } }));
  await page.addInitScript(() => {
    navigator.clipboard.writeText = async text => { window.copiedInstallCommand = text; };
  });
  await page.goto('/home-next');
  const form = page.locator('[data-install-form]').first();
  await form.locator('input').fill('reader@example.com');
  await form.locator('button').click();
  await page.locator('[data-copy-install]').click();
  expect(await page.evaluate(() => window.copiedInstallCommand))
    .toBe('curl -fsSL https://smalldocs.org/install | sh');
});


test('the introduction is a 30-second clip with captions', async ({ page }) => {
  await page.goto('/home-next');
  await page.locator('#intro-video').evaluate(video => video.load());
  await expect.poll(() => page.locator('#intro-video').evaluate(video => video.duration)).toBeGreaterThanOrEqual(30);
  expect(await page.locator('#intro-video').evaluate(video => video.duration)).toBeLessThan(31);
  await expect(page.locator('#intro-video track')).toHaveAttribute('kind', 'captions');
});


test('homepage experiment preserves the supplied copy and vertical order', async ({ page }) => {
  await page.goto('/home-next');
  const expected = [
    'You use it when you want to escape the limits of your chat interface or save an agents thinking at a given point in time. Your agents can use it on their own: a remote agent can write a SmallDoc and notify you.',
    'SmallDocs are more powerful than the document formats you’re used to (Word, Excel, PowerPoint, Markdown, code and HTML artefacts). SmallDocs combine all these formats into one: a single SmallDoc can include slides, a multi-tab spreadsheet, charts, code, an HTML widget and text to link it all together. This flexibility reflects the range of tasks your agents face.',
    'Despite their depth, SmallDocs are lightweigt to use. To get your agent to produce a SmallDoc, simply mention “sdoc”: “write me a sdoc about (topic)”. They also render instantly in the browser, read beautifully on mobile and they’re seamlessly sharable within your team and beyond.',
    'SmallDocs are built for human-agent feedback loops. Speed up your iteration with targeted features: easy ways to copy precise chunks of text, tables, code, charts, etc. and the ability to leave comments on a document for your agent to pick up',
    'SmallDocs are automatically saved to an encrypted cloud library.',
    'Over 4,000 developers, financiers and scientists use SmallDocs. To join them enter your email to access your install script:',
    'SmallDocs is completely free for a month then £4/month for individuals and £7/month/user for teams.',
  ];
  expect(await page.locator('.homepage-copy').allTextContents()).toEqual(expected);
  await expect(page.locator('h1')).toHaveText('SmallDocs is a document format and library for coding agents.');
  expect(await page.locator('[data-install-form] button').allTextContents())
    .toEqual(['Get install link', 'start using SmallDocs', 'start using SmallDocs']);
  const positions = await page.evaluate(() => ['.homepage-small-video','h1','.homepage-copy','#start','#samples','#praise']
    .map(selector => document.querySelector(selector).getBoundingClientRect().top));
  expect(positions).toEqual([...positions].sort((a,b) => a-b));
});
