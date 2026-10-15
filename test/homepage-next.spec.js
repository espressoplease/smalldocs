const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block', locale: 'en-GB' });
for (const width of [390, 1440]) {
  test('only Log in fades into the navigation without moving the heading at width ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => window.addEventListener('load', () => {
      window.loginAtLoad = {
        time: performance.now(),
        visibility: getComputedStyle(document.querySelector('.homepage-login')).visibility,
        headingTop: document.querySelector('h1').getBoundingClientRect().top,
      };
    }));
    await page.goto('/home-next');
    expect(await page.evaluate(() => window.loginAtLoad.visibility)).toBe('hidden');
    await expect(page.locator('nav a')).toHaveCount(1);
    await expect(page.locator('nav details, nav button')).toHaveCount(0);
    const login = page.getByRole('link', { name: 'Log in', exact: true });
    await expect(login).toHaveAttribute('href', '/connect?return=%2Flibrary');
    await expect.poll(() => login.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
    expect(await page.evaluate(() => performance.now() - window.loginAtLoad.time)).toBeGreaterThanOrEqual(500);
    expect(await page.locator('h1').evaluate(el => el.getBoundingClientRect().top - window.loginAtLoad.headingTop)).toBe(0);
    const button = await login.boundingBox();
    expect(button.x).toBeGreaterThan(width / 2);
    expect(button.y).toBeCloseTo(8, 0);
    expect(button.x + button.width).toBeCloseTo(width - 8, 0);
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect.poll(() => login.evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThan(0);
  });
}
for (const width of [320, 390, 600, 601, 1440]) {
  test('signup controls fill their column without crowding at width ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/home-next');
    for (const form of await page.locator('[data-install-form]').all()) {
      const geometry = await form.evaluate(element => {
        const input = element.querySelector('input').getBoundingClientRect();
        const button = element.querySelector('button').getBoundingClientRect();
        const column = element.closest('.homepage-column').getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return { input: input.toJSON(), button: button.toJSON(), column: column.toJSON(), box: box.toJSON() };
      });
      expect(geometry.box.width).toBeCloseTo(geometry.column.width, 0);
      expect(geometry.input.width).toBeGreaterThanOrEqual(200);
      if (width <= 600) {
        expect(geometry.input.height).toBeGreaterThanOrEqual(48);
        expect(geometry.button.height).toBeGreaterThanOrEqual(48);
        expect(geometry.button.top).toBeGreaterThanOrEqual(geometry.input.bottom);
        expect(geometry.input.width).toBeCloseTo(geometry.box.width, 0);
        expect(geometry.button.width).toBeCloseTo(geometry.box.width, 0);
      } else {
        expect(geometry.button.height).toBeLessThan(48);
        expect(geometry.button.top).toBeCloseTo(geometry.input.top, 0);
        expect(geometry.button.left).toBeGreaterThanOrEqual(geometry.input.right);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const spacing = await page.evaluate(() => {
      const form = document.querySelector('#start-samples form').getBoundingClientRect();
      const samples = document.querySelector('#learn .install-panel').getBoundingClientRect();
      const praise = document.querySelector('#praise .install-panel').getBoundingClientRect();
      return {
        above: form.top - samples.bottom,
        below: praise.top - document.querySelector('#start-samples .homepage-sales-link').getBoundingClientRect().bottom,
        topMargin: getComputedStyle(document.querySelector('#start')).marginTop,
        buttons: Array.from(document.querySelectorAll('[data-install-form] button'), el => getComputedStyle(el).backgroundColor),
      };
    });
    expect(spacing.above).toBeCloseTo(spacing.below, 0);
    expect(spacing.topMargin).toBe('13px');
    expect(spacing.buttons).toEqual(Array(3).fill('rgb(0, 0, 0)'));
  });
}
for (const width of [390, 1440]) {
  test('homepage experiment fits and exposes its sample documents at width ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/home-next');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('document format and library');
    await expect(page.locator('#learn .learn-item')).toHaveCount(10);
    await expect(page.locator('#learn [data-sample]')).toHaveCount(10);
    expect(await page.locator('.sample-group-heading').allTextContents()).toEqual(['For engineers:', 'For scientists:', 'For financiers:', 'For mathematicians:']);
    await expect(page.locator('.sample-preview')).toHaveCount(0);
    await expect(page.locator('[data-install-form]')).toHaveCount(3);
    await expect(page.locator('.homepage-sales-link a[href="/connect?return=%2Flibrary"]')).toHaveCount(3);
    expect(await page.locator('.homepage-sales-link').allTextContents()).toEqual(Array(3).fill('or talk to sales (or log in)'));
    await expect(page.locator('#praise h2')).toHaveText('YPraise for SmallDocs on Hacker News');
    await expect(page.locator('#praise .hn-badge')).toBeVisible();
    await expect(page.locator('#praise .praise-card')).toHaveCount(6);
    for (const card of await page.locator('#praise .praise-card').all()) await expect(card).toBeVisible();
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
    'You use it when you want to escape the limits of your chat interface or save an agent’s thinking at a given point in time. Your agents can use it on their own: a remote agent can write a SmallDoc and notify you.',
    'SmallDocs are more powerful than the document formats you’re used to (Word, Excel, PowerPoint, Markdown, code and HTML artefacts). SmallDocs combine all these formats into one: a single SmallDoc can include slides, a multi-tab spreadsheet, charts, code, an HTML widget and text to link it all together. This flexibility reflects the range of tasks your agents face.',
    'Despite their depth, SmallDocs are lightweight to use. To get your agent to produce a SmallDoc, simply mention “sdoc”: “write me a sdoc about (topic)”. They also render instantly in the browser, read beautifully on mobile and they’re seamlessly shareable within your team and beyond.',
    'SmallDocs are built for human-agent feedback loops. Speed up your iteration with targeted features: easy ways to copy precise chunks of text, tables, code and charts, and the ability to leave comments on a document for your agent to pick up.',
    'SmallDocs are automatically saved to an encrypted cloud library. This library is accessible to humans (on the web, including mobile) and agents (via the SmallDocs command line tool).',
    'SmallDocs are agent agnostic, meaning teams using AI from a range of providers can all create and save documents in a standardized way.',
    'Over 4,000 developers, financiers and scientists use SmallDocs. To join them, enter your email to receive your install prompt:',
    'SmallDocs is free for a month, then £4/month for individuals and £7/month/user for teams. Free usage can be extended by successfully sharing a referral link.',
  ];
  expect(await page.locator('.homepage-copy').allTextContents()).toEqual(expected);
  await expect(page.locator('h1')).toHaveText('SmallDocs is a document format and library for coding agents.');
  expect(await page.locator('[data-install-form] button').allTextContents())
    .toEqual(Array(3).fill('Get install prompt'));
  const positions = await page.evaluate(() => ['.homepage-small-video','h1','.homepage-copy','#start','#samples','#praise']
    .map(selector => document.querySelector(selector).getBoundingClientRect().top));
  expect(positions).toEqual([...positions].sort((a,b) => a-b));
});

