module.exports = function (h) {
  const { test, assert } = h;
  const { parseQuery, normalizeSearchRequest, normalizeExpression, expandWordForms } = require('../cli/shared/sdocs-search-query');
  const term = value => ({ field: 'text', match: 'term', value });
  test('rich search parser gives NOT, implicit AND and OR their documented precedence', () => {
    assert.deepStrictEqual(parseQuery('alpha beta OR NOT gamma'), { op: 'or', clauses: [
      { op: 'and', clauses: [term('alpha'), term('beta')] }, { op: 'not', clause: term('gamma') },
    ] });
    assert.deepStrictEqual(parseQuery('(alpha OR beta) AND gamma'), { op: 'and', clauses: [
      { op: 'or', clauses: [term('alpha'), term('beta')] }, term('gamma'),
    ] });
  });
  test('rich search parser preserves phrase, Unicode, identifier and prefix intent', () => {
    assert.deepStrictEqual(parseQuery('body:"incident response" title:auth*'), { op: 'and', clauses: [
      { field: 'body', match: 'phrase', value: 'incident response' }, { field: 'title', match: 'prefix', value: 'auth' },
    ] });
    assert.deepStrictEqual(parseQuery('日本語 café order-id'), { op: 'and', clauses: [term('日本語'), term('café'), term('order-id')] });
    assert.deepStrictEqual(parseQuery('tag:"incident-response" author:me'), { op: 'and', clauses: [{ field: 'tag', value: 'incident-response' }, { field: 'author', value: 'me' }] });
  });
  test('rich search parser gives actionable errors rather than accepting malformed input', () => {
    for (const query of ['foo OR', '()', '(foo', 'foo)', '"unterminated', 'foo AND OR bar', 'unknown:value', 'a*b', '*', '""']) {
      assert.throws(() => parseQuery(query), e => e.code === 'invalid_request' && e.details.suggestion.includes('--literal'), query);
    }
    assert.deepStrictEqual(parseQuery('and'), term('and'));
    assert.strictEqual(parseQuery('  '), null);
    assert.throws(() => parseQuery('NOT '.repeat(66) + 'x'), e => e.code === 'invalid_request');
  });
  test('search request keeps legacy literals while supporting structured and metadata-only searches', () => {
    const old = normalizeSearchRequest({ query: 'incident response', tags: ['support'] });
    assert.strictEqual(old.query, 'incident response');
    assert.strictEqual(old.expression, null);
    assert.strictEqual(old.sort, 'updated_desc');
    const rich = normalizeSearchRequest({ query: 'alpha beta', mode: 'query' });
    assert.strictEqual(rich.query, ''); assert.strictEqual(rich.expression.op, 'and');
    assert.strictEqual(rich.sort, 'relevance');
    const tags = normalizeSearchRequest({ tags: ['z', 'a', 'z'], author_user_ids: ['me', 'user-1'] }, { userId: 'user-1' });
    assert.deepStrictEqual(tags.tags, ['a', 'z']); assert.deepStrictEqual(tags.authorUserIds, ['user-1']);
  });
  test('search date-only bounds cover complete days and reject impossible calendar dates', () => {
    const normalized = normalizeSearchRequest({ updated_after: '2026-10-01', updated_before: '2026-10-20' });
    assert.strictEqual(normalized.updatedAfter, '2026-10-01T00:00:00.000Z');
    assert.strictEqual(normalized.updatedBefore, '2026-10-20T23:59:59.999Z');
    assert.throws(() => normalizeSearchRequest({ updated_after: '2026-02-30' }), e => e.code === 'invalid_request');
    assert.throws(() => normalizeSearchRequest({ updated_after: '2026-11-01', updated_before: '2026-10-20' }), e => e.code === 'invalid_request');
  });
  test('optional English word forms expand singulars and plurals without changing phrases or metadata', () => {
    for (const [singular, plural] of [['payment', 'payments'], ['retry', 'retries'], ['process', 'processes'], ['analysis', 'analyses']]) {
      for (const word of [singular, plural]) assert.deepStrictEqual(new Set(expandWordForms(term(word)).clauses.map(clause => clause.value)), new Set([singular, plural]));
    }
    assert.deepStrictEqual(expandWordForms(parseQuery('NOT retry')), { op: 'not', clause: { op: 'or', clauses: [term('retry'), term('retries')] } });
    for (const query of ['"payment retry"', 'tag:payments', 'author:me', 'body:retr*', 'order-id', '日本語']) assert.deepStrictEqual(expandWordForms(parseQuery(query)), parseQuery(query));
    assert.deepStrictEqual(normalizeSearchRequest({ mode: 'query', query: 'payment retry', word_forms: true }).expression, expandWordForms(parseQuery('payment retry')));
    assert.strictEqual(normalizeSearchRequest({ query: 'payment', word_forms: true }).query, 'payment');
    assert.strictEqual(normalizeSearchRequest({ match_limit: 0 }).matchLimit, 0);
    assert.throws(() => normalizeSearchRequest({ word_forms: 'yes' }), error => error.code === 'invalid_request');
  });
  test('search validates filters and expression shape before index or document access', () => {
    for (const request of [{ tags: 'secret' }, { fields: ['password'] }, { facets: ['emails'] }, { sort: 'random' }, { limit: 101 }, { limit: -1 }, { document_ids: [{}] }, { shared_with_me: 'false' }, { expression: { op: 'and', clauses: [] } }]) {
      assert.throws(() => normalizeSearchRequest(request), e => e.code === 'invalid_request');
    }
    assert.throws(() => normalizeExpression({ op: 'not', clause: null }), e => e.code === 'invalid_request');
    assert.throws(() => normalizeSearchRequest({ query: 'foo', expression: term('bar') }), e => e.code === 'invalid_request');
  });
};
