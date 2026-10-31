'use strict';
const crypto = require('crypto');
const yaml = require('../cli/shared/sdocs-yaml');
const prose = require('../public/sdocs-comments');
const threads = require('../cli/shared/sdocs-comment-data');

function fail(code, message, details) {
  throw Object.assign(new Error(message), { code, details: { field: 'comments', ...details } });
}
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}
function canonical(comment) {
  const result = { ...comment };
  if (result.resolved === true || result.resolved === 'true') result.resolved = true;
  else delete result.resolved;
  if (result.replies !== undefined) result.replies = threads.replies(result.replies);
  return result;
}
function hash(comment, options = {}) {
  const value = canonical(comment);
  if (options.forReply) for (const field of ['replies', 'updated_at', 'resolved', 'resolved_at', 'uid']) delete value[field];
  return crypto.createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
}
function feedbackHash(comment, options = {}) {
  // Source edits can relocate the same note. Guard its discussion and status,
  // rather than treating an automatic anchor update as new reviewer feedback.
  const value = canonical(comment), feedback = {};
  for (const field of ['id', 'author', 'author_user_id', 'at', 'text', 'replies', 'updated_at', 'resolved', 'resolved_at']) {
    if (options.forReply && ['replies', 'updated_at', 'resolved', 'resolved_at'].includes(field)) continue;
    if (value[field] !== undefined) feedback[field] = value[field];
  }
  return crypto.createHash('sha256').update(JSON.stringify(ordered(feedback))).digest('hex');
}
function snapshot(markdown) {
  const parsed = yaml.parseFrontMatter(markdown);
  const imported = prose.parseFootnotes(parsed.body);
  const fromBody = imported.comments || [];
  const comments = (Array.isArray(parsed.meta.comments) ? parsed.meta.comments : []).filter(comment =>
    comment && typeof comment === 'object' && !fromBody.some(note => note.id === comment.id)).concat(fromBody);
  return { markdown, meta: parsed.meta, body: fromBody.length ? imported.body : parsed.body, comments,
    prefix: markdown.slice(0, markdown.length - parsed.body.length), imported_count: fromBody.length };
}
function find(state, id) {
  const matches = state.comments.filter(comment => comment.id === id);
  if (!matches.length) fail('comment_unavailable', 'This comment is unavailable.');
  if (matches.length > 1) fail('comment_changed', 'This comment ID is duplicated. Read the feedback before choosing a target.');
  return matches[0];
}
function write(state, comments) {
  let block = comments.length ? yaml.serializeFrontMatter({ comments: comments.map(canonical) }).replace(/^---\n/, '').replace(/\n---\n?$/, '')
    .split('\n').filter(line => !line.startsWith('#')).join('\n') : '';
  if (!state.prefix) return block ? '---\n' + block + '\n---\n' + state.body : state.body;
  const end = state.prefix.lastIndexOf('---');
  const eol = state.prefix.includes('\r\n') ? '\r\n' : '\n';
  if (eol !== '\n') block = block.replace(/\n/g, eol);
  const before = state.prefix.slice(0, end);
  const lines = before.match(/[^\n]*\n|[^\n]+$/g) || [];
  const start = lines.findIndex(line => /^comments:/.test(line));
  if (start >= 0) {
    let last = start + 1;
    while (last < lines.length && (/^[ \t]/.test(lines[last]) || !lines[last].trim())) last++;
    lines.splice(start, last - start, ...(block ? [block + eol] : []));
  } else if (block) lines.push(block + eol);
  return lines.join('') + state.prefix.slice(end) + state.body;
}
function validateOperation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_request', 'Provide a comment action.');
  if (!['add', 'reply', 'resolve', 'reopen', 'reattach', 'edit', 'delete'].includes(input.action)) fail('invalid_request', 'Choose a supported comment action.');
  if (input.action !== 'add' && (typeof input.comment_id !== 'string' || !/^c\d+$/.test(input.comment_id))) fail('invalid_request', 'A comment ID is required.');
  if (['add', 'reply', 'edit'].includes(input.action) && (typeof input.text !== 'string' || !input.text.trim())) fail('invalid_request', 'Comment text is required.');
  if (input.text != null && typeof input.text !== 'string') fail('invalid_request', 'Comment text must be a string.');
  if (['add', 'reattach'].includes(input.action) && (!input.anchor || input.anchor.kind !== 'inline' || typeof input.anchor.quote !== 'string' || !input.anchor.quote)) fail('invalid_request', 'An inline quote anchor is required.');
  if (input.expected_comment_sha256 != null && !/^[a-f0-9]{64}$/.test(input.expected_comment_sha256)) fail('invalid_request', 'The comment fingerprint is invalid.');
}
function apply(current, base, input, actor, at) {
  validateOperation(input);
  function selectedAnchor() {
    const projection = require('./cloud-comment-context');
    const selection = { kind: 'inline', quote: input.anchor.quote };
    for (const key of ['section', 'lines']) if (input.anchor[key] !== undefined) selection[key] = input.anchor[key];
    const located = projection.locateInline(base.markdown, selection);
    delete located.section; delete located.lines;
    delete located.anchor_status;
    if (prose.documentFingerprint(base.body) === prose.documentFingerprint(current.body)) return located;
    // Treat a newly selected anchor like an existing one while mapping source
    // edits. Searching only the new text can mistake a surviving duplicate for
    // the passage selected in the older revision.
    const probe = { ...located, id: 'c0', uid: 'source-probe' };
    const before = yaml.serializeFrontMatter({ comments: [probe] }) + base.body;
    const after = yaml.serializeFrontMatter({ comments: [probe] }) + current.body;
    const rebased = snapshot(require('./cloud-comment-rebase').reanchor(before, after)).comments[0];
    if (!rebased || rebased.anchor_status || rebased.document_hash === located.document_hash) {
      fail(rebased && rebased.anchor_status === 'ambiguous' ? 'edit_ambiguous' : 'edit_no_match',
        'The selected passage changed or cannot be located with confidence. Read the current source before choosing its anchor.');
    }
    const { id, uid, ...anchor } = rebased;
    return anchor;
  }
  let comment;
  if (input.action === 'add') {
    const anchor = selectedAnchor();
    const n = current.comments.reduce((max, note) => Math.max(max, Number((/^c(\d+)$/.exec(note.id) || [0, 0])[1])), 0) + 1;
    comment = { ...anchor, id: 'c' + n, uid: input.uid || threads.newId('cm'), kind: 'inline',
      author: actor.display_name, author_user_id: actor.user_id, at, text: input.text, color: '#ffbb00' };
    delete comment.match_status; delete comment.source_status;
    return { comments: current.comments.concat(comment), comment };
  }
  const original = find(base, input.comment_id);
  if (input.expected_comment_sha256 && input.expected_comment_sha256 !== hash(original)) fail('comment_changed', 'The supplied comment fingerprint does not match its base.');
  comment = find(current, input.comment_id);
  if ((original.uid && comment.uid && original.uid !== comment.uid) ||
      feedbackHash(original, { forReply: input.action === 'reply' }) !== feedbackHash(comment, { forReply: input.action === 'reply' })) {
    fail('comment_changed', 'This feedback changed after it was read. Read the current comment before handling it.', { comment_id: comment.id });
  }
  if (input.action === 'delete') return { comments: current.comments.filter(note => note !== comment), comment: null };
  if (input.action === 'reattach') {
    const changed = { ...comment };
    for (const key of Object.keys(changed)) if (!['id', 'uid', 'author', 'author_user_id', 'color', 'at', 'text',
      'replies', 'resolved', 'resolved_at', 'updated_at'].includes(key)) delete changed[key];
    Object.assign(changed, selectedAnchor(), { updated_at: at });
    if (!changed.uid) changed.uid = input.uid || threads.newId('cm');
    return { comments: current.comments.map(note => note === comment ? changed : note), comment: changed };
  }
  const changed = threads.mutateComment(comment, { action: input.action, text: input.text, actor, at,
    uid: input.uid, reply_id: input.reply_id });
  return { comments: current.comments.map(note => note === comment ? changed : note), comment: changed };
}
function project(document, origin, options = {}) {
  const state = snapshot(document.markdown);
  const selected = options.comments || state.comments;
  const projections = require('./cloud-comment-context').project(document.markdown, selected,
    { context: options.context || 'snippet' });
  const url = origin + '/docs?cloud-document=' + encodeURIComponent(document.id);
  const comments = selected.map((raw, index) => {
    const c = canonical(raw);
    return { id: c.id, uid: c.uid, sha256: hash(raw), status: c.resolved ? 'resolved' : 'open',
      author: { display_name: c.author || 'user', ...(c.author_user_id ? { user_id: c.author_user_id } : {}) },
      at: c.at || null, updated_at: c.updated_at, resolved_at: c.resolved_at, text: c.text || '',
      replies: threads.replies(c.replies).map(reply => ({ ...reply, author: { display_name: reply.author,
        ...(reply.author_user_id ? { user_id: reply.author_user_id } : {}) } })),
      ...projections[index], url: url + '&comment=' + encodeURIComponent(c.id) };
  });
  return { schema_version: 1, document: { id: document.id, url, title: document.title,
    filename: document.filename, revision_id: document.current_revision_id,
    current_revision_id: document.current_revision_id },
    counts: { total: state.comments.length, open: state.comments.filter(c => c.resolved !== true && c.resolved !== 'true').length,
      resolved: state.comments.filter(c => c.resolved === true || c.resolved === 'true').length }, comments };
}
module.exports = { canonical, snapshot, find, hash, write, validateOperation, apply, project };