for (const width of [390, 1440]) {
  test('sales links scroll to the shared form and the final signup is centred at width ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/home-next');
    const links = page.locator('.homepage-sales-link a[href="#talk-to-sales"]');
    await expect(links).toHaveCount(3);
    for (const link of await links.all()) {
      await link.click();
      await expect(page).toHaveURL(/#talk-to-sales$/);
      await expect(page.locator('#talk-to-sales h2')).toBeInViewport();
      await expect(page.locator('#tf-email')).toBeInViewport();
    }
    const gaps = await page.evaluate(() => {
      const praise = document.querySelector('#praise .install-panel').getBoundingClientRect();
      const form = document.querySelector('#start-praise form').getBoundingClientRect();
      const link = document.querySelector('#start-praise .homepage-sales-link').getBoundingClientRect();
      const sales = document.querySelector('#talk-to-sales .install-panel').getBoundingClientRect();
      return [form.top - praise.bottom, sales.top - link.bottom];
    });
    expect(gaps[0]).toBeCloseTo(gaps[1], 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
test('sales form uses the existing CRM endpoint and confirms a successful submission', async ({ page }) => {
  let submitted;
  await page.route('**/api/teams-interest', route => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: { ok: true } });
  });
  await page.goto('/home-next');
  await page.locator('#tf-name').fill('Alex Smith');
  await page.locator('#tf-email').fill('team@example.com');
  await page.locator('#tf-message').fill('Shared document workflows');
  await page.locator('#tf-submit').click();
  await expect(page.locator('.teams-thanks')).toContainText('team@example.com');
  expect(submitted).toEqual({ email: 'team@example.com', name: 'Alex Smith', message: 'Shared document workflows', website: '' });
});
test('sales form preserves entered information after a failed submission', async ({ page }) => {
  await page.route('**/api/teams-interest', route => route.fulfill({ status: 502, json: { error: 'submission_failed' } }));
  await page.goto('/home-next');
  await page.locator('#tf-name').fill('Alex Smith');
  await page.locator('#tf-email').fill('team@example.com');
  await page.locator('#tf-message').fill('Shared workflows');
  await page.locator('#tf-submit').click();
  await expect(page.locator('#tf-status')).toContainText('Try again');
  await expect(page.locator('#tf-submit')).toBeEnabled();
  await expect(page.locator('#tf-message')).toHaveValue('Shared workflows');
});

test('sales form asks for name and email while keeping extra information optional', async ({ page }) => {
  let submitted;
  await page.route('**/api/teams-interest', route => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: { ok: true } });
  });
  await page.goto('/home-next');
  expect(await page.locator('#teamsForm .tf-field label').allTextContents()).toEqual(['Name', 'Work email', 'Anything else? optional']);
  await expect(page.locator('#tf-company')).toHaveCount(0);
  await expect(page.locator('#tf-submit')).toHaveText('Send a request');
  expect(await page.locator('#tf-submit').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(0, 0, 0)');
  await page.locator('#tf-email').fill('team@example.com');
  await page.locator('#tf-submit').click();
  await expect(page.locator('#tf-status')).toHaveText('Enter your name.');
  expect(submitted).toBeUndefined();
  await page.locator('#tf-name').fill('Alex Smith');
  await page.locator('#tf-submit').click();
  await expect(page.locator('.teams-thanks')).toBeVisible();
  expect(submitted.message).toBe('');
});

for (const [locale, personal, team] of [['en-GB', '£4', '£7'], ['en-US', '$5', '$9'], ['de-DE', '€5', '€8']]) {
  test.describe('homepage prices for ' + locale, () => {
    test.use({ locale });
    test('uses the existing Cloud prices in the introductory sentence', async ({ page }) => {
      await page.goto('/home-next');
      await expect(page.locator('.homepage-price')).toHaveText('SmallDocs is free for a month, then ' + personal + '/month for individuals and ' + team + '/month/user for teams. Free usage can be extended by successfully sharing a referral link.');
      await expect(page.locator('.homepage-price [data-cloud-plan="personal"] [data-cloud-price-primary]')).toHaveText(personal);
      await expect(page.locator('.homepage-price [data-cloud-plan="team"] [data-cloud-price-primary]')).toHaveText(team);
    });
  });
}
