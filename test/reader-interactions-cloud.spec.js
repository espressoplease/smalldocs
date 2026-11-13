const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
const forms = require('../cli/shared/sdocs-form-block');
const interactions = require('../cli/shared/sdocs-interactions');
const crypto = require('crypto');

test.use({ serviceWorkers: 'block' });
test.setTimeout(30000);
const form = `id: review
fields:
  - name: decision
    type: radio
    label: Decision
    options: [Ready, Revise]
    required: true
  - name: notes
    type: textarea
    label: Notes
  - name: budget
    type: number
    label: Budget
  - name: date
    type: date
    label: Date
  - name: channels
    type: checkbox
    label: Channels
    options: [Email, Website]
  - name: owner
    type: select
    label: Owner
    options: [Josh, Ana]
buttons:
  - name: submit
    label: Submit review
    final: true`;
const app = `<!doctype html><html><head><title>Planner</title></head><body>
<label>Hours <input id="hours" type="number" value="2"></label>
<button id="count">Count</button><output id="total"></output>
<script>
const total = document.getElementById('total');
total.textContent = SmallDocs.state.count || 0;
document.getElementById('count').onclick = async () => {
  SmallDocs.setState({count: Number(SmallDocs.state.count || 0) + 1});
  await SmallDocs.save(); total.textContent = SmallDocs.state.count;
};
</script></body></html>`;

async function setup(page, body) {
  const f = await startFixture({ singlePlan: true });
  const created = await f.api('bob', '/api/cloud/v1/account/documents', 'POST', {
    account_id: f.team.workspaceId, filename: 'review.md', markdown: body, idempotency_key: crypto.randomUUID(),
  });
  expect(created.status).toBe(201);
  const doc = created.data.document;
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users.bob.sessionToken, url: f.origin }]);
  await page.goto(f.origin + '/docs?cloud-document=' + doc.id);
  await expect(page.locator('#_sd_rendered h1')).toBeVisible();
  return { f, doc, async saved() { return (await f.api('bob', '/api/cloud/v1/documents/' + doc.id)).data.document; } };
}

test('Cloud forms autosave every field type and keep submission history after reload', async ({ page }) => {
  const { f, saved } = await setup(page, '# Review\n\n```form\n' + form + '\n```\n\nKeep this paragraph.\n');
  try {
    await page.getByLabel('Ready', { exact: true }).check();
    await page.getByLabel('Notes', { exact: true }).fill('One line\nA second line <script>literal</script>');
    await page.getByLabel('Budget', { exact: true }).fill('42.5');
    await page.getByLabel('Date', { exact: true }).fill('2026-11-20');
    await page.getByLabel('Website', { exact: true }).check();
    await page.getByLabel('Owner', { exact: true }).selectOption('Ana');
    await page.evaluate(() => SDocs.saveCloudNow());
    let parsed = forms.findFormBlocks((await saved()).markdown)[0].parsed;
    expect(parsed.answers).toMatchObject({ decision: 'Ready', budget: 42.5, date: '2026-11-20', channels: ['Website'], owner: 'Ana' });
    expect(parsed.answers.notes).toContain('<script>literal</script>');
    expect(parsed.submissions).toHaveLength(0);
    await page.reload();
    await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('One line\nA second line <script>literal</script>');
    await page.getByRole('button', { name: 'Submit review', exact: true }).click();
    await expect.poll(async () => forms.findFormBlocks((await saved()).markdown)[0].parsed.submissions.length).toBe(1);
    parsed = forms.findFormBlocks((await saved()).markdown)[0].parsed;
    expect(parsed.submissions[0].values.budget).toBe(42.5);
    await expect(page.getByLabel('Notes', { exact: true })).toBeEnabled();
    await page.reload();
    await expect(page.locator('.sdoc-form-button-saved')).toContainText('Cloud');
    expect((await saved()).markdown).toContain('Keep this paragraph.');
  } finally { await f.close(); }
});

test('independent Cloud form answers from stale readers merge by field', async ({ page }) => {
  const { f, doc, saved } = await setup(page, '# Review\n\n```form\n' + form + '\n```\n');
  const second = await page.context().newPage();
  try {
    await second.goto(f.origin + '/docs?cloud-document=' + doc.id);
    await page.getByLabel('Notes', { exact: true }).fill('From the first reader');
    await second.getByLabel('Budget', { exact: true }).fill('73');
    await page.evaluate(() => SDocs.saveCloudNow());
    await second.evaluate(() => SDocs.saveCloudNow());
    const state = forms.findFormBlocks((await saved()).markdown)[0].parsed;
    expect(state.answers.notes).toBe('From the first reader');
    expect(state.answers.budget).toBe(73);
  } finally { await second.close(); await f.close(); }
});

test('a failed form submission can be retried without duplicating the submission', async ({ page }) => {
  const { f, saved } = await setup(page, '# Review\n\n```form\n' + form + '\n```\n');
  try {
    await page.getByLabel('Ready', { exact: true }).check();
    await page.getByLabel('Notes', { exact: true }).fill('Keep these answers');
    await page.evaluate(() => SDocs.saveCloudNow());
    await page.route('**/revisions', route => route.fulfill({ status:503, json:{ok:false,error:'temporary_service_failure'} }));
    await page.getByRole('button', { name:'Submit review', exact:true }).click();
    await expect(page.locator('.sdoc-form-button-saved')).toContainText('have not been saved');
    await expect(page.getByLabel('Notes', { exact:true })).toHaveValue('Keep these answers');
    expect(forms.findFormBlocks((await saved()).markdown)[0].parsed.submissions).toHaveLength(0);
    await page.unroute('**/revisions');
    await page.getByRole('button', { name:'Submit review', exact:true }).click();
    await expect.poll(async () => forms.findFormBlocks((await saved()).markdown)[0].parsed.submissions.length).toBe(1);
    await expect(page.locator('.sdoc-form-button-saved')).toContainText('Saved to Cloud');
  } finally { await f.close(); }
});

