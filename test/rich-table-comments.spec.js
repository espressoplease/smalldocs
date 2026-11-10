const { test, expect } = require('@playwright/test');
const { project } = require('../lib/cloud-comment-context');
const BASE = process.env.SDOCS_TEST_BASE_URL || 'http://localhost:3000';

async function load(page, body) {
  await page.goto(BASE + '/docs');
  await page.waitForFunction(() => window.SDocs?.commentsUi);
  await page.evaluate(body => {
    window.SDocs.loadText(body);
    window.SDocs.setMode('comment');
    window.SDocs.setAllSectionsOpen(true);
  }, body);
  await expect(page.locator('.sdoc-table-host')).toHaveCount(1);
}
async function save(page, control, text) {
  const target = control.locator('..');
  await target.hover();
  await control.click();
  const draft = page.locator('.sdoc-table-card.sdoc-card-edit');
  await draft.locator('.sdoc-card-input').fill(text);
  await draft.locator('.sdoc-card-save').click();
  await expect(page.locator('.sdoc-card-body').filter({ hasText: text })).toHaveCount(1);
  return page.evaluate(() => window.SDocs.currentMeta.comments.at(-1).id);
}
async function replaceBody(page, body) {
  await page.evaluate(body => {
    window.SDocs.currentBody = body;
    window.SDocs.render();
    window.SDocs.setAllSectionsOpen(true);
  }, body);
}
const rows = '| Name | Status |\n|---|---|\n| API | Open |\n| API v2 | Ready |\n';

test('a deleted row cannot transfer its comment to another row whose name has the same prefix', async ({ page }) => {
  await load(page, rows);
  const id = await save(page, page.locator('.sdoc-table-row-add').first(), 'Keep this API row');
  await replaceBody(page, rows.replace('| API | Open |\n', ''));
  await expect(page.locator('.sdoc-card[data-c="' + id + '"].sdoc-card-orphaned')).toHaveCount(1);
  await expect(page.locator('tr.sdoc-table-row-commented')).toHaveCount(0);
});

test('distinct row names with shared prefixes survive unrelated prose edits', async ({ page }) => {
  await load(page, rows);
  const id = await save(page, page.locator('.sdoc-table-row-add').first(), 'Keep API separate');
  await replaceBody(page, 'Inserted paragraph.\n\n' + rows);
  await expect(page.locator('.sdoc-card[data-c="' + id + '"].sdoc-card-orphaned')).toHaveCount(0);
  await expect(page.locator('tr.sdoc-table-row-commented')).toContainText('API');
  await expect(page.locator('tr.sdoc-table-row-commented')).not.toContainText('API v2');
});

test('a deleted column cannot transfer its comment to another header whose name has the same prefix', async ({ page }) => {
  const body = '| Name | Cost | Cost forecast |\n|---|---|---|\n| API | 10 | 20 |\n';
  await load(page, body);
  const id = await save(page, page.locator('.sdoc-table-column-add').nth(1), 'Check actual cost');
  await replaceBody(page, '| Name | Cost forecast |\n|---|---|\n| API | 20 |\n');
  await expect(page.locator('.sdoc-card[data-c="' + id + '"].sdoc-card-orphaned')).toHaveCount(1);
  await expect(page.locator('th.sdoc-table-column-commented')).toHaveCount(0);
});

test('full row evidence distinguishes duplicate first-column labels after an unrelated edit', async ({ page }) => {
  const body = '| Name | Region | Status |\n|---|---|---|\n| API | Europe | Open |\n| API | America | Ready |\n';
  await load(page, body);
  const id = await save(page, page.locator('.sdoc-table-row-add').nth(1), 'America only');
  await replaceBody(page, 'Inserted paragraph.\n\n' + body);
  await expect(page.locator('.sdoc-card[data-c="' + id + '"].sdoc-card-orphaned')).toHaveCount(0);
  await expect(page.locator('tr.sdoc-table-row-commented')).toContainText('America');
  await expect(page.locator('tr.sdoc-table-row-commented')).not.toContainText('Europe');
});

test('formatted table text and escaped pipes remain intact through cell feedback, reply, resolution and deletion', async ({ page }) => {
  const body = '| **Feature** | `State` | Notes |\n|---|---|---|\n| [API](https://example.org) | **Ready** | a \\| b |\n| Worker | Open | plain |\n';
  await load(page, body);
  const original = await page.locator('table').evaluate(table => ({
    rows: table.rows.length,
    values: Array.from(table.rows, row => Array.from(row.cells, cell => window.SDocs.commentsUi._cleanAnchorText(cell).trim())),
  }));
  const id = await save(page, page.locator('tbody tr').first().locator('td').nth(2).locator('.sdoc-table-cell-add'), 'Clarify the pipe');
  const card = page.locator('.sdoc-card[data-c="' + id + '"]');
  await expect(card).toContainText('Cell: API / Notes');
  expect(await card.evaluate(el => Boolean(el.closest('table')))).toBe(false);
  await card.getByRole('button', { name: 'Reply', exact: true }).click();
  await card.locator('.sdoc-thread-composer textarea').fill('The separator is literal.');
  await card.getByRole('button', { name: 'Save reply' }).click();
  await expect(card).toContainText('The separator is literal.');
  await card.getByRole('button', { name: 'Resolve comment' }).click();
  await expect(card).toHaveClass(/sdoc-thread-resolved/);
  await card.getByRole('button', { name: 'Reopen comment' }).click();
  await expect(card).not.toHaveClass(/sdoc-thread-resolved/);
  await card.getByRole('button', { name: 'Delete comment' }).click();
  await expect(card).toHaveCount(0);
  expect(await page.locator('table').evaluate(table => ({
    rows: table.rows.length,
    values: Array.from(table.rows, row => Array.from(row.cells, cell => window.SDocs.commentsUi._cleanAnchorText(cell).trim())),
  }))).toEqual(original);
  expect(await page.evaluate(() => window.SDocs.currentBody)).toBe(body);
});

