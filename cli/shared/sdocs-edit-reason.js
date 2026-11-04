'use strict';

function normalize(value, required) {
  if (value != null && typeof value !== 'string') {
    throw Object.assign(new Error('edit_reason must be text.'), { code: 'invalid_request' });
  }
  const reason = value == null ? null : value.replace(/\r\n?/g, '\n').trim() || null;
  if (required && !reason) {
    throw Object.assign(new Error('Explain why this change is needed with --reason "Your explanation". The reason is saved in document history.'), {
      code: 'edit_reason_required',
    });
  }
  return reason;
}

module.exports = { normalize };
