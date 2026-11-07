(function () {
  'use strict';
  var form = document.getElementById('trial-feedback-form');
  var status = document.getElementById('feedback-status');
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var button = form.querySelector('button');
    button.disabled = true;
    status.textContent = 'Sending feedback...';
    try {
      var rating = form.elements.rating.value;
      var response = await fetch('/api/cloud/v1/trial-feedback', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: form.elements.comment.value, rating: rating ? Number(rating) : null }) });
      if (response.status === 401) { location.assign('/cloud/sign-in?return=%2Fcloud%2Ftrial-feedback'); return; }
      if (!response.ok) throw new Error();
      status.textContent = 'Thank you. Your feedback has been received.';
    } catch (_) {
      status.textContent = 'Your feedback could not be sent. Try again.';
    } finally { button.disabled = false; }
  });
})();
