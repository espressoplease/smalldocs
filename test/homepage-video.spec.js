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
    const introHeight = await page.locator('.homepage-intro').evaluate(el => el.getBoundingClientRect().height);
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
    expect(heading.y - headingTop).toBeCloseTo(await page.locator('.homepage-intro').evaluate(el => el.getBoundingClientRect().height) - introHeight, 0);
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
    expect(Math.min(...buttons.map(box => box.x))).toBeCloseTo(screen.x, 0);
    expect(Math.max(...buttons.map(box => box.height)) - Math.min(...buttons.map(box => box.height))).toBeLessThan(0.5);
    const rows = new Map();
    for (const button of await preview.locator('.vid-controls > button:visible').all()) {
      const box = await button.boundingBox();
      const key = Math.round(box.y);
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(box);
    }
    for (const row of rows.values()) {
      expect(Math.min(...row.map(box => box.x))).toBeCloseTo(screen.x, 0);
    }
    const viewControls = await preview.locator('.vid-view-controls').boundingBox();
    const fullscreen = await page.getByRole('button', { name: 'Full screen', exact: true }).boundingBox();
    const collapse = await page.getByRole('button', { name: 'Collapse video', exact: true }).boundingBox();
    expect(viewControls.x + viewControls.width).toBeCloseTo(screen.x + screen.width, 0);
    expect(fullscreen.y).toBeCloseTo(collapse.y, 0);
    expect(fullscreen.x + fullscreen.width).toBeLessThan(collapse.x);
    expect(collapse.x + collapse.width).toBeCloseTo(viewControls.x + viewControls.width, 0);
    const chapters = preview.getByRole('navigation', { name: 'Video chapters' });
    await expect(chapters).toBeVisible();
    await expect(chapters.getByRole('button')).toHaveCount(10);
    await expect(chapters.locator('button svg[aria-hidden="true"]')).toHaveCount(10);
    await expect(page.locator('#chapBtn')).toBeHidden();
    for (const pill of await chapters.getByRole('button').all()) {
      const box = await pill.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(expanded.x);
      expect(box.x + box.width).toBeLessThanOrEqual(expanded.x + expanded.width);
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
  await expect(page.locator('#heroCap')).toContainText('SmallDocs is a tool');
  await expect(page.locator('#videocard')).toHaveClass(/ready/);
  expect(await video.evaluate(video => video.textTracks[0].mode)).toBe('hidden');
  await page.locator('#ccBtn').click(); await expect(page.locator('#heroCap')).toBeHidden();
  await page.locator('#ccBtn').click(); await expect(page.locator('#heroCap')).toBeVisible();
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  expect(await video.evaluate(video => video.muted)).toBe(true);
  await page.getByRole('button', { name: 'Back 10 seconds', exact: true }).click();
  expect(await video.evaluate(video => video.currentTime)).toBeLessThan(1);
  await page.getByRole('button', { name: 'Forward 10 seconds', exact: true }).click();
  await expect.poll(() => video.evaluate(video => video.currentTime)).toBeGreaterThanOrEqual(10);
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await expect(page.locator('#videocard')).not.toHaveClass(/is-scroll-docked/);
  await expect(page.locator('#chapBtn')).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Video chapters' }).getByRole('button')).toHaveCount(10);
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
  await expect(page.getByRole('navigation', { name: 'Video chapters' }).getByRole('button')).toHaveCount(10);
  await expect(page.locator('#chapBtn')).toBeHidden();
  await page.locator('#heroVid').evaluate(video => { video.pause(); video.currentTime = 1; });
  await expect(page.locator('#heroCap')).toContainText('SmallDocs is a tool');
});

test('chapter pills support keyboard seeking and follow the playing chapter', async ({ page }) => {
  // Keep the chapter inside the thirty-second media fixture.
  await page.route('**/public/homepage-video-demo.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('"t": 73.867', '"t": 10') });
  });
  await page.goto('/home-next');
  const nav = page.getByRole('navigation', { name: 'Video chapters' });
  await expect(nav).toBeHidden();
  await page.getByRole('button', { name: 'Play the SmallDocs demo', exact: true }).click();
  const why = nav.getByRole('button', { name: 'Why SmallDocs', exact: true });
  await why.focus(); await page.keyboard.press('Enter');
  await expect.poll(() => page.locator('#intro-video').evaluate(v => v.currentTime)).toBeGreaterThanOrEqual(10);
  await expect(why).toHaveAttribute('aria-current', 'step');
  expect(await page.locator('#intro-video').evaluate(v => v.paused)).toBe(false);
  await nav.getByRole('button', { name: 'Creating a SmallDoc', exact: true }).click();
  await expect.poll(() => page.locator('#intro-video').evaluate(v => v.currentTime)).toBeLessThan(2);
  await expect(why).not.toHaveAttribute('aria-current');
  await expect(nav.getByRole('button', { name: 'Creating a SmallDoc', exact: true })).toHaveAttribute('aria-current', 'step');
});

