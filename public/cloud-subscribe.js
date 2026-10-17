(function () {
  'use strict';
  var status = document.getElementById('subscribe-status');
  fetch('/api/cloud/v1/me').then(function (response) { return response.json(); }).then(function (data) {
    document.getElementById('subscription-identity').textContent = data.user.email;
  }).catch(function () { status.textContent = 'Your details could not be loaded.'; });
  document.getElementById('subscribe').addEventListener('click', async function () {
    this.disabled = true;
    try {
      var response = await fetch('/api/cloud/billing/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error);
      location.assign(data.checkout_url);
    } catch (error) {
      status.textContent = error.message === 'already_covered' ? 'Your subscription is already covered. You do not need to pay again.' : error.message === 'subscription_pending' ? 'Payment is being activated. Return to settings in a moment.' : error.message === 'subscription_exists' ? 'You already have a subscription. Manage it from Billing in settings.' : 'Payment setup is unavailable. Please try again later.';
      this.disabled = false;
    }
  });
})();
