'use strict';

const assert = require('assert/strict');

function flipCharacter(value) {
  if (!value) throw new Error('Cannot mutate an empty cursor');
  return (value[0] === 'a' ? 'b' : 'a') + value.slice(1);
}

function changedPayload(cursor) {
  const parts = cursor.split('.');
  let body;
  try { body = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); }
  catch (_) { return flipCharacter(parts[0]) + '.' + parts.slice(1).join('.'); }
  body.p = { ...(body.p || {}), id: '00000000-0000-4000-8000-000000000000' };
  return Buffer.from(JSON.stringify(body)).toString('base64url') + '.' + parts.slice(1).join('.');
}

// The caller supplies an isolated HTTP fixture's authenticated transport. This
// module never discovers credentials or sends traffic to a production account.
// search(body, principal) must return { status, body: parsed JSON }.
async function exerciseCursorAttacks(options) {
  const { search, request, principal, secondPrincipal } = options;
  const first = await search({ ...request, limit: 2 }, principal);
  assert.equal(first.status, 200, 'Initial search must succeed');
  assert.ok(first.body && first.body.next_cursor, 'Cursor attacks need more than two matches');
  const cursor = first.body.next_cursor;
  const split = cursor.lastIndexOf('.');
  const signatureMutation = split < 0 ? flipCharacter(cursor)
    : cursor.slice(0, split + 1) + flipCharacter(cursor.slice(split + 1));
  const changedQueryRequest = { ...request, cursor, query: 'completely different query' };
  delete changedQueryRequest.expression;
  const changedExpressionRequest = { ...request, cursor,
    expression: { field: 'body', match: 'term', value: 'definitelyabsentneedle' } };
  delete changedExpressionRequest.query;
  const attacks = [
    ['changed-signature', { ...request, cursor: signatureMutation }, principal],
    ['changed-position', { ...request, cursor: changedPayload(cursor) }, principal],
    ['truncated-token', { ...request, cursor: cursor.slice(0, Math.floor(cursor.length / 2)) }, principal],
    ['oversized-token', { ...request, cursor: 'a'.repeat(8193) }, principal],
    ['changed-query', changedQueryRequest, principal],
    ['changed-expression', changedExpressionRequest, principal],
    ['changed-tags', { ...request, cursor, tags: ['differenttag'] }, principal],
    ['changed-excluded-tags', { ...request, cursor, tags_none: ['differenttag'] }, principal],
    ['changed-authors', { ...request, cursor, author_user_ids: ['usr_search_eval_different'] }, principal],
    ['changed-document-subset', { ...request, cursor,
      document_ids: ['00000000-0000-4000-8000-000000000000'] }, principal],
    ['changed-field-scope', { ...request, cursor, fields: ['title'] }, principal],
    ['changed-sort', { ...request, cursor,
      sort: request.sort === 'created_desc' ? 'updated_desc' : 'created_desc' }, principal],
  ];
  if (secondPrincipal != null) attacks.push(['changed-principal', { ...request, cursor }, secondPrincipal]);
  if (options.otherWorkspaceId) attacks.push(['changed-workspace', { ...request, cursor,
    workspace_id: options.otherWorkspaceId }, principal]);
  const results = [];
  for (const [id, body, user] of attacks) {
    const response = await search(body, user);
    assert.equal(response.status, 400, `${id}: cursor was accepted outside its signed request scope`);
    assert.equal(response.body.ok, false, `${id}: missing failure state`);
    assert.equal(response.body.error, 'invalid_request', `${id}: wrong error code`);
    for (const field of ['documents', 'facets', 'total_count', 'next_cursor', 'score']) {
      assert.equal(Object.hasOwn(response.body, field), false, `${id}: error discloses ${field}`);
    }
    for (const needle of options.forbiddenValues || ['classifiedcanary', 'classifiedfacet']) {
      assert.equal(JSON.stringify(response.body).includes(needle), false, `${id}: error discloses protected data`);
    }
    results.push({ id, pass: true });
  }
  const next = await search({ ...request, limit: 2, cursor }, principal);
  assert.equal(next.status, 200, 'Unmodified cursor must remain usable');
  const firstIds = new Set(first.body.documents.map((document) => document.id));
  assert.equal(next.body.documents.some((document) => firstIds.has(document.id)), false,
    'Untampered continuation repeated an earlier result');
  return results;
}

module.exports = { changedPayload, exerciseCursorAttacks, flipCharacter };
