const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

for (const width of [320, 390, 768, 1440]) {
  test('small preview expands for playback and returns without moving the page at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/home-next');
    const preview = page.locator('.homepage-small-video');
    const play = page.getByRole('button', { name: 'Play 30-second preview', exact: true });
    const before = await preview.boundingBox();
    const headingTop = await page.locator('h1').evaluate(el => el.getBoundingClientRect().top);
    expect(before.width).toBeLessThanOrEqual(360);
    expect(await page.locator('#heroTeaser').evaluate(video => video.muted)).toBe(true);
    // Some browser policies forbid even muted autoplay. Keep the poster usable there.
    await expect.poll(() => page.locator('#heroTeaser').evaluate(video =>
      video.currentTime > 0 || (video.paused && video.dataset.previewBlocked === 'true'))).toBe(true);
    await play.click();
    const dialog = page.getByRole('dialog', { name: 'SmallDocs demo' });
    await expect(dialog).toBeVisible();
    await dialog.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    const expanded = await dialog.locator('.videocard').boundingBox();
    if (width > 620) expect(expanded.width).toBeGreaterThan(before.width * (width > 1000 ? 2.5 : 1.5));
    else {
      const box = await dialog.boundingBox();
      expect(box.width).toBeCloseTo(width, 0); expect(box.height).toBeCloseTo(900, 0);
    }
    await expect.poll(() => page.locator('#intro-video').evaluate(video => !video.paused && video.currentTime > 0)).toBe(true);
    expect(await page.locator('#intro-video').evaluate(video => video.muted)).toBe(false);
    expect(await page.locator('#heroTeaser').evaluate(video => video.paused)).toBe(true);
    for (const button of await dialog.locator('.vid-controls button:visible').all()) {
      const box = await button.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await dialog.getByRole('button', { name: 'Close video', exact: true }).click();
    await expect(dialog).not.toBeVisible();
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
  await page.getByRole('button', { name: 'Play 30-second preview', exact: true }).click();
  const video = page.locator('#intro-video');
  await expect.poll(() => video.evaluate(video => video.currentTime)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => video.evaluate(video => video.paused)).toBe(true);
  await video.evaluate(video => { video.currentTime = 1; });
  await expect(page.locator('#heroCap')).toContainText('build presentations');
  expect(await video.evaluate(video => video.textTracks[0].mode)).toBe('hidden');
  await page.locator('#ccBtn').click(); await expect(page.locator('#heroCap')).toBeHidden();
  await page.locator('#ccBtn').click(); await expect(page.locator('#heroCap')).toBeVisible();
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  expect(await video.evaluate(video => video.muted)).toBe(true);
  await page.getByRole('button', { name: 'Back 10 seconds', exact: true }).click();
  expect(await video.evaluate(video => video.currentTime)).toBeLessThan(1);
  await page.getByRole('button', { name: 'Forward 10 seconds', exact: true }).click();
  expect(await video.evaluate(video => video.currentTime)).toBeGreaterThanOrEqual(10);
  await expect(page.locator('#chapBtn')).toBeHidden();
  await page.getByRole('button', { name: 'Close video', exact: true }).click();
  expect(errors).toEqual([]);
});

test('keyboard focus stays inside the expanded player and Escape restores the preview', async ({ page }) => {
  await page.goto('/home-next');
  const play = page.getByRole('button', { name: 'Play 30-second preview', exact: true });
  await play.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  for (let index = 0; index < 10; index++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.closest('dialog') !== null)).toBe(true);
  }
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(play).toBeFocused();
});

test('reduced motion keeps the preview still while allowing deliberate playback', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/home-next');
  expect(await page.locator('#heroTeaser').evaluate(video => video.paused)).toBe(true);
  await page.getByRole('button', { name: 'Play 30-second preview', exact: true }).click();
  await expect.poll(() => page.locator('#intro-video').evaluate(video => !video.paused)).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible();
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
  const play = page.getByRole('button', { name: 'Play 30-second preview', exact: true });
  await expect(play).toBeVisible();
  expect(await page.locator('#intro-video').evaluate(video => video.paused)).toBe(true);
  await play.click();
  await expect.poll(() => page.locator('#intro-video').evaluate(video => !video.paused && video.currentTime > 0)).toBe(true);
});

test('a missing teaser leaves a deliberate play action rather than starting audio', async ({ page }) => {
  await page.route('**/home-next-demo.mp4*', route => route.abort());
  await page.goto('/home-next');
  const play = page.getByRole('button', { name: 'Play 30-second preview', exact: true });
  await expect(play).toBeVisible();
  expect(await page.locator('#intro-video').evaluate(video => video.paused)).toBe(true);
  await play.click(); await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('[data-video-status]')).toContainText('could not be loaded');
  await page.unroute('**/home-next-demo.mp4*');
  await play.click();
  await expect.poll(() => page.locator('#intro-video').evaluate(video => !video.paused && video.currentTime > 0)).toBe(true);
  await page.getByRole('button', { name: 'Close video', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
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
  await page.goto('/home-next'); const play = page.getByRole('button', { name: 'Play 30-second preview', exact: true });
  await play.click(); await expect(page.locator('#videocard')).toHaveClass(/needs-play/);
  await page.evaluate(() => { window.allowDemoPlayback = true; }); await play.click();
  await expect.poll(() => page.locator('#intro-video').evaluate(video => !video.paused)).toBe(true);
  await page.getByRole('button', { name: 'Full screen', exact: true }).click();
  await page.getByRole('button', { name: 'Close video', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible(); expect(errors).toEqual([]);
});

test('finishing the demo returns to the compact preview and allows another viewing', async ({ page }) => {
  await page.goto('/home-next'); const play = page.getByRole('button', { name: 'Play 30-second preview', exact: true });
  await play.click();
  await expect.poll(() => page.locator('#intro-video').evaluate(video => Number.isFinite(video.duration))).toBe(true);
  await page.locator('#intro-video').evaluate(video => { video.currentTime = video.duration - 0.1; });
  await expect(page.getByRole('dialog')).not.toBeVisible(); await expect(play).toBeVisible();
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
