const fs = require('fs');
const path = require('path');
const vm = require('vm');

function element(id) {
  return {
    id,
    value: '',
    textContent: '',
    className: '',
    disabled: false,
    hidden: false,
    children: [],
    listeners: {},
    addEventListener(name, handler) { this.listeners[name] = handler; },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren() { this.children = Array.from(arguments); },
    dispatch(name) { return this.listeners[name] && this.listeners[name]({ currentTarget: this }); },
  };
}

function jsonResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

async function settle() {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function checkoutPage(responses, search) {
  const ids = [
    'checkout-workspace', 'checkout-workspace-field', 'checkout-team-field',
    'checkout-team-name', 'checkout-button', 'checkout-status', 'checkout-title',
    'checkout-copy', 'checkout-plan-field', 'checkout-detail', 'checkout-selection-name',
    'checkout-plan-note', 'checkout-payment-note', 'checkout-personal', 'checkout-team',
    'checkout-back', 'checkout-profile-field', 'checkout-profile-first-name',
    'checkout-profile-last-name',
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, element(id)]));
  elements['checkout-team-field'].hidden = true;
  const requests = [];
  const windowListeners = {};
  const historyEntries = [{ cloudCheckoutPlan: 'stale' }];
  let historyIndex = 0;
  let assigned = null;
  const context = {
    URLSearchParams,
    Promise,
    Error,
    JSON,
    encodeURIComponent,
    location: {
      search: search == null ? '?plan=team' : search,
      pathname: '/cloud/checkout',
      href: '',
      assign(value) { assigned = value; },
    },
    window: {
      addEventListener(name, handler) { windowListeners[name] = handler; },
    },
    history: {
      get state() { return historyEntries[historyIndex]; },
      pushState(state) {
        historyEntries.splice(historyIndex + 1);
        historyEntries.push(state);
        historyIndex += 1;
      },
      replaceState(state) { historyEntries[historyIndex] = state; },
      back() {
        if (historyIndex > 0) historyIndex -= 1;
        if (windowListeners.popstate) windowListeners.popstate({ state: historyEntries[historyIndex] });
      },
    },
    document: {
      getElementById(id) { return elements[id]; },
      createElement(tag) { return element(tag); },
    },
    fetch: async function(url, options) {
      requests.push({ url, options: options || {} });
      if (!responses.length) throw new Error('unexpected fetch');
      return responses.shift();
    },
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'cloud-checkout.js'), 'utf8');
  vm.runInNewContext(source, context, { filename: 'cloud-checkout.js' });
  return { elements, requests, assigned: () => assigned, browserBack: () => context.history.back(),
    historyState: () => context.history.state };
}

