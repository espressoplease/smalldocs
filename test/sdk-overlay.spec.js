// @ts-check
const { test, expect } = require('@playwright/test');

async function loadOverlayModule(page) {
  await page.goto('/developers/example');
  await page.setContent(`<!doctype html><html style="overflow:clip!important"><body style="overflow:scroll">
    <button id="opener">Open</button>
    <div style="height:2000px"></div>
  </body></html>`);
  await page.evaluate(async () => {
    window.overlayApi = await import('/sdk/0.2.0/overlay.js?overlay-spec=' + Math.random());
    window.ownerA = { id: 'owner-a' };
    window.ownerB = { id: 'owner-b' };
    window.overlayEvents = [];
  });
}

test.beforeEach(async ({ page }) => {
  await loadOverlayModule(page);
});

test('generic overlays retain their wrapper, controls, Escape and focus behavior', async ({ page }) => {
  await page.locator('#opener').focus();
  await page.evaluate(() => {
    window.generic = window.overlayApi.openOverlay(window.ownerA, {
      label: 'Expanded chart',
      title: 'Chart',
      actions(actions) {
        const action = document.createElement('button');
        action.textContent = 'Download';
        actions.appendChild(action);
      },
      onClose(reason) {
        window.overlayEvents.push(['closed', reason]);
      },
    });
  });

  await expect(page.getByRole('dialog', { name: 'Expanded chart' })).toBeVisible();
  await expect(page.locator('.smalldocs-overlay-bar')).toContainText('Chart');
  await expect(page.locator('.smalldocs-overlay-actions')).toContainText('DownloadClose');
  await expect(page.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.smalldocs-overlay')).toHaveCount(0);
  await expect(page.locator('#opener')).toBeFocused();
  expect(await page.evaluate(() => window.overlayEvents)).toEqual([['closed', 'user']]);
});

test('custom leases arbitrate owners and preserve the original host state', async ({ page }) => {
  await page.locator('#opener').focus();
  await page.evaluate(() => {
    function surface(id) {
      const node = document.createElement('section');
      node.id = id;
      node.setAttribute('role', 'dialog');
      const button = document.createElement('button');
      button.textContent = id + ' action';
      node.appendChild(button);
      return { node, button };
    }
    const first = surface('surface-a');
    window.leaseA = window.overlayApi.openOverlayLease(window.ownerA, {
      surface: first.node,
      initialFocus: first.button,
      beforeClose(reason) {
        window.overlayEvents.push(['before-a', reason, first.node.isConnected]);
      },
      onClose(reason) {
        window.overlayEvents.push(['after-a', reason, first.node.isConnected]);
      },
    });
    const second = surface('surface-b');
    window.leaseB = window.overlayApi.openOverlayLease(window.ownerB, {
      surface: second.node,
      initialFocus: second.button,
      beforeClose(reason) {
        window.overlayEvents.push(['before-b', reason, second.node.isConnected]);
      },
      onClose(reason) {
        window.overlayEvents.push(['after-b', reason, second.node.isConnected]);
      },
    });
  });

  await expect(page.locator('#surface-a')).toHaveCount(0);
  await expect(page.locator('#surface-b')).toBeVisible();
  expect(await page.evaluate(() => ({
    html: document.documentElement.style.overflow,
    body: document.body.style.overflow,
    events: window.overlayEvents,
    staleClose: window.leaseA.close('user'),
  }))).toEqual({
    html: 'hidden',
    body: 'hidden',
    events: [
      ['before-a', 'superseded', true],
      ['after-a', 'superseded', false],
    ],
    staleClose: false,
  });

  expect(await page.evaluate(() => window.overlayApi.closeActiveOverlay(
    window.ownerA,
    'update',
    { restoreFocus: false },
  ))).toBe(false);
  expect(await page.evaluate(() => window.overlayApi.closeActiveOverlay(
    window.ownerA,
    'destroy',
    { restoreFocus: false },
  ))).toBe(false);
  await expect(page.locator('#surface-b')).toBeVisible();

  expect(await page.evaluate(() => window.leaseB.close('update', { restoreFocus: false }))).toBe(true);
  expect(await page.evaluate(() => window.leaseB.close('destroy', { restoreFocus: false }))).toBe(false);
  await expect(page.locator('#surface-b')).toHaveCount(0);
  expect(await page.evaluate(() => ({
    html: document.documentElement.style.overflow,
    body: document.body.style.overflow,
    htmlPriority: document.documentElement.style.getPropertyPriority('overflow'),
    bodyPriority: document.body.style.getPropertyPriority('overflow'),
    active: document.activeElement && document.activeElement.id,
    events: window.overlayEvents,
  }))).toEqual({
    html: 'clip',
    body: 'scroll',
    htmlPriority: 'important',
    bodyPriority: '',
    active: '',
    events: [
      ['before-a', 'superseded', true],
      ['after-a', 'superseded', false],
      ['before-b', 'update', true],
      ['after-b', 'update', false],
    ],
  });
});

test('custom lease restores focus only for a user close', async ({ page }) => {
  await page.locator('#opener').focus();
  await page.evaluate(() => {
    const surface = document.createElement('section');
    surface.id = 'surface';
    const button = document.createElement('button');
    button.textContent = 'Inside';
    surface.appendChild(button);
    window.lease = window.overlayApi.openOverlayLease(window.ownerA, {
      surface,
      initialFocus: button,
      beforeClose(reason) {
        window.overlayEvents.push(['before', reason, surface.isConnected]);
      },
      onClose(reason) {
        window.overlayEvents.push(['after', reason, surface.isConnected]);
      },
    });
  });

  await expect(page.getByRole('button', { name: 'Inside' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#surface')).toHaveCount(0);
  await expect(page.locator('#opener')).toBeFocused();
  expect(await page.evaluate(() => window.overlayEvents)).toEqual([
    ['before', 'user', true],
    ['after', 'user', false],
  ]);

  await page.evaluate(() => {
    window.overlayEvents = [];
    const surface = document.createElement('section');
    const button = document.createElement('button');
    button.textContent = 'Inside without restore';
    surface.appendChild(button);
    window.lease = window.overlayApi.openOverlayLease(window.ownerA, {
      surface,
      initialFocus: button,
      restoreFocus: false,
    });
  });
  await page.keyboard.press('Escape');
  await expect(page.locator('#opener')).not.toBeFocused();
});
