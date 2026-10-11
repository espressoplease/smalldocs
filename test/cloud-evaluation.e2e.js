'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { LOCAL_TEST_LOGIN_SECRET, TEST_IDENTITIES } = require('./cloud-e2e-constants');

test('no-card evaluation requires Cloud consent and starts a bounded Personal entitlement', async ({ request, baseURL }) => {
  test.skip(Boolean(process.env.CLOUD_E2E_BASE_URL),
    'This test requires the local disposable evaluation feature flag and isolated database');
  const base = String(baseURL).replace(/\/$/, '');
  const login = await request.post(base + '/api/cloud/auth/test-login', {
    headers: { Origin: base },
    data: { email: TEST_IDENTITIES.evaluation, secret: LOCAL_TEST_LOGIN_SECRET,
      return_to: '/cloud/evaluation' },
  });
  expect(login.status()).toBe(200);
  const termsPage = await request.get(base + '/cloud/terms?return=%2Fcloud%2Fevaluation');
  expect(termsPage.status()).toBe(200);
  const html = await termsPage.text();
  const termsVersion = /id="terms-version" type="hidden" value="([^"]+)"/.exec(html)[1];
  const accepted = await request.post(base + '/api/cloud/auth/terms/accept', {
    headers: { Origin: base }, data: { accepted: true, terms_version: termsVersion },
  });
  expect(accepted.status()).toBe(200);
  const page = await request.get(base + '/cloud/evaluation');
  expect(page.status()).toBe(200);
  expect(await page.text()).toContain('I understand that documents I send to this Cloud account are stored there');

  const workspaceResult = await request.post(base + '/api/cloud/v1/workspaces', {
    headers: { Origin: base }, data: { kind: 'personal' },
  });
  expect(workspaceResult.status()).toBe(201);
  const { workspace } = await workspaceResult.json();
  const csrfDenied = await request.post(base + '/api/cloud/v1/evaluations', {
    data: { workspace_id: workspace.workspaceId, terms_version: termsVersion,
      cloud_first_consent: true },
  });
  expect(csrfDenied.status()).toBe(403);
  expect(await csrfDenied.json()).toEqual({ ok: false, error: 'invalid_origin' });
  const denied = await request.post(base + '/api/cloud/v1/evaluations', {
    headers: { Origin: base }, data: { workspace_id: workspace.workspaceId,
      terms_version: termsVersion, cloud_first_consent: false },
  });
  expect(denied.status()).toBe(400);
  expect(await denied.json()).toEqual({ ok: false, error: 'evaluation_consent_required' });

  const started = await request.post(base + '/api/cloud/v1/evaluations', {
    headers: { Origin: base }, data: { workspace_id: workspace.workspaceId,
      terms_version: termsVersion, cloud_first_consent: true },
  });
  expect(started.status()).toBe(201);
  const { evaluation } = await started.json();
  expect(evaluation.status).toBe('active');
  expect(evaluation.endsAtMs - evaluation.startedAtMs).toBe(30 * 24 * 60 * 60 * 1000);
  const billing = await request.get(base + '/api/cloud/v1/workspaces/' + workspace.workspaceId + '/billing');
  expect(billing.status()).toBe(200);
  const billingBody = (await billing.json()).billing;
  expect(billingBody.access.write).toBe(true);
  expect(billingBody.subscriptionStatus).toBe(null);
  const document = await request.post(base + '/api/cloud/v1/account/documents', {
    headers: { Origin: base }, data: { account_id: workspace.workspaceId,
      filename: 'evaluation.md', markdown: '# Evaluation document',
      idempotency_key: 'evaluation-first-document' },
  });
  expect(document.status()).toBe(201);
  const documentBody = await document.json();
  const list = await request.get(base + '/api/cloud/v1/documents?workspace_id=' + workspace.workspaceId);
  expect(list.status()).toBe(200);
  expect((await list.json()).documents.map((item) => item.id)).toContain(documentBody.document.id);
  const read = await request.get(base + '/api/cloud/v1/documents/' + documentBody.document.id);
  expect(read.status()).toBe(200);
  const exported = await request.post(base + '/api/cloud/v1/workspaces/' + workspace.workspaceId + '/export', {
    headers: { Origin: base }, data: {},
  });
  expect(exported.status()).toBe(200);

  const state = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'test-results',
    'cloud-e2e-state.json'), 'utf8'));
  const { createBillingStore } = require('../lib/cloud-billing');
  function withBillingStore(action) {
    const store = createBillingStore({ dbPath: state.billingDb });
    try { return action(store); } finally { store.close(); }
  }
  withBillingStore(function (store) {
    store.db.prepare('UPDATE cloud_evaluations SET ends_at_ms = ? WHERE workspace_id = ?')
      .run(Date.now() - 1, workspace.workspaceId);
  });
  const project = await request.get(base + '/api/cloud/v1/projects?workspace_id=' + workspace.workspaceId);
  expect(project.status()).toBe(200);
  const projectId = (await project.json()).projects[0].id;
  const expiredList = await request.get(base + '/api/cloud/v1/documents?workspace_id=' + workspace.workspaceId);
  expect(expiredList.status()).toBe(200);
  expect((await expiredList.json()).documents.map((item) => item.id)).toContain(documentBody.document.id);
  const expiredUpload = await request.post(base + '/api/cloud/v1/documents', {
    headers: { Origin: base }, data: { project_id: projectId, filename: 'blocked.md',
      markdown: '# Must not upload', idempotency_key: 'expired-evaluation-upload' },
  });
  expect(expiredUpload.status()).toBe(402);
  expect(await expiredUpload.json()).toEqual({ ok: false, error: 'evaluation_expired' });
  const expiredDelete = await request.delete(base + '/api/cloud/v1/documents/' + documentBody.document.id, {
    headers: { Origin: base }, data: { expected_head_revision_id: documentBody.document.current_revision_id },
  });
  expect(expiredDelete.status()).toBe(402);
  expect(await expiredDelete.json()).toEqual({ ok: false, error: 'evaluation_expired' });
  const expiredRead = await request.get(base + '/api/cloud/v1/documents/' + documentBody.document.id);
  expect(expiredRead.status()).toBe(200);
  const expiredExport = await request.post(base + '/api/cloud/v1/workspaces/' + workspace.workspaceId + '/export', {
    headers: { Origin: base }, data: {},
  });
  expect(expiredExport.status()).toBe(200);

  withBillingStore(function (store) {
    store.upsertSubscription({ workspaceId: workspace.workspaceId, plan: 'personal', status: 'active',
      seatQuantity: 1, provider: 'stripe', providerSubscriptionId: 'sub_evaluation_paid_fixture' });
  });
  const upgradedUpload = await request.post(base + '/api/cloud/v1/documents', {
    headers: { Origin: base }, data: { project_id: projectId, filename: 'after-upgrade.md',
      markdown: '# Paid access fixture', idempotency_key: 'paid-evaluation-upload' },
  });
  expect(upgradedUpload.status()).toBe(201);

  const timestamp = Math.floor(Date.now() / 1000);
  const invoice = { id: 'in_evaluation_paid', object: 'invoice', amount_paid: 400,
    currency: 'gbp', subscription: 'sub_evaluation_paid_fixture' };
  const event = { id: 'evt_evaluation_invoice_1', object: 'event', created: timestamp,
    type: 'invoice.paid', data: { object: invoice } };
  async function sendInvoice(eventId) {
    const signedEvent = JSON.stringify(Object.assign({}, event, { id: eventId }));
    const signedSignature = crypto.createHmac('sha256', 'whsec_local_cloud_e2e')
      .update(timestamp + '.' + signedEvent).digest('hex');
    return request.post(base + '/api/cloud/billing/stripe/webhook', {
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature':
        't=' + timestamp + ',v1=' + signedSignature }, data: signedEvent,
    });
  }
  expect((await sendInvoice('evt_evaluation_invoice_1')).status()).toBe(200);
  expect((await sendInvoice('evt_evaluation_invoice_retry')).status()).toBe(200);
  const paidEvent = withBillingStore(function (store) {
    return store.db.prepare(`SELECT amount_minor, currency FROM cloud_evaluation_events
      WHERE workspace_id = ? AND event_type = 'paid_invoice'`).get(workspace.workspaceId);
  });
  expect(paidEvent).toEqual({ amount_minor: 400, currency: 'gbp' });
});
