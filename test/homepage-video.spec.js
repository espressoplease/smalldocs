const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

const stubDemo = require('./homepage-video-fixture');
test.beforeEach(async ({ page }) => { await stubDemo(page); });

for (const width of [320, 390, 768, 1440]) {
  test('playback grows from the same top-left corner to the text column width at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/home-next');
    const preview = page.locator('.homepage-small-video');
    const play = page.getByRole('button', { name: 'Play the SmallDocs demo', exact: true });
    const before = await preview.boundingBox();
    const headingTop = await page.locator('h1').evaluate(el => el.getBoundingClientRect().top);
    expect(before.width).toBeLessThanOrEqual(360);
    expect(await page.locator('#heroTeaser').evaluate(video => video.muted)).toBe(true);
    await expect.poll(() => page.locator('#heroTeaser').evaluate(video =>
      video.currentTime > 0 || (video.paused && video.dataset.previewBlocked === 'true'))).toBe(true);
    await play.click();
    await expect(preview).toHaveClass(/is-expanded/);
    const frames = await preview.evaluate(async element => {
      const positions = [];
      for (let i = 0; i < 24; i++) {
        await new Promise(requestAnimationFrame);
        const r = element.getBoundingClientRect(); positions.push({ x: r.x, y: r.y, width: r.width });
      }
      return positions;
    });
    for (const frame of frames) {
      expect(frame.x).toBeCloseTo(before.x, 0); expect(frame.y).toBeCloseTo(before.y, 0);
    }
    await preview.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    const expanded = await preview.boundingBox();
    const heading = await page.locator('h1').boundingBox();
    expect(expanded.x).toBeCloseTo(heading.x, 0);
    expect(expanded.width).toBeCloseTo(heading.width, 0);
    expect(heading.y - headingTop).toBeCloseTo(expanded.height - before.height, 0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => page.locator('#intro-video').evaluate(video => !video.paused && video.currentTime > 0)).toBe(true);
    expect(await page.locator('#intro-video').evaluate(video => video.muted)).toBe(false);
    expect(await page.locator('#heroTeaser').evaluate(video => video.paused)).toBe(true);
    const screen = await preview.locator('.vid-screen').boundingBox();
    const buttons = [];
    for (const button of await preview.locator('.vid-controls button:visible').all()) {
      const box = await button.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(expanded.x); expect(box.x + box.width).toBeLessThanOrEqual(expanded.x + expanded.width);
      expect(box.y).toBeGreaterThanOrEqual(screen.y + screen.height + 9);
      buttons.push(box);
    }
    expect(Math.max(...buttons.map(box => box.x + box.width))).toBeCloseTo(screen.x + screen.width, 0);
    expect(Math.max(...buttons.map(box => box.height)) - Math.min(...buttons.map(box => box.height))).toBeLessThan(0.5);
    const rows = new Map();
    for (const box of buttons) {
      const key = Math.round(box.y);
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(box);
    }
    for (const row of rows.values()) {
      expect(Math.max(...row.map(box => box.x + box.width))).toBeCloseTo(screen.x + screen.width, 0);
    }
    await page.getByRole('button', { name: 'Collapse video', exact: true }).click();
    await expect(preview).not.toHaveClass(/is-expanded/);
    await preview.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    expect(await preview.boundingBox()).toEqual(before);
    expect(await page.locator('h1').evaluate(el => el.getBoundingClientRect().top)).toBe(headingTop);
    expect(await page.locator('#intro-video').evaluate(video => video.paused)).toBe(true);
    await expect(play).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
  });
}

test('expanded player retains captions, mute, pause and bounded seeking', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/home-next');
  await page.getByRole('button', { name: 'Play the SmallDocs demo', exact: true }).click();
  const video = page.locator('#intro-video');
  await expect.poll(() => video.evaluate(video => video.currentTime)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => video.evaluate(video => video.paused)).toBe(true);
  await video.evaluate(video => { video.currentTime = 1; });
  await expect(page.locator('#heroCap')).toContainText('walk you through a demo');
  expect(await video.evaluate(video => video.textTracks[0].mode)).toBe('hidden');
  await page.locator('#ccBtn').click(); await expect(page.locator('#heroCap')).toBeHidden();
  await page.locator('#ccBtn').click(); await expect(page.locator('#heroCap')).toBeVisible();
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  expect(await video.evaluate(video => video.muted)).toBe(true);
  await page.getByRole('button', { name: 'Back 10 seconds', exact: true }).click();
  expect(await video.evaluate(video => video.currentTime)).toBeLessThan(1);
  await page.getByRole('button', { name: 'Forward 10 seconds', exact: true }).click();
  await expect.poll(() => video.evaluate(video => video.currentTime)).toBeGreaterThanOrEqual(10);
  await expect(page.locator('#chapBtn')).toBeVisible();
  await page.locator('#chapBtn').click();
  await expect(page.locator('#chapMenu [role="menuitem"]')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Collapse video', exact: true }).click();
  expect(errors).toEqual([]);
});