test('reader spreadsheet edits save raw values and formulas to their named source block', async ({ page }) => {
  const body = '# Costs\n\n```cells Costs\nformat: B=plain\nItem,Cost\nHosting,100\nTotal,=B2*2\n```\n\nKeep the footer.\n';
  const { f, saved } = await setup(page, body);
  try {
    await page.locator('.sdoc-cells-expand').click();
    const modal = page.locator('.sdoc-cells-focus');
    await modal.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').dblclick();
    await page.locator('.sdoc-cells-editor').fill('175');
    await page.locator('.sdoc-cells-editor').press('Enter');
    await page.evaluate(() => SDocs.saveCloudNow());
    expect((await saved()).markdown).toContain('Hosting,175');
    expect((await saved()).markdown).toContain('Total,=B2*2');
    expect((await saved()).markdown).toContain('```cells Costs\nformat: B=plain');
    expect((await saved()).markdown).toContain('Keep the footer.');
    await page.reload();
    await expect(page.locator('#_sd_rendered .sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveText('175');
  } finally { await f.close(); }
});

test('native and custom HTML app state is saved in the Cloud source and restored', async ({ page }) => {
  const { f, saved } = await setup(page, '# Planner\n\n```sdoc-app\n' + app + '\n```\n');
  try {
    const frame = page.frameLocator('.sdoc-app-frame');
    await frame.getByLabel('Hours', { exact: true }).fill('8');
    await frame.getByRole('button', { name: 'Count', exact: true }).click();
    await expect(frame.locator('#total')).toHaveText('1');
    let state = interactions.appState(interactions.fences((await saved()).markdown, 'sdoc-app')[0].content);
    expect(state).toMatchObject({ count: 1, inputs: { hours: '8' } });
    await page.reload();
    await expect(frame.getByLabel('Hours', { exact: true })).toHaveValue('8');
    await expect(frame.locator('#total')).toHaveText('1');
    await page.locator('.sdoc-app-expand').click();
    await expect(page.frameLocator('.sdoc-app-frame-fullscreen').getByLabel('Hours', { exact: true })).toHaveValue('8');
  } finally { await f.close(); }
});

test('a reader save commits an open cell draft before posting the Cloud revision', async ({ page }) => {
  const { f, saved } = await setup(page, '# Budget\n\n```cells\nItem,Value\nEstimate,10\n```\n');
  try {
    await page.locator('.sdoc-cells-expand').click();
    await page.locator('.sdoc-cells-focus .sdoc-cells-cell[data-r="1"][data-c="1"]').dblclick();
    await page.locator('.sdoc-cells-editor').fill('81');
    await page.evaluate(() => SDocs.saveCloudNow());
    expect((await saved()).markdown).toContain('Estimate,81');
  } finally { await f.close(); }
});

test('app messages cannot update another frame and markup-looking state stays inert', async ({ page }) => {
  const { f, saved } = await setup(page, '# Planner\n\n```sdoc-app\n' + app + '\n```\n');
  try {
    await page.frameLocator('.sdoc-app-frame').locator('#count').waitFor();
    const before = (await saved()).markdown;
    await page.evaluate(() => window.postMessage({type:'sdocs-app-state',token:document.querySelector('.sdoc-app-frame').dataset.sdocsAppToken,state:{intruder:true}}, '*'));
    await page.evaluate(() => SDocs.saveCloudNow());
    expect((await saved()).markdown).toBe(before);
    await page.frameLocator('.sdoc-app-frame').locator('body').evaluate(() => {
      SmallDocs.setState({literal:'</script><script>parent.__stateExecuted=true</script>'});
      return SmallDocs.save();
    });
    expect(await page.evaluate(() => window.__stateExecuted)).toBeUndefined();
    await page.reload();
    await expect(page.frameLocator('.sdoc-app-frame').locator('#count')).toBeVisible();
    expect(await page.evaluate(() => window.__stateExecuted)).toBeUndefined();
  } finally { await f.close(); }
});

test('chart settings in read mode trigger a Cloud save without another document edit', async ({ page }) => {
  const body = '# Chart\n\n```chart\n{"type":"bar","labels":["A"],"values":[3]}\n```\n';
  const { f, saved } = await setup(page, body);
  try {
    await page.locator('.chart-menu-btn').click();
    await page.locator('.chart-menu-input[data-field="title"]').fill('Saved title');
    await page.locator('.chart-menu-input[data-field="title"]').press('Tab');
    await expect.poll(async () => JSON.parse(interactions.fences((await saved()).markdown, 'chart')[0].content).title).toBe('Saved title');
    await page.reload();
    await expect.poll(() => page.evaluate(() => SDocs.currentBody)).toContain('"title": "Saved title"');
  } finally { await f.close(); }
});
