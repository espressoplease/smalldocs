const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');

test.use({ serviceWorkers: 'allow' });
test('a service-worker-controlled Cloud reader upgrades from the previous release', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'One production-cache upgrade rehearsal supplements the three-browser history suite.');
  test.setTimeout(60000);
  const root = path.join(__dirname, '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-history-upgrade-'));
  const old = path.join(temp, 'old'); fs.mkdirSync(old);
  const archive = path.join(temp, 'old.tar');
  execFileSync('git', ['archive', '--output=' + archive, 'fc4c8a2606cef4208a06202073127e1a34c76916'], { cwd: root });
  execFileSync('tar', ['-xf', archive, '-C', old]);
  let f; const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    f = await startFixture({ singlePlan: true, sourceRoot: old, env: { SDOCS_DEV: '0' } });
    const doc = await f.store.createDocument({ userId: f.users.bob.id, projectId: f.team.projectId,
      filename: 'history.md', markdown: '# History\n\nOriginal paragraph.\n', idempotencyKey: 'create' });
    await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users.bob.sessionToken, url: f.origin }]);
    await page.goto(f.origin + '/docs?cloud-document=' + doc.id);
    await expect(page.locator('#_sd_rendered h1')).toHaveText('History');
    await expect(page.locator('#_sd_btn-history')).toBeHidden();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    });
    await f.store.saveRevision({ userId: f.users.bob.id, documentId: doc.id, credentialId: 'assistant', editReason: 'Apply the requested document update',
      expectedHeadRevisionId: doc.current_revision_id, markdown: '# History\n\nUpdated paragraph.\n', idempotencyKey: 'update' });
    await f.restart(root); await page.reload();
    const button = page.getByRole('button', { name: 'Document history', exact: true });
    await expect(button).toBeVisible(); await button.click();
    await expect(page.locator('#_sd_btn-metadata, #_sd_metadata-panel, script[src*="sdocs-metadata.js"]')).toHaveCount(0);
    await expect(page.locator('#_sd_sdocs-file-info [data-key="title"] .fic-value')).toHaveText('History');
    await expect(page.locator('.sdoc-history-reason').first()).toHaveText('Apply the requested document update');
    await page.getByRole('button', { name: /Agent \/ CLI update/ }).click();
    await expect(page.getByRole('button', { name: 'Open as new document', exact: true })).toHaveCSS('border-radius', '999px');
    await expect(page.getByRole('button', { name: 'Open as new document', exact: true }).locator('svg')).toHaveCount(1);
    await page.getByRole('button', { name: 'View changes', exact: true }).click();
    await expect(page.locator('.sdoc-history-diff-line.added')).toContainText('Updated paragraph.');
    await expect(page.locator('.sdoc-history-diff-line.removed')).toContainText('Original paragraph.');
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    expect(errors).toEqual([]);
  } finally { if (f) await f.close(); fs.rmSync(temp, { recursive: true, force: true }); }
});
