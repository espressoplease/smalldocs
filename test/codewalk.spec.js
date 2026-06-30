// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Multi-file code walkthrough end-to-end (sdocs-codewalk* + the tabbed
 * fullscreen viewer). A walkthrough is `codewalk: true` front matter, one
 * `<pre data-file>` per file (stamped by the renderer override), and an ordered
 * annotation list that steps across the tabs. These tests drive the same data
 * path a `#md=` load would, then assert the tab strip, the on-card stepper, and
 * cross-tab navigation.
 */

// Build the document body the CLI emits, set the codewalk meta, render (so the
// renderer override stamps data-file), then open the walkthrough viewer.
async function openWalk(page, files, annotations) {
  await page.evaluate(({ files, annotations }) => {
    var body = files.map(function (f) {
      return '```' + f.lang + ' ' + f.name + '\n' + f.code + '\n```\n';
    }).join('\n');
    window.SDocs.currentBody = body;
    window.SDocs.currentMeta = {
      codewalk: true,
      files: files.map(function (f) { return f.name; }),
      annotations: annotations,
    };
    window.SDocs.render();
    window.SDocs.codeFocus.openWalkthrough();
  }, { files, annotations });
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
}

const TWO_FILES = [
  { name: 'app.py', lang: 'python', code: 'a = 1\nb = 2\nc = 3' },
  { name: 'util.py', lang: 'python', code: 'x = 9\ny = 8' },
];
// Walk order app→util→app, so step 2 lives in the other file.
const STEPS = [
  { file: 'app.py', line: 1, endLine: 1, text: 'we **start** here' },
  { file: 'util.py', line: 1, endLine: 1, text: 'over in util' },
  { file: 'app.py', line: 3, endLine: 3, text: 'back in app' },
];

const activePos = '.sdoc-ann-row.sdoc-cw-active .sdoc-cw-pos';
const activeNext = '.sdoc-ann-row.sdoc-cw-active .sdoc-cw-nav-btn[data-cw="next"]';
const activePrev = '.sdoc-ann-row.sdoc-cw-active .sdoc-cw-nav-btn[data-cw="prev"]';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() =>
    window.SDocs && window.SDocs.codeFocus && window.SDocs.codeFocus.openWalkthrough && window.SDocs.render);
});

test('opens as a tabbed walkthrough on the first step', async ({ page }) => {
  await openWalk(page, TWO_FILES, STEPS);
  await expect(page.locator('.sdoc-code-focus.has-cw-tabs')).toBeVisible();
  await expect(page.locator('.sdoc-cw-tab')).toHaveCount(2);
  await expect(page.locator('.sdoc-cw-tab.is-active')).toHaveText('app.py');
  // The first app.py card is the active step; markdown in the card renders.
  await expect(page.locator(activePos)).toHaveText('Step 1 of 3');
  await expect(page.locator('.sdoc-ann-row.sdoc-cw-active .sdoc-ann-card strong')).toHaveText('start');
  // app.py owns steps 1 and 3 → two cards on this tab.
  await expect(page.locator('.sdoc-ann-card')).toHaveCount(2);
});

test('a single annotated file is a walkthrough: stepper, no tab strip, command order', async ({ page }) => {
  await openWalk(page, [TWO_FILES[0]], [   // just app.py (lines a=1 / b=2 / c=3)
    { file: 'app.py', line: 3, endLine: 3, text: 'first by argument (line 3)' },
    { file: 'app.py', line: 1, endLine: 1, text: 'second by argument (line 1)' },
  ]);
  // One file: the stepper runs but there is no redundant tab strip.
  await expect(page.locator('.sdoc-cw-tab')).toHaveCount(0);
  await expect(page.locator('.sdoc-code-focus.has-cw-tabs')).toHaveCount(0);
  await expect(page.locator('.sdoc-cw-step')).toHaveCount(2);
  // Step 1 is the FIRST argument (line 3), not the lowest line number.
  await expect(page.locator(activePos)).toHaveText('Step 1 of 2');
  await expect(page.locator('.sdoc-ann-row.sdoc-cw-active .sdoc-ann-card')).toContainText('first by argument');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(activePos)).toHaveText('Step 2 of 2');
  await expect(page.locator('.sdoc-ann-row.sdoc-cw-active .sdoc-ann-card')).toContainText('second by argument');
});

test('Next on a card advances the step and hops to the step\'s file', async ({ page }) => {
  await openWalk(page, TWO_FILES, STEPS);
  await page.locator(activeNext).click();
  await expect(page.locator('.sdoc-cw-tab.is-active')).toHaveText('util.py');
  await expect(page.locator(activePos)).toHaveText('Step 2 of 3');
  // util.py owns only step 2 → exactly one card here (per-file scoping).
  await expect(page.locator('.sdoc-ann-card')).toHaveCount(1);
});

test('arrow keys walk forward and back across tabs', async ({ page }) => {
  await openWalk(page, TWO_FILES, STEPS);
  await page.keyboard.press('ArrowRight');           // 1 → 2 (util)
  await expect(page.locator('.sdoc-cw-tab.is-active')).toHaveText('util.py');
  await expect(page.locator(activePos)).toHaveText('Step 2 of 3');
  await page.keyboard.press('ArrowRight');           // 2 → 3 (app)
  await expect(page.locator('.sdoc-cw-tab.is-active')).toHaveText('app.py');
  await expect(page.locator(activePos)).toHaveText('Step 3 of 3');
  await page.keyboard.press('ArrowLeft');            // 3 → 2 (util)
  await expect(page.locator('.sdoc-cw-tab.is-active')).toHaveText('util.py');
  await expect(page.locator(activePos)).toHaveText('Step 2 of 3');
});