module.exports = function(harness) {
  const { assert, testAsync } = harness;

  return async function() {
    console.log('\n-- Cloud Checkout Tests -------------------------------\n');

    await testAsync('asks whether Cloud is for one person or a team when no plan is supplied', async () => {
      const page = checkoutPage([
        jsonResponse(200, { user: { display_name: 'Josh Summers',
          first_name: 'Josh', last_name: 'Summers' },
          workspaces: [{ id: 'personal-1', name: 'Personal', kind: 'personal', role: 'owner' }] }),
      ], '?return=%2Fdocs%23md%3Dexample');
      await settle();

      assert.strictEqual(page.elements['checkout-title'].textContent, 'Who is Cloud for?');
      assert.strictEqual(page.historyState().cloudCheckoutChoice, true);
      assert.strictEqual(page.elements['checkout-plan-field'].hidden, false);
      assert.strictEqual(page.elements['checkout-button'].hidden, true);

      page.elements['checkout-personal'].dispatch('click');
      assert.strictEqual(page.elements['checkout-plan-field'].hidden, true);
      assert.strictEqual(page.elements['checkout-back'].hidden, false);
      assert.strictEqual(page.elements['checkout-detail'].hidden, false);
      assert.strictEqual(page.elements['checkout-profile-field'].hidden, false);
      assert.strictEqual(page.elements['checkout-profile-first-name'].value, 'Josh');
      assert.strictEqual(page.elements['checkout-profile-last-name'].value, 'Summers');
      assert.strictEqual(page.elements['checkout-selection-name'].textContent, 'Just me');
      assert.strictEqual(page.elements['checkout-workspace-field'].hidden, true);
      assert.strictEqual(page.elements['checkout-button'].hidden, false);
      assert.strictEqual(page.elements['checkout-button'].disabled, false);

      page.browserBack();
      assert.strictEqual(page.elements['checkout-plan-field'].hidden, false);
      assert.strictEqual(page.elements['checkout-back'].hidden, true);
      assert.strictEqual(page.elements['checkout-button'].hidden, true);

      page.elements['checkout-team'].dispatch('click');
      assert.strictEqual(page.elements['checkout-selection-name'].textContent, 'My team');
      assert.strictEqual(page.elements['checkout-team-field'].hidden, false);
      assert.strictEqual(page.elements['checkout-button'].disabled, true);
      page.elements['checkout-back'].dispatch('click');
      assert.strictEqual(page.elements['checkout-plan-field'].hidden, false);
    });

    await testAsync('keeps the original document return path through personal Checkout', async () => {
      const page = checkoutPage([
        jsonResponse(200, { user: { display_name: 'Josh Summers',
          first_name: 'Josh', last_name: 'Summers' },
          workspaces: [{ id: 'personal-1', name: 'Personal', kind: 'personal', role: 'owner' }] }),
        jsonResponse(200, { user: { id: 'user-1', display_name: 'Josh Summers' } }),
        jsonResponse(200, { checkout_url: 'https://checkout.stripe.com/personal-session' }),
      ], '?return=%2Fdocs%23md%3Dexample');
      await settle();
      page.elements['checkout-personal'].dispatch('click');
      page.elements['checkout-button'].dispatch('click');
      await settle();

      assert.strictEqual(page.requests[1].url, '/api/cloud/v1/me');
      assert.deepStrictEqual(JSON.parse(page.requests[1].options.body), {
        first_name: 'Josh', last_name: 'Summers',
      });
      assert.deepStrictEqual(JSON.parse(page.requests[2].options.body), {
        workspace_id: 'personal-1', plan: 'personal', return_to: '/docs#md=example',
      });
      assert.strictEqual(page.assigned(), 'https://checkout.stripe.com/personal-session');
    });

    await testAsync('creates and selects a team workspace before opening Checkout', async () => {
      const page = checkoutPage([
        jsonResponse(200, { user: { display_name: 'Josh Summers',
          first_name: 'Josh', last_name: 'Summers' },
          workspaces: [{ id: 'personal-1', name: 'Personal', kind: 'personal', role: 'owner' }] }),
        jsonResponse(200, { user: { id: 'user-1', display_name: 'Josh Summers' } }),
        jsonResponse(201, { workspace: { workspaceId: 'team-1', projectId: 'project-1' } }),
        jsonResponse(200, { checkout_url: 'https://checkout.stripe.com/team-session' }),
      ]);
      await settle();
      assert.strictEqual(page.elements['checkout-team-field'].hidden, false);
      assert.strictEqual(page.elements['checkout-workspace-field'].hidden, true);
      assert.strictEqual(page.elements['checkout-button'].disabled, true);

      page.elements['checkout-team-name'].value = 'Acme Engineering';
      page.elements['checkout-team-name'].dispatch('input');
      assert.strictEqual(page.elements['checkout-button'].disabled, false);
      page.elements['checkout-button'].dispatch('click');
      await settle();

      assert.strictEqual(page.requests.length, 4);
      assert.strictEqual(page.requests[2].url, '/api/cloud/v1/workspaces');
      assert.strictEqual(page.requests[2].options.method, 'POST');
      assert.deepStrictEqual(JSON.parse(page.requests[2].options.body), {
        name: 'Acme Engineering', project_name: 'Documents',
      });
      assert.strictEqual(page.elements['checkout-workspace'].value, 'team-1');
      assert.strictEqual(page.elements['checkout-workspace'].children[0].textContent, 'Acme Engineering');
      assert.deepStrictEqual(JSON.parse(page.requests[3].options.body), {
        workspace_id: 'team-1', plan: 'team',
      });
      assert.strictEqual(page.assigned(), 'https://checkout.stripe.com/team-session');
    });

    await testAsync('uses an existing owned team workspace without creating another one', async () => {
      const page = checkoutPage([
        jsonResponse(200, { user: { display_name: 'Josh Summers',
          first_name: 'Josh', last_name: 'Summers' },
          workspaces: [{ id: 'team-existing', name: 'Existing Team', kind: 'team', role: 'owner' }] }),
        jsonResponse(200, { user: { id: 'user-1', display_name: 'Josh Summers' } }),
        jsonResponse(200, { checkout_url: 'https://checkout.stripe.com/existing-session' }),
      ]);
      await settle();
      assert.strictEqual(page.elements['checkout-team-field'].hidden, true);
      assert.strictEqual(page.elements['checkout-button'].disabled, false);
      page.elements['checkout-workspace'].value = 'team-existing';
      page.elements['checkout-button'].dispatch('click');
      await settle();
      assert.strictEqual(page.requests.length, 3);
      assert.strictEqual(page.requests[2].url, '/api/cloud/billing/checkout');
      assert.strictEqual(page.assigned(), 'https://checkout.stripe.com/existing-session');
    });
  };
};
