(function () {
  'use strict';
  var status = document.getElementById('subscribe-status');
  var button = document.getElementById('subscribe');
  function byId(id) { return document.getElementById(id); }
  fetch('/api/cloud/billing/subscription').then(async function (response) {
    if (response.status === 401) { location.assign('/cloud/sign-in?return=%2Fcloud%2Fsubscribe'); return; }
    if (!response.ok) throw new Error();
    var data = await response.json();
    var subscription = data.subscription || data;
    byId('subscription-identity').textContent = data.email;
    var paid = data.subscription_status && data.subscription_status !== 'canceled';
    var covered = data.covered_elsewhere;
    byId('subscription-summary').hidden = Boolean(paid || covered);
    if (paid || covered) {
      byId('subscription-state').textContent = covered ? 'Your subscription is covered by another billing account.' : 'You already have a subscription. View payment details and subscription status in Billing.';
      return;
    }
    if (subscription.phase === 'trial_warning') {
      byId('subscription-state').textContent = 'Your free trial has ended. You can keep using SmallDocs until ' + new Date(subscription.paywall_starts_at_ms).toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) + '. Subscribe before then to keep access.';
    } else if (subscription.phase === 'payment_required') {
      byId('subscription-title').textContent = 'Subscribe to continue';
      byId('subscription-state').textContent = 'Your free trial and extra week have ended. Subscribe to open, create, and update your Cloud documents.';
    } else if (data.trial_active) {
      byId('subscription-state').textContent = 'Your free trial ends on ' + new Date(data.trial_ends_at_ms).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) + '.';
    } else {
      byId('subscription-state').textContent = data.trial_ends_at_ms ? ((data.trial_ends_at_ms <= Date.now() ? 'Your free trial has ended. ' : '') + 'Subscribe to continue saving documents. You can still read your existing documents.') : 'Your library includes a month free. Open your library to get started.';
      if (!data.trial_ends_at_ms) return;
    }
    byId('subscription-quantity').hidden = false;
    byId('subscription-quantity').textContent = data.quantity === 1 ? 'Your subscription will cover you.' : 'Your subscription will cover ' + data.quantity + ' people, including you. People already covered by a paid subscription are not added to your bill.';
    byId('subscription-legal').hidden = false;
    button.hidden = false;
    button.disabled = false;
  }).catch(function () {
    byId('subscription-identity').textContent = '';
    byId('subscription-state').textContent = 'Your subscription could not be loaded. Reload this page to try again.';
  });
  button.addEventListener('click', async function () {
    this.disabled = true; status.textContent = 'Opening payment...';
    try {
      var response = await fetch('/api/cloud/billing/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error);
      location.assign(data.checkout_url);
    } catch (error) {
      status.textContent = error.message === 'already_covered' ? 'Your subscription is already covered. You do not need to pay again.' : error.message === 'subscription_pending' ? 'Your payment is being confirmed. Check Billing in a moment.' : error.message === 'subscription_exists' ? 'You already have a subscription. Manage it in Billing.' : error.message === 'recent_auth_required' ? 'Sign in again before continuing to payment.' : 'Payment could not be opened. Try again later.';
      this.disabled = false;
    }
  });
})();
