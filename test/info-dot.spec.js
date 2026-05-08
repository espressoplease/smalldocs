// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';
const SEEN_KEY = 'sdocs_notifications_seen_id';

// Wait until the notifications feed has loaded and rendered, so the dot
// state and the seeded localStorage value are both finalized.
async function waitForFeed(page) {
  await page.waitForSelector('#_sd_info-features li');
}

async function dotState(page) {
  return page.evaluate((key) => ({
    hasUnseen: document.getElementById('_sd_btn-info').classList.contains('has-unseen'),
    storedSeen: localStorage.getItem(key),
  }), SEEN_KEY);
}

test.describe('Info notification dot', () => {
  test('fresh visitor lands caught up: no dot, seen-id seeded to maxId', async ({ page }) => {
    await page.goto(BASE + '/');
    await waitForFeed(page);

    const state = await dotState(page);
    expect(state.hasUnseen).toBe(false);
    // Seed must be > 0 (current feed has maxId >= 1) and must be a real number.
    expect(state.storedSeen).not.toBeNull();
    expect(parseInt(state.storedSeen, 10)).toBeGreaterThan(0);
  });

  test('returning visitor with explicit seen=0 still sees the dot', async ({ page }) => {
    // First load establishes the origin so we can write localStorage.
    await page.goto(BASE + '/');
    await page.evaluate((key) => localStorage.setItem(key, '0'), SEEN_KEY);
    await page.reload();
    await waitForFeed(page);

    const state = await dotState(page);
    expect(state.hasUnseen).toBe(true);
    // Seeding must NOT clobber an explicit prior value.
    expect(state.storedSeen).toBe('0');
  });

  test('clicking the info button clears the dot', async ({ page }) => {
    await page.goto(BASE + '/');
    await page.evaluate((key) => localStorage.setItem(key, '0'), SEEN_KEY);
    await page.reload();
    await waitForFeed(page);

    expect((await dotState(page)).hasUnseen).toBe(true);

    await page.click('#_sd_btn-info');
    await page.waitForTimeout(100);

    const after = await dotState(page);
    expect(after.hasUnseen).toBe(false);
    expect(parseInt(after.storedSeen, 10)).toBeGreaterThan(0);
  });
});