test('inline playback keeps the homepage available and Escape restores the preview', async ({ page }) => {
  await page.goto('/home-next');
  const play = page.getByRole('button', { name: 'Play the SmallDocs demo', exact: true });
  await play.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.homepage-small-video')).toHaveClass(/is-expanded/);
  const signup = page.getByRole('link', { name: 'Continue with Google', exact: true }).first();
  await signup.focus(); await expect(signup).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.homepage-small-video')).not.toHaveClass(/is-expanded/); await expect(play).toBeFocused();
});

test('reduced motion keeps the preview still while allowing deliberate playback', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/home-next');
  expect(await page.locator('#heroTeaser').evaluate(video => video.paused)).toBe(true);
  expect(await page.locator('.homepage-small-video').evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
  await page.getByRole('button', { name: 'Play the SmallDocs demo', exact: true }).click();
  await expect.poll(() => page.locator('#intro-video').evaluate(video => !video.paused)).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.locator('.homepage-small-video')).not.toHaveClass(/is-expanded/);
  expect(await page.locator('#heroTeaser').evaluate(video => video.paused)).toBe(true);
});

test('browser autoplay restrictions retain a working preview and deliberate playback', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      return this.id === 'heroTeaser' ? Promise.reject(new DOMException('Blocked by browser', 'NotAllowedError')) : original.call(this);
    };
  });
  await page.goto('/home-next');
  const play = page.getByRole('button', { name: 'Play the SmallDocs demo', exact: true });
  await expect(play).toBeVisible();
  expect(await page.locator('#intro-video').evaluate(video => video.paused)).toBe(true);
  await play.click();
  await expect.poll(() => page.locator('#intro-video').evaluate(video => !video.paused && video.currentTime > 0)).toBe(true);
});

test('a missing teaser leaves a deliberate play action rather than starting audio', async ({ page }) => {
  await page.route('**/homepage/demo-*.mp4*', route => route.abort());
  await page.goto('/home-next');
  const play = page.getByRole('button', { name: 'Play the SmallDocs demo', exact: true });
  await expect(play).toBeVisible();
  expect(await page.locator('#intro-video').evaluate(video => video.paused)).toBe(true);
  await play.click(); await expect(page.locator('.homepage-small-video')).toHaveClass(/is-expanded/);
  await expect(page.locator('[data-video-status]')).toContainText('could not be loaded');
  await page.unroute('**/homepage/demo-*.mp4*');
  await stubDemo(page);
  await play.click();
  await expect.poll(() => page.locator('#intro-video').evaluate(video => !video.paused && video.currentTime > 0)).toBe(true);
  await page.getByRole('button', { name: 'Collapse video', exact: true }).click();
  await expect(page.locator('.homepage-small-video')).not.toHaveClass(/is-expanded/);
});

test('blocked playback and fullscreen can be retried without losing the close action', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.id === 'intro-video' && !window.allowDemoPlayback) return Promise.reject(new Error('blocked'));
      return original.call(this);
    };
    HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error('denied'));
  });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/home-next'); const play = page.getByRole('button', { name: 'Play the SmallDocs demo', exact: true });
  await play.click(); await expect(page.locator('#videocard')).toHaveClass(/needs-play/);
  await page.evaluate(() => { window.allowDemoPlayback = true; }); await play.click();
  await expect.poll(() => page.locator('#intro-video').evaluate(video => !video.paused)).toBe(true);
  await page.getByRole('button', { name: 'Full screen', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse video', exact: true }).click();
  await expect(page.locator('.homepage-small-video')).not.toHaveClass(/is-expanded/); expect(errors).toEqual([]);
});

test('finishing the demo returns to the compact preview and allows another viewing', async ({ page }) => {
  await page.goto('/home-next'); const play = page.getByRole('button', { name: 'Play the SmallDocs demo', exact: true });
  await play.click();
  await expect.poll(() => page.locator('#intro-video').evaluate(video => Number.isFinite(video.duration))).toBe(true);
  await page.locator('#intro-video').evaluate(video => { video.currentTime = video.duration - 0.1; });
  await expect(page.locator('.homepage-small-video')).not.toHaveClass(/is-expanded/); await expect(play).toBeVisible();
  await play.click(); await expect.poll(() => page.locator('#intro-video').evaluate(video => !video.paused)).toBe(true);
  expect(await page.locator('#intro-video').evaluate(video => video.currentTime)).toBeLessThan(3);
});

test('the existing full-length player uses the shared controls and chapter transcript', async ({ page }) => {
  await page.route('**/homepage/demo-*.mp4', route => route.fulfill({ path: require('path').join(__dirname, '../public/homepage/home-next-demo.mp4'), contentType: 'video/mp4' }));
  await page.goto('/home');
  await page.getByRole('button', { name: 'Play the SmallDocs demo', exact: true }).click();
  await expect.poll(() => page.locator('#heroVid').evaluate(video => !video.paused)).toBe(true);
  await page.locator('#chapBtn').click(); await expect(page.locator('#chapMenu')).toBeVisible();
  await expect(page.locator('#chapMenu [role="menuitem"]')).toHaveCount(6);
  await page.keyboard.press('Escape'); await expect(page.locator('#chapMenu')).toBeHidden();
  await page.locator('#heroVid').evaluate(video => { video.pause(); video.currentTime = 1; });
  await expect(page.locator('#heroCap')).toContainText('walk you through a demo');
});
