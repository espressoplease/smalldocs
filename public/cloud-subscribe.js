(function () {
  'use strict';
  var status = document.getElementById('subscribe-status');
  var button = document.getElementById('subscribe');
  var check = document.getElementById('check-payment');
  var pollTimer, pollCount = 0;
  var pending = new URLSearchParams(location.search).get('payment') === 'confirming';
  function byId(id) { return document.getElementById(id); }
  function signIn() {
    status.replaceChildren(document.createTextNode('Sign in again before continuing to payment. '));
    var link = document.createElement('a'); link.textContent = 'Sign in';
    link.href = '/cloud/sign-in?return=' + encodeURIComponent(location.pathname + location.search);
    status.appendChild(link);
  }
  function pendingPayment() {
    pending = true;
    button.hidden = true;
    check.hidden = false;
    status.textContent = 'Your payment is being confirmed. This page will check again shortly.';
    clearTimeout(pollTimer);
    if (pollCount < 10) pollTimer = setTimeout(function () { pollCount++; load(); }, 3000);
    else status.textContent = 'Payment confirmation is taking longer than usual. Check again, or open Billing in settings.';
  }
  async function load() {
    try {
      var response = await fetch('/api/cloud/billing/subscription');
      if (response.status === 401) { signIn(); return; }
      if (!response.ok) throw new Error();
      var data = await response.json();
      var subscription = data.subscription || data;
      byId('subscription-identity').textContent = data.email;
      var paid = data.subscription_status && data.subscription_status !== 'canceled' && !data.payment_pending;
      var covered = data.covered_elsewhere;
      byId('subscription-summary').hidden = Boolean(paid || covered);
      if (paid || covered) {
        clearTimeout(pollTimer); pending = false;
        check.hidden = true; button.hidden = true; status.textContent = '';
        byId('subscription-legal').hidden = true; byId('subscription-quantity').hidden = true;
        byId('subscription-state').textContent = covered ? 'Your subscription is covered by another billing account.'
          : subscription.phase === 'past_due_grace' ? 'Payment needs attention. You can keep saving until ' + new Date(subscription.grace_ends_at_ms).toLocaleString() + '. Update your payment details in Billing.'
          : ['past_due', 'read_only'].includes(subscription.phase) ? 'Your subscription is read-only. You can open and export documents. Update Billing to save changes.'
          : 'Your subscription is active. View payment details and subscription status in Billing.';
        return;
      }
      if (data.subscription_status === 'canceled') pending = false;
      if (pending || data.payment_pending) { pendingPayment(); return; }
      if (subscription.phase === 'trial_warning') {
        byId('subscription-state').textContent = 'Your free trial has ended. You can keep using SmallDocs until ' + new Date(subscription.paywall_starts_at_ms).toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) + '. Subscribe before then to keep access.';
      } else if (subscription.phase === 'payment_required') {
        byId('subscription-title').textContent = 'Subscribe to continue';
        byId('subscription-state').textContent = 'Your free trial and extra week have ended. Subscribe to open, create, and update your Cloud documents.';
      } else if (data.subscription_status === 'canceled') {
        byId('subscription-state').textContent = 'Your subscription has ended. You can open and export your documents. Subscribe again to save changes.';
      } else if (data.trial_active) {
        byId('subscription-state').textContent = 'Your free trial ends on ' + new Date(data.trial_ends_at_ms).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) + '.';
      } else {
        byId('subscription-state').textContent = data.trial_ends_at_ms ? 'Subscribe to continue saving documents. You can still read your existing documents.' : 'Your library includes a month free. Open your library to get started.';
        if (!data.trial_ends_at_ms && data.subscription_status !== 'canceled') return;
      }
      byId('subscription-quantity').hidden = false;
      byId('subscription-quantity').textContent = data.quantity === 1 ? 'Your subscription will cover you.' : 'Your subscription will cover ' + data.quantity + ' people, including you. People already covered by a paid subscription are not added to your bill.';
      byId('subscription-legal').hidden = false;
      button.hidden = false; button.disabled = false;
    } catch (_) {
      byId('subscription-state').textContent = 'Your subscription could not be loaded. Try again.';
      check.hidden = false;
    } finally { check.disabled = false; }
  }
  check.addEventListener('click', function () { this.disabled = true; pollCount = 0; load(); });
  button.addEventListener('click', async function () {
    this.disabled = true; status.textContent = 'Opening payment...';
    try {
      var response = await fetch('/api/cloud/billing/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error);
      location.assign(data.checkout_url);
    } catch (error) {
      if (error.message === 'recent_auth_required' || error.message === 'login_required') signIn();
      else if (error.message === 'subscription_pending') pendingPayment();
      else status.textContent = error.message === 'already_covered' ? 'Your subscription is already covered. You do not need to pay again.' : error.message === 'subscription_exists' ? 'You already have a subscription. Manage it in Billing.' : 'Payment could not be opened. Try again later.';
      this.disabled = false;
    }
  });
  window.addEventListener('pagehide', function () { clearTimeout(pollTimer); });
  load();
})();
