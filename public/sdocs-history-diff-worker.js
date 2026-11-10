/* Compare selected retained versions off the reader's main thread. */
'use strict';
var window = self;
importScripts('/public/sdocs-text-diff.js' + self.location.search);
var iterator, pending, totals;
function* lines(diff) {
  for (var hunk of diff.hunks) {
    yield { kind: 'heading', text: 'Line ' + hunk.after_line };
    for (var value of hunk.context_before) yield { kind: 'context', text: value };
    for (var value of hunk.before) yield { kind: 'removed', text: value };
    for (var value of hunk.after) yield { kind: 'added', text: value };
    for (var value of hunk.context_after) yield { kind: 'context', text: value };
  }
}
self.onmessage = function (event) {
  try {
    if (event.data.command === 'compare') {
      var diff = window.SDocsTextDiff.compare(event.data.before, event.data.after);
      totals = { added: diff.added_lines, removed: diff.removed_lines };
      iterator = lines(diff); pending = iterator.next();
    }
    var page = [];
    while (!pending.done && page.length < 120) { page.push(pending.value); pending = iterator.next(); }
    self.postMessage({ lines: page, more: !pending.done, totals: totals });
  } catch (_) { self.postMessage({ error: true }); }
};