async function startScrollingDemo(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/home-next');
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: 'Play the SmallDocs demo', exact: true }).click();
  await expect.poll(() => page.locator('#intro-video').evaluate(video => !video.paused && video.currentTime > 0)).toBe(true);
  await page.locator('.homepage-small-video').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
  const origin = await page.locator('.homepage-small-video').evaluate(el => el.getBoundingClientRect().top + scrollY);
  await page.evaluate(() => { window.initialDemoElement = document.querySelector('#intro-video'); });
  return origin;
}

async function checkCaptionStability(page) {
  const layout = await page.evaluate(() => {
    const caption = document.getElementById('heroCap');
    const video = document.getElementById('intro-video');
    const cues = window.SDocsHomepageVideoConfig.cues;
    const original = cues[0].text;
    const before = { height: caption.getBoundingClientRect().height,
      heading: document.querySelector('h1').getBoundingClientRect().top + scrollY };
    const failures = [];
    for (const text of [...cues.map(cue => cue.text), 'doc', '']) {
      cues[0].text = text; video.dispatchEvent(new Event('timeupdate'));
      const box = caption.getBoundingClientRect(), span = caption.querySelector('span');
      const style = getComputedStyle(caption);
      const textHeight = box.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      if (Math.abs(box.height - before.height) > 1 ||
          Math.abs(document.querySelector('h1').getBoundingClientRect().top + scrollY - before.heading) > 1 ||
          span && (span.getBoundingClientRect().height > textHeight + 1 || span.scrollWidth > span.clientWidth)) {
        failures.push(text);
      }
    }
    cues[0].text = original; video.dispatchEvent(new Event('timeupdate'));
    return failures;
  });
  expect(layout).toEqual([]);
}

