const { test, expect } = require('@playwright/test');
const BASE = process.env.SDOCS_TEST_BASE_URL || 'http://localhost:3000';

test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } });

async function mockSpeech(page, options = {}) {
  await page.route('**/sdocs-comment-speech-worker.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: `self.onmessage = function(event) {
      var m = event.data;
      if (m.type === 'load') setTimeout(function() { self.postMessage({type:'ready',id:m.id}); }, ${options.delay || 0});
      if (m.type === 'transcribe') self.postMessage({type:'result',id:m.id,text:'Check the production limit.'});
    };`,
  }));
}

test.beforeEach(async ({ page }) => { await mockSpeech(page); });

async function openComposer(page) {
  await page.goto(BASE + '/new');
  await page.waitForFunction(() => window.SDocs && window.SDocs.setMode);
  await page.evaluate(() => {
    SDocs.loadText('# Review\n\nThe production limit is ten minutes.');
    SDocs.setMode('comment');
  });
  await page.locator('.sdoc-gutter-add').last().evaluate(button => button.click());
  await expect(page.getByRole('button', { name: 'Dictate comment', exact: true })).toBeVisible();
  await page.locator('#_sd_comment-toolbar').evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)));
}

test('reading skips speech and comment mode preloads without requesting the microphone', async ({ page }) => {
  await page.addInitScript(() => {
    window.microphoneRequests = 0;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = options => { window.microphoneRequests++; return original(options); };
  });
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto(BASE + '/new');
  await page.waitForFunction(() => window.SDocs && window.SDocs.setMode);
  expect(requests.filter(url => /dictation|speech-worker|comment-speech|whisper/.test(url))).toEqual([]);
  await page.evaluate(() => SDocs.setMode('comment'));
  await page.waitForFunction(() => !!SDocs.commentDictation);
  expect(requests.some(url => url.includes('sdocs-comment-dictation.js'))).toBe(true);
  await expect(page.locator('#_sd_comment-voice-state')).toHaveText('Voice ready');
  expect(requests.some(url => url.includes('speech-worker'))).toBe(true);
  expect(await page.evaluate(() => window.microphoneRequests)).toBe(0);
});

test('dictation fills the composer without saving or changing the document', async ({ page }) => {
  await mockSpeech(page);
  await openComposer(page);
  const input = page.locator('.sdoc-card-edit .sdoc-card-input');
  await input.fill('Please review: ');
  await input.evaluate(el => el.setSelectionRange(el.value.length, el.value.length));
  await page.getByRole('button', { name: 'Dictate comment', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible();
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: 'Stop dictation', exact: true }).click();
  await expect(input).toHaveValue('Please review: Check the production limit.');
  expect(await page.evaluate(() => SDocs.currentMeta.comments || [])).toEqual([]);
  expect(await page.evaluate(() => SDocs.currentBody)).toContain('ten minutes');
  await page.locator('.sdoc-card-edit .sdoc-card-save').click();
  expect(await page.evaluate(() => SDocs.currentMeta.comments[0].text)).toBe('Please review: Check the production limit.');
});

test('releasing while microphone permission is pending never starts a late recording', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = options => new Promise(resolve => {
      window.allowMicrophone = async () => { const stream = await original(options); window.dictationTracks = stream.getTracks(); resolve(stream); };
    });
  });
  await openComposer(page);
  const input = await page.locator('.sdoc-card-edit .sdoc-card-input').boundingBox();
  await page.mouse.move(input.x + 20, input.y + 20);
  await page.mouse.down();
  await page.waitForFunction(() => !!window.allowMicrophone);
  await page.mouse.up();
  await page.evaluate(() => window.allowMicrophone());
  await expect(page.locator('.sdoc-dictation-status')).toHaveText('Microphone ready. Hold again to speak.');
  expect(await page.evaluate(() => window.dictationTracks.every(track => track.readyState === 'ended'))).toBe(true);
  await expect(page.locator('.sdoc-card-edit .sdoc-card-input')).toHaveValue('');
});

test('closing the composer stops every microphone track', async ({ page }) => {
  await mockSpeech(page);
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => { const stream = await original(options); window.dictationTracks = stream.getTracks(); return stream; };
  });
  await openComposer(page);
  await page.getByRole('button', { name: 'Dictate comment', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible();
  await page.locator('.sdoc-card-edit .sdoc-card-cancel').click();
  await expect.poll(() => page.evaluate(() => window.dictationTracks.every(track => track.readyState === 'ended'))).toBe(true);
});

test('leaving comment mode stops the microphone and releases its worker', async ({ page }) => {
  await mockSpeech(page);
  await page.addInitScript(() => {
    window.speechWorkersTerminated = 0;
    const terminate = Worker.prototype.terminate;
    Worker.prototype.terminate = function () { window.speechWorkersTerminated++; return terminate.call(this); };
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => { const stream = await original(options); window.dictationTracks = stream.getTracks(); return stream; };
  });
  await openComposer(page);
  await page.getByRole('button', { name: 'Dictate comment', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible();
  await page.evaluate(() => SDocs.setMode('read'));
  expect(await page.evaluate(() => window.dictationTracks.every(track => track.readyState === 'ended'))).toBe(true);
  expect(await page.evaluate(() => window.speechWorkersTerminated)).toBe(1);
});

test('microphone permission failure leaves typing and save available', async ({ page }) => {
  await mockSpeech(page);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  await openComposer(page);
  await page.getByRole('button', { name: 'Dictate comment', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Allow microphone access in your browser to speak.' })).toBeVisible();
  await page.locator('.sdoc-card-edit .sdoc-card-input').fill('Typed feedback');
  await page.locator('.sdoc-card-edit .sdoc-card-save').click();
  expect(await page.evaluate(() => SDocs.currentMeta.comments[0].text)).toBe('Typed feedback');
});

test('dictation uses the existing card layout at mobile widths', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openComposer(page);
  const card = page.locator('.sdoc-card-edit');
  const input = await card.locator('.sdoc-card-input').boundingBox();
  const mic = await card.getByRole('button', { name: 'Dictate comment', exact: true }).boundingBox();
  const save = await card.getByRole('button', { name: 'Save', exact: true }).boundingBox();
  expect(mic.y).toBeGreaterThanOrEqual(input.y + input.height);
  expect(mic.x + mic.width).toBeLessThanOrEqual(save.x + 1);
  expect(mic.x + mic.width).toBeLessThanOrEqual(390);
});

test('code-only comment mode loads dictation and keeps its buttons clear of the text', async ({ page }) => {
  await page.goto(BASE + '/new');
  await page.waitForFunction(() => window.SDocs && SDocs.codeFocus);
  await page.evaluate(() => {
    SDocs.loadText('# Code review\n\n```js\nconst retryMinutes = 10;\n```');
    SDocs.codeFocus.open(document.querySelector('#_sd_rendered pre'), { comment: true });
  });
  await page.locator('.sdoc-cl-row[data-ln="0"] .sdoc-cc-add').evaluate(button => button.click());
  const mic = page.locator('.sdoc-cc-composer').getByRole('button', { name: 'Dictate comment', exact: true });
  await expect(mic).toBeVisible();
  const input = await page.locator('.sdoc-cc-composer .sdoc-cc-input').boundingBox();
  const box = await mic.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(input.y + input.height);
});

test('model download failure leaves the composer available for typing', async ({ page }) => {
  await page.route('**/sdocs-comment-speech-worker.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'self.onmessage = function(e) { self.postMessage({type:"error",id:e.data.id,message:"Offline"}); };',
  }));
  await openComposer(page);
  await expect(page.locator('#_sd_comment-voice-state')).toHaveText('Voice unavailable. You can type.');
  await expect(page.getByRole('button', { name: 'Dictate comment', exact: true })).toBeEnabled();
  await page.locator('.sdoc-card-edit .sdoc-card-input').fill('Typed feedback');
  await page.locator('.sdoc-card-edit .sdoc-card-save').click();
  expect(await page.evaluate(() => SDocs.currentMeta.comments[0].text)).toBe('Typed feedback');
});

test('holding the editor records until release without saving the comment', async ({ page }) => {
  await openComposer(page);
  const input = page.locator('.sdoc-card-edit .sdoc-card-input');
  const box = await input.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible();
  await page.waitForTimeout(350);
  await page.mouse.move(5, 5);
  await page.mouse.up();
  await expect(input).toHaveValue('Check the production limit.');
  await expect(page.locator('.sdoc-dictation-status')).toHaveText('Review the text before saving.');
  expect(await page.evaluate(() => SDocs.currentMeta.comments || [])).toEqual([]);
});

test('holding the paragraph tab opens one draft and records without a second click', async ({ page }) => {
  await page.goto(BASE + '/new');
  await page.waitForFunction(() => window.SDocs && SDocs.setMode);
  await page.evaluate(() => { SDocs.loadText('# Review\n\nThe production limit is ten minutes.'); SDocs.setMode('comment'); });
  await expect(page.locator('#_sd_comment-voice-state')).toHaveText('Voice ready');
  const host = page.locator('.sdoc-block-host').last();
  await host.hover();
  const box = await host.locator('.sdoc-gutter-add').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.mouse.down();
  await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible();
  await page.waitForTimeout(350);
  await page.mouse.up();
  await expect(page.locator('.sdoc-card-edit')).toHaveCount(1);
  await expect(page.locator('.sdoc-card-edit .sdoc-card-input')).toHaveValue('Check the production limit.');
  expect(await page.evaluate(() => SDocs.currentMeta.comments || [])).toEqual([]);
});

test('quick clicks and dragging text do not request the microphone', async ({ page }) => {
  await page.addInitScript(() => {
    window.microphoneRequests = 0;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = options => { window.microphoneRequests++; return original(options); };
  });
  await openComposer(page);
  const input = page.locator('.sdoc-card-edit .sdoc-card-input');
  await input.fill('A longer comment that I want to select and edit.');
  const box = await input.boundingBox();
  await input.click();
  await page.mouse.move(box.x + 5, box.y + 10); await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 10, { steps: 5 });
  await page.waitForTimeout(450); await page.mouse.up();
  expect(await page.evaluate(() => window.microphoneRequests)).toBe(0);
  await expect(input).toHaveValue('A longer comment that I want to select and edit.');
});

test('inline editing uses a growing multiline field and saves with Ctrl+Enter', async ({ page }) => {
  await openComposer(page);
  await page.locator('.sdoc-card-edit .sdoc-card-cancel').click();
  await page.evaluate(() => {
    const result = SDocComments.addSelectionComment(SDocs.currentMeta, { quote: 'production limit', block: 'p:0' }, { text: 'Please check this value.' });
    SDocs.currentMeta = result.meta; SDocs.syncAll('comment');
  });
  await page.locator('.sdoc-card-body').click();
  const input = page.locator('.sdoc-card-edit textarea.sdoc-card-input');
  await expect(input).toBeVisible();
  const initial = await input.boundingBox();
  expect(initial.width).toBeGreaterThan(300);
  const longComment = ('Please explain the production limit and its operational implications. ').repeat(20);
  await input.fill(longComment);
  const grown = await input.boundingBox();
  expect(grown.height).toBeGreaterThan(initial.height * 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => input.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  expect((await input.boundingBox()).width).toBeLessThan(390);
  await input.press('End'); await input.press('Enter');
  expect(await page.evaluate(() => SDocs.currentMeta.comments[0].text)).toBe('Please check this value.');
  await input.press('Control+Enter');
  expect(await page.evaluate(() => SDocs.currentMeta.comments[0].text)).toBe(longComment.trim());
});

test('saved inline cards match editor width and font, with one consistent footer', async ({ page }) => {
  await openComposer(page);
  await page.locator('.sdoc-card-edit .sdoc-card-cancel').click();
  await page.evaluate(() => {
    const result = SDocComments.addSelectionComment(SDocs.currentMeta, { quote: 'production limit', block: 'p:0' }, { text: 'First paragraph.\n\nA longer explanation of the operational implications of this value.' });
    SDocs.currentMeta = result.meta; SDocs.syncAll('comment');
  });
  const card = page.locator('.sdoc-card[data-c="c1"]');
  await expect(card.getByRole('button', { name: 'Add to comment by voice', exact: true })).toBeVisible();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const saved = await card.evaluate(el => {
      const body = el.querySelector('.sdoc-card-body');
      const buttons = [...el.querySelectorAll(':scope > .sdoc-comment-editor-actions > button')];
      return { width: el.getBoundingClientRect().width, parentWidth: el.parentElement.getBoundingClientRect().width,
        font: getComputedStyle(body).fontSize, lineHeight: getComputedStyle(body).lineHeight,
        buttonYs: buttons.map(b => b.getBoundingClientRect().y) };
    });
    expect(saved.width).toBeCloseTo(saved.parentWidth, 0);
    expect(Math.max(...saved.buttonYs) - Math.min(...saved.buttonYs)).toBeLessThan(1);
    await card.locator('.sdoc-card-body').click();
    const editing = await card.locator('textarea.sdoc-card-input').evaluate(el => ({ width: el.closest('.sdoc-card').getBoundingClientRect().width,
      font: getComputedStyle(el).fontSize, lineHeight: getComputedStyle(el).lineHeight }));
    expect(editing.width).toBeCloseTo(saved.width, 0);
    expect(editing.font).toBe(saved.font);
    expect(editing.lineHeight).toBe(saved.lineHeight);
    await card.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(card.locator('.sdoc-card-body')).toBeVisible();
  }
});

test('holding a saved comment microphone appends with one space and preserves its thread', async ({ page }) => {
  await openComposer(page);
  await page.locator('.sdoc-card-input').fill('First paragraph.\n\nLast word');
  await page.locator('.sdoc-card-save').click();
  await page.evaluate(() => {
    SDocs.currentMeta.comments[0].replies = [{id:'rp_1',author:'Reviewer',text:'Keep this discussion.',at:'2026-11-14T11:00:00Z'}];
    SDocs.syncAll('comment');
  });
  const before = await page.evaluate(() => JSON.parse(JSON.stringify(SDocs.currentMeta.comments[0])));
  const card = page.locator('.sdoc-card[data-c="c1"]');
  const mic = card.getByRole('button', { name: 'Add to comment by voice', exact: true });
  await expect(mic).toBeVisible();
  await mic.hover();
  const box = await mic.boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down();
  await expect(card.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible();
  await page.waitForTimeout(350); await page.mouse.up();
  await expect(card.locator('textarea.sdoc-card-input')).toHaveValue(before.text + ' Check the production limit.');
  expect(await page.evaluate(() => SDocs.currentMeta.comments[0])).toEqual(before);
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  const after = await page.evaluate(() => SDocs.currentMeta.comments[0]);
  expect(after.updated_at).toEqual(expect.any(String));
  expect(after).toEqual({ ...before, text: before.text + ' Check the production limit.', updated_at: after.updated_at });
  await expect(card.getByRole('button', { name: 'Add to comment by voice', exact: true })).toBeVisible();
  await expect(card.locator('.sdoc-card-body')).toHaveText(after.text);
});

test('canceling an appended transcript restores the saved card and supports another append', async ({ page }) => {
  await openComposer(page);
  await page.locator('.sdoc-card-input').fill('Keep the original wording.');
  await page.locator('.sdoc-card-save').click();
  const card = page.locator('.sdoc-card[data-c="c1"]');
  for (let attempt = 0; attempt < 2; attempt++) {
    await card.getByRole('button', { name: 'Add to comment by voice', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible();
    await page.waitForTimeout(350);
    await card.getByRole('button', { name: 'Stop dictation', exact: true }).click();
    await expect(card.locator('textarea.sdoc-card-input')).toHaveValue('Keep the original wording. Check the production limit.');
    await card.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(card.locator('.sdoc-card-body')).toBeVisible();
    await expect(card.locator('.sdoc-card-body')).toHaveText('Keep the original wording.');
    await expect(card.getByRole('button', { name: 'Add to comment by voice', exact: true })).toHaveCount(1);
  }
  expect(await page.evaluate(() => SDocs.currentMeta.comments[0].text)).toBe('Keep the original wording.');
});

test('completed comments fit their text while the editor keeps room for writing', async ({ page }) => {
  await openComposer(page);
  await page.locator('.sdoc-card-input').fill('A short note.');
  await page.locator('.sdoc-card-save').click();
  const card = page.locator('.sdoc-card[data-c="c1"]');
  await expect(card.locator('.sdoc-card-body')).toHaveText('A short note.');
  await expect(card.locator(':scope > .sdoc-card-author')).toBeHidden();
  const saved = await card.evaluate(el => {
    const body = el.querySelector('.sdoc-card-body');
    return { height: el.getBoundingClientRect().height, textHeight: body.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(body).lineHeight),
      gap: el.querySelector('.sdoc-comment-editor-actions').getBoundingClientRect().top - body.getBoundingClientRect().bottom };
  });
  expect(saved.textHeight).toBeCloseTo(saved.lineHeight, 0);
  expect(saved.gap).toBeLessThanOrEqual(9);
  await card.locator('.sdoc-card-body').click();
  const writingHeight = await card.locator('textarea').evaluate(el => el.getBoundingClientRect().height);
  expect(writingHeight).toBeGreaterThan(saved.textHeight * 2);
});

test('author names appear when another person joins and hide again when their feedback is removed', async ({ page }) => {
  await openComposer(page);
  await page.locator('.sdoc-card-input').fill('Initial feedback.');
  await page.locator('.sdoc-card-save').click();
  await expect(page.locator('.sdoc-card[data-c="c1"] > .sdoc-card-author')).toBeHidden();
  await page.evaluate(() => {
    SDocs.currentMeta.comments[0].author = 'Alice';
    SDocs.currentMeta.comments[0].author_user_id = 'alice';
    SDocs.currentMeta.comments[0].replies = [{id:'rp_1',author:'Bob',author_user_id:'bob',text:'A second perspective.'}];
    SDocs.syncAll('comment');
  });
  const card = page.locator('.sdoc-card[data-c="c1"]');
  await expect(card.locator(':scope > .sdoc-card-author')).toBeVisible();
  await expect(card.locator('.sdoc-thread-reply .sdoc-card-author')).toBeVisible();
  await page.evaluate(() => { delete SDocs.currentMeta.comments[0].replies; SDocs.syncAll('comment'); });
  await expect(card.locator(':scope > .sdoc-card-author')).toBeHidden();
  await page.evaluate(() => {
    SDocs.currentMeta = SDocComments.addBlockComment(SDocs.currentMeta, {block:'p:0'}, {author:'Bob',text:'Separate feedback.'}).meta;
    SDocs.syncAll('comment');
  });
  await expect(card.locator(':scope > .sdoc-card-author')).toBeVisible();
  await expect(page.locator('.sdoc-card[data-c="c2"] > .sdoc-card-author')).toBeVisible();
});

test('one account keeps a single-author layout when its display name changes', async ({ page }) => {
  await openComposer(page);
  await page.locator('.sdoc-card-input').fill('Initial feedback.');
  await page.locator('.sdoc-card-save').click();
  await page.evaluate(() => {
    Object.assign(SDocs.currentMeta.comments[0], { author:'Alice',author_user_id:'alice',replies:[{id:'rp_1',author:'Alice Smith',author_user_id:'alice',text:'More context.'}] });
    SDocs.syncAll('comment');
  });
  const card = page.locator('.sdoc-card[data-c="c1"]');
  await expect(card.locator(':scope > .sdoc-card-author')).toBeHidden();
  await expect(card.locator('.sdoc-thread-reply .sdoc-card-author')).toBeHidden();
  await expect(card.locator('.sdoc-thread-reply-text')).toHaveText('More context.');
});
