'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_LEAD_DAYS = 7;

function scheduleNotices(evaluation) {
  if (!evaluation || evaluation.status !== 'active') return [];
  return [
    { type: 'reminder', eventType: 'reminder_sent', eventKey: 'reminder:7d',
      availableAtMs: evaluation.endsAtMs - REMINDER_LEAD_DAYS * DAY_MS },
    { type: 'expired', eventType: 'expiry_notice_sent', eventKey: 'expiry_notice',
      availableAtMs: evaluation.endsAtMs },
  ];
}

function noticeIsCurrent(input) {
  input = input || {};
  const evaluation = input.evaluation;
  const expected = input.expected || {};
  if (!evaluation || !Number.isSafeInteger(input.now) ||
      evaluation.startedAtMs !== expected.startedAtMs ||
      evaluation.endsAtMs !== expected.endsAtMs ||
      evaluation.status === 'converted') return false;
  if (expected.type === 'reminder') {
    return evaluation.status === 'active' && input.now >= evaluation.endsAtMs - REMINDER_LEAD_DAYS * DAY_MS &&
      input.now < evaluation.endsAtMs;
  }
  if (expected.type === 'expired') {
    return evaluation.status === 'expired' && input.now >= evaluation.endsAtMs;
  }
  return false;
}

module.exports = { DAY_MS, REMINDER_LEAD_DAYS, noticeIsCurrent, scheduleNotices };