test('clicking a tab switches the file and shows only its annotations', async ({ page }) => {
  await openWalk(page, TWO_FILES, STEPS);
  await page.locator('.sdoc-cw-tab[data-cw-tab="util.py"]').click();
  await expect(page.locator('.sdoc-cw-tab.is-active')).toHaveText('util.py');
  await expect(page.locator('.sdoc-ann-card')).toHaveCount(1);
  await expect(page.locator('.sdoc-ann-card').first()).toContainText('over in util');
});

test('Prev is disabled on the first step, Next on the last', async ({ page }) => {
  await openWalk(page, TWO_FILES, STEPS);
  await expect(page.locator(activePrev)).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');           // to step 3 (last)
  await expect(page.locator(activePos)).toHaveText('Step 3 of 3');
  await expect(page.locator(activeNext)).toBeDisabled();
});

test('the jump pill persists on a cross-file step and clears on a same-file step or tab click', async ({ page }) => {
  // app → util → util: step 1→2 crosses, step 2→3 stays in util.py.
  const steps = [
    { file: 'app.py', line: 1, endLine: 1, text: 'a1' },
    { file: 'util.py', line: 1, endLine: 1, text: 'u1' },
    { file: 'util.py', line: 2, endLine: 2, text: 'u2' },
  ];
  await openWalk(page, TWO_FILES, steps);
  // Initial open is not a jump: no pill.
  await expect(page.locator('.sdoc-cw-jump-note')).toHaveCount(0);
  // Step 1 → 2 crosses into util.py: the pill appears and does NOT fade.
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.sdoc-cw-jump-note')).toContainText('util.py');
  await page.waitForTimeout(900);
  await expect(page.locator('.sdoc-cw-jump-note')).toContainText('util.py'); // still there
  // Step 2 → 3 stays in util.py: pressing next to a non-jump step clears it.
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(activePos)).toHaveText('Step 3 of 3');
  await expect(page.locator('.sdoc-cw-jump-note')).toHaveCount(0);
  // Step back across to app.py re-pills; a manual tab click then stays quiet.
  await page.keyboard.press('ArrowLeft');   // 3 → 2 (util, same file): no pill
  await page.keyboard.press('ArrowLeft');   // 2 → 1 (app: crosses): pill
  await expect(page.locator('.sdoc-cw-jump-note')).toContainText('app.py');
  await page.locator('.sdoc-cw-tab[data-cw-tab="util.py"]').click();
  await expect(page.locator('.sdoc-cw-jump-note')).toHaveCount(0);
});

test('each file block shows its own inline agent indicator (not just the first)', async ({ page }) => {
  // Render the walkthrough doc WITHOUT opening the viewer, then inspect the
  // reader's inline blocks: every file with annotations gets its own indicator.
  await page.evaluate(({ files, annotations }) => {
    var body = files.map(function (f) { return '```' + f.lang + ' ' + f.name + '\n' + f.code + '\n```\n'; }).join('\n');
    window.SDocs.currentBody = body;
    window.SDocs.currentMeta = { codewalk: true, files: files.map(function (f) { return f.name; }), annotations: annotations };
    window.SDocs.render();
  }, { files: TWO_FILES, annotations: STEPS });
  // Both app.py and util.py carry annotations → two indicators, one per block.
  await expect(page.locator('#_sd_rendered .agent-comment-btn')).toHaveCount(2);
});

test('restart returns to the first step, is disabled on step 1, and marked on the last', async ({ page }) => {
  await openWalk(page, TWO_FILES, STEPS); // app → util → app (3 steps)
  // On the first step there is nowhere to restart to.
  await expect(page.locator('.sdoc-ann-row.sdoc-cw-active .sdoc-cw-restart-btn')).toBeDisabled();
  // Walk to the last step.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(activePos)).toHaveText('Step 3 of 3');
  // The final card is tagged for the emphasised restart, and restart is live.
  await expect(page.locator('.sdoc-ann-row.sdoc-cw-active.sdoc-cw-last')).toHaveCount(1);
  const restart = page.locator('.sdoc-ann-row.sdoc-cw-active .sdoc-cw-restart-btn');
  await expect(restart).toBeEnabled();
  await restart.click();
  // Back to the beginning.
  await expect(page.locator(activePos)).toHaveText('Step 1 of 3');
  await expect(page.locator('.sdoc-cw-tab.is-active')).toHaveText('app.py');
});

test('a non-codewalk doc gets no data-file and no walkthrough', async ({ page }) => {
  const tabs = await page.evaluate(() => {
    window.SDocs.currentBody = '```python app.py\nx = 1\n```\n';
    window.SDocs.currentMeta = {}; // not a codewalk
    window.SDocs.render();
    const stamped = document.querySelectorAll('#_sd_rendered pre[data-file]').length;
    window.SDocs.codeFocus.openWalkthrough(); // should bail (no files)
    return { stamped, modal: !!document.querySelector('.sdoc-code-focus') };
  });
  expect(tabs.stamped).toBe(0);
  expect(tabs.modal).toBe(false);
});

test('a hostile filename cannot inject script into the tab strip or data-file', async ({ page }) => {
  await openWalk(page, [
    { name: 'a.py"><script>window.__pwned=1</script>', lang: 'python', code: 'p = 1' },
    { name: 'b.py', lang: 'python', code: 'q = 2' },
  ], [{ file: 'b.py', line: 1, endLine: 1, text: 'note' }]);
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  await expect(page.locator('.sdoc-cw-tabs script')).toHaveCount(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
});