for (const width of [320, 390, 768, 1440]) {
  test('the caption bar joins the picture above the controls without moving the page at ' + width, async ({ page }) => {
    await startScrollingDemo(page, width);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.locator('#intro-video').evaluate(video => { video.currentTime = 1; });
    const caption = page.locator('#heroCap');
    await expect(caption).toContainText('SmallDocs is a tool');
    const screen = await page.locator('.vid-screen').boundingBox();
    const picture = await page.locator('.vid-picture').boundingBox();
    const controls = await page.locator('.vid-controls').boundingBox();
    const box = await caption.boundingBox();
    await expect(page.locator('.vid-screen > #heroCap')).toBeVisible();
    expect(box.y).toBeCloseTo(picture.y + picture.height, 0);
    expect(box.y + box.height).toBeLessThanOrEqual(screen.y + screen.height);
    expect(controls.y).toBeGreaterThanOrEqual(screen.y + screen.height + 9);
    expect(box.x + box.width / 2).toBeCloseTo(screen.x + screen.width / 2, 0);
    expect(await caption.evaluate(el => getComputedStyle(el).textAlign)).toBe('center');
    expect(await caption.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(
      await page.locator('.vid-chapter-pill[aria-current]').evaluate(el => getComputedStyle(el).backgroundColor));
    expect(await caption.evaluate(el => getComputedStyle(el).paddingTop)).toBe('0px');
    expect(await caption.evaluate(el => getComputedStyle(el).paddingBottom)).toBe('0px');
    await checkCaptionStability(page);
    const heading = await page.locator('h1').evaluate(el => el.getBoundingClientRect().top + scrollY);
    await page.locator('#ccBtn').click();
    await expect(caption).toBeHidden();
    expect(await page.locator('h1').evaluate(el => el.getBoundingClientRect().top + scrollY)).toBeCloseTo(heading, 0);
    await page.locator('#ccBtn').click();
    await expect(caption).toBeVisible();
  });
}

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 },
  { width: 844, height: 390 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
  test('fullscreen captions grow and keep every cue readable at ' + viewport.width + 'x' + viewport.height, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/home-next');
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole('button', { name: 'Play the SmallDocs demo', exact: true }).click();
    await expect.poll(() => page.locator('#intro-video').evaluate(v => v.currentTime)).toBeGreaterThan(0);
    await page.locator('#intro-video').evaluate(v => { v.pause(); v.currentTime = 1; });
    const caption = page.locator('#heroCap');
    await expect(caption).toContainText('SmallDocs is a tool');
    const fontSize = () => caption.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    const inlineSize = await fontSize();
    await page.getByRole('button', { name: 'Full screen', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    const chapters = page.getByRole('navigation', { name: 'Video chapters', includeHidden: true });
    await expect(chapters).toBeHidden();
    await expect(chapters).toHaveAttribute('aria-hidden', 'true');
    await expect.poll(() => chapters.evaluate(el => el.getBoundingClientRect().height)).toBe(0);
    await expect.poll(fontSize).toBeGreaterThan(inlineSize);
    await caption.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
    await checkCaptionStability(page);
    if (viewport.width === 1280) {
      const firstSize = await fontSize();
      await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await page.getByRole('button', { name: 'Full screen', exact: true }).click();
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
      await expect.poll(fontSize).toBeGreaterThan(firstSize);
      await caption.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
      await checkCaptionStability(page);
    }
    await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await expect(page.locator('#videocard')).not.toHaveClass(/is-scroll-docked/);
    await expect.poll(fontSize).toBe(inlineSize);
    await expect(chapters).toBeVisible();
    await expect(chapters).toHaveAttribute('aria-hidden', 'false');
    await expect(chapters.getByRole('button')).toHaveCount(10);
  });
}

for (const width of [320, 390, 1440]) {
  test('scrolling keeps the same playing video and reading position, then restores the large player at ' + width, async ({ page }) => {
    const origin = await startScrollingDemo(page, width);
    const headingPosition = await page.locator('h1').evaluate(el => el.getBoundingClientRect().top + scrollY);
    const time = await page.locator('#intro-video').evaluate(video => video.currentTime);
    await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), origin + 320);
    await expect(page.locator('#videocard')).toHaveClass(/is-scroll-docked/);
    await expect.poll(() => page.locator('#videocard').evaluate(el => el.style.getPropertyValue('--dock-progress'))).toBe('1');
    const screen = await page.locator('.vid-screen').boundingBox();
    const controls = await page.locator('.vid-toolbar').boundingBox();
    expect(screen.y).toBeCloseTo(width <= 600 ? 8 : 12, 0);
    expect(screen.width).toBeLessThanOrEqual(240);
    expect(controls.x).toBeGreaterThan(screen.x + screen.width);
    expect(controls.x + controls.width).toBeLessThanOrEqual(width);
    expect(await page.locator('h1').evaluate(el => el.getBoundingClientRect().top + scrollY)).toBeCloseTo(headingPosition, 0);
    expect(await page.evaluate(() => window.initialDemoElement === document.querySelector('#intro-video'))).toBe(true);
    expect(await page.locator('#intro-video').evaluate(video => video.currentTime)).toBeGreaterThanOrEqual(time);
    expect(await page.locator('#intro-video').evaluate(video => video.paused)).toBe(false);
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await expect(page.locator('#videocard')).not.toHaveClass(/is-scroll-docked/);
    expect(await page.locator('.vid-screen').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(screen.width);
    expect(await page.locator('#intro-video').evaluate(video => video.paused)).toBe(false);
    expect(await page.locator('.homepage-small-video').evaluate(el => el.style.height)).toBe('');
  });
}

test('scrolling progressively shrinks the video without moving the document', async ({ page }) => {
  const origin = await startScrollingDemo(page, 1440);
  const heading = await page.locator('h1').evaluate(el => el.getBoundingClientRect().top + scrollY);
  const widths = [];
  for (const distance of [20, 80, 160, 260]) {
    await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), origin + distance);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    widths.push(await page.locator('.vid-screen').evaluate(el => el.getBoundingClientRect().width));
    expect(await page.locator('h1').evaluate(el => el.getBoundingClientRect().top + scrollY)).toBeCloseTo(heading, 0);
  }
  for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThan(widths[i - 1]);
});

