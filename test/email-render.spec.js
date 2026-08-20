const { test, expect } = require('@playwright/test');
const templates = require('../lib/email-templates');

const messages = [
  ['sign-in', () => templates.signInCode({ code: '384921' })],
  ['invitation', () => templates.workspaceInvitation({
    acceptUrl: 'https://cloud-staging.smalldocs.org/cloud/invite?token=preview',
    inviter: 'Tom Smith', accountName: 'SmallDocs Demo',
  })],
  ['document notification', () => templates.documentNotification({ actor: 'Tom Smith', documents: [
    { title: 'Release notes', url: 'https://cloud-staging.smalldocs.org/docs?cloud-document=one' },
    { title: 'Cloud test plan', url: 'https://cloud-staging.smalldocs.org/docs?cloud-document=two' },
    { title: 'Security review', url: 'https://cloud-staging.smalldocs.org/docs?cloud-document=three' },
  ], note: 'I pulled these together after checking the release against the staging test plan.' })],
];

for (const [name, render] of messages) {
  test(name + ' email renders without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    const message = render();
    await page.setContent(message.html);
    await expect(page.locator('body')).toContainText('SmallDocs');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <=
      document.documentElement.clientWidth)).toBe(true);
    const links = page.locator('a');
    for (let index = 0; index < await links.count(); index++) {
      await expect(links.nth(index)).toHaveAttribute('href', /^https:\/\//);
    }
  });
}