test('wide-table controls are clickable after horizontal scroll on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await load(page, '| Feature | Region | Ownership | Long status detail |\n|---|---|---|---|\n| API | Europe | Maya | Waiting for release approval |\n| Worker | America | Sam | Ready for validation |\n');
  const scroll = page.locator('.sdoc-table-host > .md-table-scroll');
  await scroll.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  const control = page.locator('tbody tr').nth(1).locator('td').last().locator('.sdoc-table-cell-add');
  const id = await save(page, control, 'Check this release status');
  const card = page.locator('.sdoc-card[data-c="' + id + '"]');
  await expect(card).toContainText('Cell: Worker / Long status detail');
  const geometry = await card.boundingBox();
  expect(geometry.x).toBeGreaterThanOrEqual(0);
  expect(geometry.x + geometry.width).toBeLessThanOrEqual(391);
  await card.getByRole('button', { name: 'Delete comment' }).click();
  await expect(page.locator('table')).toHaveCount(1);
});

test('a cell correction keeps feedback attached to the same row and header', async ({ page }) => {
  await load(page, rows);
  const id = await save(page, page.locator('tbody tr').first().locator('td').nth(1).locator('.sdoc-table-cell-add'), 'Change Open to Approved');
  await replaceBody(page, rows.replace('| API | Open |', '| API | Approved |'));
  await expect(page.locator('.sdoc-card[data-c="' + id + '"].sdoc-card-orphaned')).toHaveCount(0);
  await expect(page.locator('td.sdoc-table-cell-commented')).toHaveText('Approved');
  await expect(page.locator('td.sdoc-table-cell-commented').locator('..')).toContainText('API');
});

test('table target evidence and discussion round-trip through portable copy and YAML', async ({ page }) => {
  const body = '| Name | Region | Status |\n|---|---|---|\n| API | Europe | Open |\n| API | America | Ready |\n';
  await load(page, body);
  const id = await save(page, page.locator('.sdoc-table-row-add').nth(1), 'America only');
  const evidence = await page.evaluate(() => {
    const S = window.SDocs, C = window.SDocComments, Y = window.SDocYaml;
    const portable = C.serializeFootnotes(S.currentMeta, S.currentBody);
    const copied = C.parseFootnotes(portable);
    const serialized = Y.serializeFrontMatter(S.currentMeta) + '\n' + S.currentBody;
    const parsed = Y.parseFrontMatter(serialized);
    const fromYaml = C.normalizeComment(parsed.meta.comments[0]);
    S.loadText(serialized);
    S.setMode('comment');
    return { portable: copied.comments[0], yaml: fromYaml, persisted: parsed.meta.comments[0], markdown: serialized };
  });
  expect(evidence.portable.row_cells).toEqual(['API', 'America', 'Ready']);
  expect(evidence.yaml.row_cells).toEqual(['API', 'America', 'Ready']);
  expect(project(evidence.markdown, [evidence.persisted], { context: 'snippet' })[0].anchor.match_status).toBe('exact');
  await replaceBody(page, 'Another paragraph.\n\n' + body);
  await expect(page.locator('.sdoc-card[data-c="' + id + '"].sdoc-card-orphaned')).toHaveCount(0);
  await expect(page.locator('tr.sdoc-table-row-commented')).toContainText('America');
});

test('an unchanged table keeps the selected duplicate row across unrelated prose edits', async ({ page }) => {
  const body = '| Name | Status |\n|---|---|\n| API | Open |\n| API | Open |\n';
  await load(page, body);
  const id = await save(page, page.locator('.sdoc-table-row-add').nth(1), 'The second identical row');
  await replaceBody(page, 'An unrelated paragraph was added.\n\n' + body);
  await expect(page.locator('.sdoc-card[data-c="' + id + '"].sdoc-card-orphaned')).toHaveCount(0);
  await expect(page.locator('tbody tr').nth(0)).not.toHaveClass(/sdoc-table-row-commented/);
  await expect(page.locator('tbody tr').nth(1)).toHaveClass(/sdoc-table-row-commented/);
  const saved = await page.evaluate(() => window.SDocYaml.serializeFrontMatter(window.SDocs.currentMeta) + '\n' + window.SDocs.currentBody);
  const Y = require('../cli/shared/sdocs-yaml');
  expect(project(saved, Y.parseFrontMatter(saved).meta.comments, { context: 'snippet' })[0].anchor.match_status).toBe('exact');
});

test('identical duplicate tables leave a target ambiguous after document changes', async ({ page }) => {
  const body = '| Name | Status |\n|---|---|\n| API | Open |\n| API | Open |\n';
  await load(page, body);
  const id = await save(page, page.locator('.sdoc-table-row-add').nth(1), 'The second row in the original table');
  await replaceBody(page, body + '\nA paragraph between tables.\n\n' + body);
  await expect(page.locator('.sdoc-card[data-c="' + id + '"].sdoc-card-orphaned')).toHaveCount(1);
  await expect(page.locator('tr.sdoc-table-row-commented')).toHaveCount(0);
  const saved = await page.evaluate(() => window.SDocYaml.serializeFrontMatter(window.SDocs.currentMeta) + '\n' + window.SDocs.currentBody);
  const Y = require('../cli/shared/sdocs-yaml');
  expect(project(saved, Y.parseFrontMatter(saved).meta.comments, { context: 'snippet' })[0].anchor.match_status).toBe('ambiguous');
});