for (const width of [320, 390, 1440]) {
  test('docked captions keep their height and return below the video at ' + width, async ({ page }) => {
    const origin = await startScrollingDemo(page, width);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.locator('#intro-video').evaluate(video => { video.currentTime = 1; });
    await expect(page.locator('#heroCap')).toContainText('SmallDocs is a tool');
    await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), origin + 400);
    const caption = page.locator('#heroCap');
    await expect(page.locator('.vid-toolbar #heroCap')).toBeVisible();
    await expect(page.locator('.vid-screen #heroCap')).toHaveCount(0);
    const screen = await page.locator('.vid-screen').boundingBox();
    const controls = await page.locator('.vid-controls').boundingBox();
    const box = await caption.boundingBox();
    expect(box.x).toBeGreaterThan(screen.x + screen.width);
    expect(box.y).toBeGreaterThanOrEqual(controls.y + controls.height + 9);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.x + box.width).toBeCloseTo(controls.x + controls.width, 0);
    expect(await caption.evaluate(el => getComputedStyle(el).textAlign)).toBe('left');
    expect(await caption.locator('span').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    expect(await caption.locator('span').evaluate(el => getComputedStyle(el).color)).toBe('rgb(27, 24, 21)');
    await checkCaptionStability(page);
    await expect.poll(async () => {
      const cap = await caption.boundingBox(), card = await page.locator('#videocard').boundingBox();
      return card.y + card.height >= cap.y + cap.height - 1;
    }).toBe(true);
    expect(await caption.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const withCaptions = await page.locator('#videocard').evaluate(el => el.getBoundingClientRect().height);
    const heading = await page.locator('h1').evaluate(el => el.getBoundingClientRect().top + scrollY);
    await page.locator('#ccBtn').click();
    await expect(caption).toBeHidden();
    expect(await page.locator('#videocard').evaluate(el => el.getBoundingClientRect().height)).toBeCloseTo(withCaptions, 0);
    await page.locator('#ccBtn').click();
    await expect(caption).toBeVisible();
    expect(await page.locator('h1').evaluate(el => el.getBoundingClientRect().top + scrollY)).toBeCloseTo(heading, 0);
    if (width === 1440) {
      await page.getByRole('button', { name: 'Full screen', exact: true }).click();
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
      await expect(page.locator('#videocard')).not.toHaveClass(/is-scroll-docked/);
      await expect(page.locator('.vid-screen #heroCap')).toBeVisible();
      await caption.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
      const picture = await page.locator('.vid-picture').boundingBox();
      expect((await caption.boundingBox()).y).toBeCloseTo(picture.y + picture.height, 0);
      await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();
      await expect(page.locator('.vid-toolbar #heroCap')).toBeVisible();
    }
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await expect(page.locator('.vid-screen #heroCap')).toBeVisible();
    expect(await page.locator('#heroCap').count()).toBe(1);
    expect(await caption.locator('span').evaluate(el => getComputedStyle(el).color)).toBe('rgb(27, 24, 21)');
  });
}

test('docked controls keep pause, mute and chapters usable, and dismissal preserves the passage being read', async ({ page }) => {
  const origin = await startScrollingDemo(page, 390);
  await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), origin + 500);
  await expect.poll(() => page.locator('#videocard').evaluate(el => el.style.getPropertyValue('--dock-progress'))).toBe('1');
  await expect(page.locator('#videocard .vid-chapters')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect(await page.locator('#intro-video').evaluate(video => video.paused)).toBe(true);
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  expect(await page.locator('#intro-video').evaluate(video => video.muted)).toBe(true);
  await page.getByRole('button', { name: 'Chapters', exact: true }).click();
  const menu = await page.locator('#chapMenu').boundingBox();
  expect(menu.y).toBeGreaterThanOrEqual(0);
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(390);
  expect(menu.y + menu.height).toBeLessThanOrEqual(900);
  await page.keyboard.press('Escape');
  await expect(page.locator('#chapMenu')).toBeHidden();
  const before = await page.locator('h1').evaluate(el => el.getBoundingClientRect().top);
  await page.getByRole('button', { name: 'Collapse video', exact: true }).click();
  await expect.poll(() => page.locator('.homepage-small-video').evaluate(el => el.style.height)).toBe('');
  expect(await page.locator('h1').evaluate(el => el.getBoundingClientRect().top)).toBeCloseTo(before, 0);
  expect(await page.evaluate(() => document.documentElement.classList.contains('has-homepage-dock'))).toBe(false);
});

test('docked fullscreen and viewport changes retain playback and accessible controls', async ({ page }) => {
  const origin = await startScrollingDemo(page, 1440);
  await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), origin + 400);
  await expect(page.locator('#videocard')).toHaveClass(/is-scroll-docked/);
  await page.getByRole('button', { name: 'Full screen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await expect(page.locator('#videocard')).not.toHaveClass(/is-scroll-docked/);
  await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();
  await expect(page.locator('#videocard')).toHaveClass(/is-scroll-docked/);
  await page.setViewportSize({ width: 390, height: 900 });
  await expect.poll(() => page.locator('#videocard').evaluate(el => el.getBoundingClientRect().width)).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('#intro-video').evaluate(video => video.paused)).toBe(false);
});

test('reduced motion docks without interpolation and the muted teaser never docks', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/home-next');
  await page.evaluate(() => scrollTo({ top: 700, behavior: 'instant' }));
  await expect(page.locator('#videocard')).not.toHaveClass(/is-scroll-docked/);
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  const origin = await startScrollingDemo(page, 390);
  await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), origin);
  await expect.poll(() => page.locator('#videocard').evaluate(el => el.style.getPropertyValue('--dock-progress'))).toBe('1');
  expect(await page.locator('.vid-screen').evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
});
