// Record the standalone fixture preview after starting onboarding-preview.js.
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const output = path.resolve(process.argv[2] || '/tmp/smalldocs-onboarding-videos');
(async function () {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 },
        recordVideo: { dir: output, size: { width, height: 900 } } });
      const page = await context.newPage();
      await page.goto('http://localhost:3102/');
      await page.waitForTimeout(1700);
      await page.getByRole('link', { name: 'New email signup', exact: true }).click();
      await page.waitForTimeout(1500);
      await page.getByLabel('First name').pressSequentially('Alex', { delay: 130 });
      await page.getByLabel('Last name').pressSequentially('Rivera', { delay: 130 });
      await page.waitForTimeout(700);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('heading', { name: 'Install SmallDocs', exact: true }).waitFor();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: path.join(output, 'install-' + width + '.png'), fullPage: true });
      await page.getByRole('link', { name: 'View connected machines' }).click();
      await page.waitForTimeout(2000);
      await page.goto('http://localhost:3102/');
      await page.getByRole('link', { name: 'Google with profile name', exact: true }).click();
      await page.getByRole('link', { name: 'Join or create a team', exact: true }).click();
      await page.getByRole('button', { name: 'Request to join a team at joes.com', exact: true }).click();
      await page.getByLabel('Anything else? (optional)').fill('I work with engineering.');
      await page.locator('#request-consent').check();
      await page.getByRole('button', { name: 'Create request link', exact: true }).click();
      await page.locator('#request-link').waitFor();
      await page.waitForTimeout(2000);
      const requestUrl = await page.locator('#request-link').inputValue();
      await page.goto(requestUrl);
      await page.getByRole('link', { name: 'View as Bob (admin)', exact: true }).click();
      await page.getByRole('button', { name: 'Send invitation', exact: true }).waitFor();
      await page.waitForTimeout(2000);
      await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
      await page.locator('#invite-link').waitFor();
      const inviteUrl = await page.locator('#invite-link').inputValue();
      await page.getByRole('link', { name: 'View as requester', exact: true }).click();
      await page.goto(inviteUrl);
      await page.getByRole('button', { name: 'Accept invitation', exact: true }).waitFor();
      await page.waitForTimeout(2000);
      await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
      await page.getByRole('heading', { name: 'Install SmallDocs', exact: true }).waitFor();
      await page.waitForTimeout(2000);
      await page.goto('http://localhost:3102/');
      await page.getByRole('link', { name: 'Already connected', exact: true }).click();
      await page.getByText('Alexs-MacBook.local', { exact: true }).waitFor();
      await page.waitForTimeout(2500);
      const video = page.video();
      await context.close();
      await video.saveAs(path.join(output, 'onboarding-' + width + '.webm'));
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
