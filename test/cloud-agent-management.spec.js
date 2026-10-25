const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
const { TRIAL_WARNING_MS } = require('../lib/cloud-trial-policy');
test.use({ serviceWorkers: 'block' });
let f;
test.beforeEach(async ({ page }) => {
  f = await startFixture({ singlePlan: true });
  await f.api('josh','/api/cloud/v1/onboarding/complete','POST',{});
  await page.context().addCookies([{ name:'sdocs_cloud',value:f.users.josh.sessionToken,url:f.origin }]);
});
test.afterEach(async()=>{await f.close();});
for(const width of [390,1440]) {
  test('Cloud is Library with the library icon and trial subscribe link at '+width,async({page})=>{
    await page.setViewportSize({width,height:900});
    await page.goto(f.origin+'/library');
    await expect(page).toHaveURL(/scope=cloud/);
    if(width<769) await page.getByRole('button',{name:'Open menu',exact:true}).click();
    const sidebar=page.locator('.sdocs-site-sidebar');
    await expect(sidebar.getByRole('link',{name:'Library',exact:true})).toBeVisible();
    await expect(sidebar.getByRole('link',{name:'Local library',exact:true})).toHaveCount(0);
    await expect(sidebar.getByRole('link',{name:'Cloud library',exact:true})).toHaveCount(0);
    await expect(sidebar.getByRole('link',{name:'Subscribe',exact:true})).toHaveAttribute('href',f.origin+'/cloud/subscribe');
    const icon=sidebar.getByRole('link',{name:'Library',exact:true}).locator('svg path').first();
    await expect(icon).toHaveAttribute('d','M4 19V5');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
  test('feedback reuses the auth form at '+width,async({page})=>{
    await page.setViewportSize({width,height:900});
    await page.goto(f.origin+'/cloud/trial-feedback');
    await expect(page.getByRole('heading',{name:'How has SmallDocs worked for you?'})).toBeVisible();
    await page.getByLabel('Your experience (optional)').selectOption('4');
    await page.getByLabel('What worked, and what could be better?').fill('Tags make earlier reports easier to find.');
    await page.getByRole('button',{name:'Send feedback',exact:true}).click();
    await expect(page.locator('#feedback-status')).toHaveText('Thank you. Your feedback has been received.');
    expect(f.billing.db.prepare('SELECT rating FROM cloud_trial_feedback WHERE user_id=?').get(f.users.josh.id).rating).toBe(4);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:test.info().outputPath('trial-feedback-'+width+'.png'),fullPage:true});
  });
  test('expired trial gets one extra week then a hard payment page at '+width,async({page})=>{
    await page.setViewportSize({width,height:900});
    f.billing.db.prepare('UPDATE cloud_billing_personal_trials SET ends_at_ms=? WHERE user_id=?').run(Date.now()-1000,f.users.josh.id);
    await page.goto(f.origin+'/cloud/subscribe');
    await expect(page.locator('#subscription-state')).toContainText('Your free trial has ended');
    await expect(page.getByRole('button',{name:'Subscribe',exact:true})).toHaveClass('primary-button');
    await expect(page.locator('.primary-button:visible')).toHaveCount(1);
    await expect(page.getByRole('link',{name:'Back to library',exact:true})).toHaveAttribute('href','/library?scope=cloud');
    f.billing.db.prepare('UPDATE cloud_billing_personal_trials SET ends_at_ms=? WHERE user_id=?').run(Date.now()-TRIAL_WARNING_MS-1000,f.users.josh.id);
    await page.goto(f.origin+'/library?scope=cloud');
    await expect(page).toHaveURL(f.origin+'/cloud/subscribe');
    await expect(page.getByRole('heading',{name:'Subscribe to continue',exact:true})).toBeVisible();
    await expect(page.locator('.primary-button:visible')).toHaveCount(1);
    await expect(page.getByRole('button',{name:'Subscribe',exact:true})).toBeEnabled();
    await expect(page.getByRole('link',{name:'Share feedback on your trial'})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:test.info().outputPath('trial-paywall-'+width+'.png'),fullPage:true});
    await page.getByRole('link',{name:'Back to settings'}).click();
    await expect(page.getByRole('heading',{name:'Billing',exact:true})).toBeVisible();
    await expect(page.locator('#billing-status')).toContainText('extra week have ended');
  });
}
test('navigation preference persists and restores the previous two-library layout',async({page})=>{
  await page.goto(f.origin+'/cloud/admin?panel=preferences');
  const checkbox=page.getByRole('checkbox',{name:'Show local library'});
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await expect(page.locator('#library-preference-status')).toContainText('Saved');
  await page.goto(f.origin+'/library?scope=cloud');
  const sidebar=page.locator('.sdocs-site-sidebar');
  await expect(sidebar.getByRole('link',{name:'Local library',exact:true})).toBeVisible();
  await expect(sidebar.getByRole('link',{name:'Cloud library',exact:true})).toBeVisible();
  await page.goto(f.origin+'/cloud/admin?panel=preferences');
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await expect(page.locator('#library-preference-status')).toContainText('Saved');
  await page.reload(); await expect(checkbox).not.toBeChecked();
});
