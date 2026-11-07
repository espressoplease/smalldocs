---
title: Bug report - the due date moves back one day
styles:
  background: "#F1F5FA"
  color: "#172D48"
  h2:
    color: "#385C86"
  blocks:
    background: "#E3ECF6"
    color: "#172D48"
---

# Bug report: the due date moves back one day

**Symptom:** Select January 1 in a task's date picker. The saved task shows December 31 for a user in Los Angeles, while a user in London sees January 1. The API still contains the correct date.

This is an illustrative report based on a [public date-formatting bug discussion](https://github.com/orgs/date-fns/discussions/2741), with a standalone JavaScript reproduction. It is not a bug in SmallDocs.

~~~mermaid
flowchart TD
  A[Picker value: 2026-01-01] --> B[Date constructor: midnight UTC]
  B --> C[Local display in Los Angeles]
  C --> D[December 31 at 4 pm]
~~~

## Reproduce it

Save the following as `repro.cjs` and run `TZ=America/Los_Angeles node repro.cjs` on macOS or Linux:

~~~javascript
const selected = '2026-01-01';
const display = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric'
});
console.log(selected);                          // 2026-01-01
console.log(display.format(new Date(selected))); // Dec 31, 2025
~~~

| Check | Expected | Actual |
| --- | --- | --- |
| Stored API value | 2026-01-01 | 2026-01-01 |
| Task label in Los Angeles | Jan 1, 2026 | Dec 31, 2025 |
| Task label in London | Jan 1, 2026 | Jan 1, 2026 |

## Cause and fix

The field represents a calendar date, not an instant. JavaScript parses an ISO date-only string as midnight UTC; formatting that instant in a time zone west of UTC crosses into the previous day. [MDN documents this parsing behavior](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date#date_time_string_format).

Keep the valid `YYYY-MM-DD` value in storage. For this date-only label, format in UTC explicitly so display preserves the stored calendar day:

~~~javascript
const dateOnlyLabel = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric',
  timeZone: 'UTC'
});
function formatDueDate(isoDate) {
  return dateOnlyLabel.format(new Date(isoDate));
}
console.log(formatDueDate('2026-01-01')); // Jan 1, 2026
~~~

The function assumes a valid ISO calendar date from the API. Date inputs supply a normalized date string, as described in [MDN's date-input reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/date). This fix is for date-only fields; appointments with a time and time zone need a different contract.

## Regression coverage

Append the fix above and the assertions below to `repro.cjs`. Run the file with `TZ` set to `America/Los_Angeles`, `America/New_York`, `Europe/London` and `Asia/Tokyo`:

~~~javascript
const assert = require('node:assert/strict');
assert.equal(formatDueDate('2026-01-01'), 'Jan 1, 2026');
assert.equal(formatDueDate('2026-03-08'), 'Mar 8, 2026');
assert.equal(formatDueDate('2026-11-01'), 'Nov 1, 2026');
assert.equal(formatDueDate('2024-02-29'), 'Feb 29, 2024');
~~~

The cases cover a year boundary, US daylight-saving transitions and a leap day. The regression criterion is that the displayed calendar date matches the input in every tested time zone.
