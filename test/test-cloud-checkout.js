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

function checkoutPage(responses) {
  const ids = [
    'checkout-workspace', 'checkout-workspace-field', 'checkout-team-field',
    'checkout-team-name', 'checkout-button', 'checkout-status', 'checkout-title',
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, element(id)]));
  elements['checkout-team-field'].hidden = true;
  const requests = [];
  let assigned = null;
  const context = {
    URLSearchParams,
    Promise,
    Error,
    JSON,
    encodeURIComponent,
    location: {
      search: '?plan=team',
      pathname: '/cloud/checkout',
      href: '',
      assign(value) { assigned = value; },
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
  return { elements, requests, assigned: () => assigned };
}

module.exports = function(harness) {
  const { assert, testAsync } = harness;

  return async function() {
    console.log('\n-- Cloud Checkout Tests -------------------------------\n');

    await testAsync('creates and selects a team workspace before opening Checkout', async () => {
      const page = checkoutPage([
        jsonResponse(200, { workspaces: [{ id: 'personal-1', name: 'Personal', kind: 'personal', role: 'owner' }] }),
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

      assert.strictEqual(page.requests.length, 3);
      assert.strictEqual(page.requests[1].url, '/api/cloud/v1/workspaces');
      assert.strictEqual(page.requests[1].options.method, 'POST');
      assert.deepStrictEqual(JSON.parse(page.requests[1].options.body), {
        name: 'Acme Engineering', project_name: 'Documents',
      });
      assert.strictEqual(page.elements['checkout-workspace'].value, 'team-1');
      assert.strictEqual(page.elements['checkout-workspace'].children[0].textContent, 'Acme Engineering');
      assert.deepStrictEqual(JSON.parse(page.requests[2].options.body), {
        workspace_id: 'team-1', plan: 'team',
      });
      assert.strictEqual(page.assigned(), 'https://checkout.stripe.com/team-session');
    });

    await testAsync('uses an existing owned team workspace without creating another one', async () => {
      const page = checkoutPage([
        jsonResponse(200, { workspaces: [{ id: 'team-existing', name: 'Existing Team', kind: 'team', role: 'owner' }] }),
        jsonResponse(200, { checkout_url: 'https://checkout.stripe.com/existing-session' }),
      ]);
      await settle();
      assert.strictEqual(page.elements['checkout-team-field'].hidden, true);
      assert.strictEqual(page.elements['checkout-button'].disabled, false);
      page.elements['checkout-workspace'].value = 'team-existing';
      page.elements['checkout-button'].dispatch('click');
      await settle();
      assert.strictEqual(page.requests.length, 2);
      assert.strictEqual(page.requests[1].url, '/api/cloud/billing/checkout');
      assert.strictEqual(page.assigned(), 'https://checkout.stripe.com/existing-session');
    });
  };
};
