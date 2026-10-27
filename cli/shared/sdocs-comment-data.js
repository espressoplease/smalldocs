'use strict';
(function (exports) {
function newId(prefix) {
  var uuid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() :
    Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return (prefix || 'cm') + '_' + uuid;
}
function replies(value) {
  // The Markdown YAML subset stores nested arrays as inline JSON scalars.
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (_) { return []; }
  }
  if (!Array.isArray(value)) return [];
  return value.filter(function (item) { return item && typeof item.id === 'string' && typeof item.text === 'string'; })
    .map(function (item) {
      var out = { id: item.id, author: typeof item.author === 'string' ? item.author : 'user',
        at: typeof item.at === 'string' ? item.at : '', text: item.text };
      if (typeof item.author_user_id === 'string') out.author_user_id = item.author_user_id;
      return out;
    });
}
function normalizeThreadFields(comment, out) {
  ['uid', 'author_user_id', 'updated_at', 'resolved_at'].forEach(function (key) {
    if (typeof comment[key] === 'string') out[key] = comment[key];
  });
  var list = replies(comment.replies);
  if (list.length) out.replies = list;
  return out;
}
function fail(code, message) {
  var error = new Error(message);
  error.code = code;
  throw error;
}
function mutateComment(comment, operation) {
  var out = Object.assign({}, comment);
  var action = operation.action;
  var actor = operation.actor || {};
  var at = operation.at || new Date().toISOString();
  var resolved = comment.resolved === true || comment.resolved === 'true';
  if ((action === 'resolve' && resolved && !operation.text) || (action === 'reopen' && !resolved)) return out;
  if (!out.uid) out.uid = operation.uid || newId('cm');
  if (action === 'reply' || (action === 'resolve' && operation.text)) {
    if (typeof operation.text !== 'string' || !operation.text.trim()) fail('invalid_request', 'Reply text is required.');
    var list = replies(out.replies);
    var item = { id: operation.reply_id || newId('rp'), author: actor.display_name || 'user', at: at, text: operation.text };
    if (actor.user_id) item.author_user_id = actor.user_id;
    if (!list.some(function (reply) { return reply.id === item.id; })) list.push(item);
    out.replies = list;
  }
  if (action === 'resolve') { out.resolved = true; out.resolved_at = at; }
  else if (action === 'reopen') { delete out.resolved; delete out.resolved_at; }
  else if (action === 'edit') {
    if (typeof operation.text !== 'string' || !operation.text.trim()) fail('invalid_request', 'Comment text is required.');
    out.text = operation.text;
  } else if (action !== 'reply') fail('invalid_request', 'Unknown comment action.');
  out.updated_at = at;
  return out;
}
function updateThread(meta, id, operation) {
  var found = false;
  var comments = (meta && Array.isArray(meta.comments) ? meta.comments : []).map(function (comment) {
    if (!comment || comment.id !== id) return comment;
    found = true;
    return mutateComment(comment, operation);
  });
  if (!found) fail('comment_unavailable', 'This comment is unavailable.');
  return Object.assign({}, meta || {}, { comments: comments });
}
function equal(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function mergeReplies(base, current, proposed) {
  var out = [], byId = new Map();
  [replies(base), replies(current), replies(proposed)].forEach(function (list) {
    list.forEach(function (reply) {
      var existing = byId.get(reply.id);
      if (existing && equal(existing, reply)) return;
      var value = Object.assign({}, reply);
      if (existing) {
        var suffix = 2;
        while (byId.has(reply.id + '_copy' + suffix)) suffix++;
        value.id = reply.id + '_copy' + suffix;
      }
      byId.set(value.id, value); out.push(value);
    });
  });
  return out;
}
function mergeComment(base, current, proposed) {
  var result = {}, keys = new Set(Object.keys(base || {}).concat(Object.keys(current || {}), Object.keys(proposed || {})));
  var conflict = false;
  keys.forEach(function (key) {
    if (key === 'replies') {
      var list = mergeReplies(base && base.replies, current.replies, proposed.replies);
      if (list.length) result.replies = list;
      return;
    }
    var before = base && base[key], now = current[key], wanted = proposed[key], value;
    if (equal(now, wanted) || equal(wanted, before)) value = now;
    else if (equal(now, before)) value = wanted;
    else if (key === 'updated_at' || key === 'resolved_at' || (key === 'uid' && base && !before)) value = String(now || '') > String(wanted || '') ? now : wanted;
    else { conflict = true; return; }
    if (value !== undefined) result[key] = value;
  });
  if (result.resolved !== true && result.resolved !== 'true') delete result.resolved_at;
  return conflict ? null : result;
}
exports.newId = newId;
exports.replies = replies;
exports.normalizeThreadFields = normalizeThreadFields;
exports.mutateComment = mutateComment;
exports.updateThread = updateThread;
exports.mergeComment = mergeComment;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocsCommentData = {}));
