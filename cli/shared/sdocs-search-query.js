(function (exports) {
  'use strict';

  var TEXT_FIELDS = ['title', 'filename', 'tags', 'body'];
  var SORTS = ['relevance', 'updated_desc', 'created_desc'];
  var FACETS = ['tags', 'authors', 'libraries'];

  function invalid(message, position) {
    var error = new Error((position == null ? '' : 'Search syntax at character ' + (position + 1) + ': ') + message);
    error.code = 'invalid_request';
    error.details = { field: 'search', position: position == null ? null : position, suggestion: 'Quote phrases, use AND/OR/NOT with parentheses, or use --literal to match the input as text.' };
    return error;
  }

  function lex(source) {
    var values = [], i = 0;
    while (i < source.length) {
      if (/\s/u.test(source[i])) { i++; continue; }
      var at = i, char = source[i];
      if (char === '(' || char === ')' || char === ':') { values.push({ type: char, value: char, at: i++ }); continue; }
      if (char === '"') {
        i++; var text = '', closed = false;
        while (i < source.length) {
          if (source[i] === '\\' && i + 1 < source.length && /["\\]/.test(source[i + 1])) { text += source[++i]; i++; }
          else if (source[i] === '"') { i++; closed = true; break; }
          else text += source[i++];
        }
        if (!closed) throw invalid('Close the double-quoted phrase.', at);
        if (!text.trim()) throw invalid('A quoted phrase must contain text.', at);
        values.push({ type: 'phrase', value: text, at: at }); continue;
      }
      var start = i;
      while (i < source.length && !/[\s():"]/u.test(source[i])) i++;
      var value = source.slice(start, i);
      values.push({ type: ['AND', 'OR', 'NOT'].includes(value) ? value : 'word', value: value, at: at });
    }
    values.push({ type: 'end', at: source.length });
    return values;
  }

  function parseQuery(source) {
    if (typeof source !== 'string') throw invalid('Query must be text.');
    if (source.length > 16384) throw invalid('Query is too long. Use metadata filters or split the research into several searches.');
    if (!source.trim()) return null;
    var tokens = lex(source), index = 0, nesting = 0;
    function peek() { return tokens[index]; }
    function take(type) { if (peek().type === type) return tokens[index++]; return null; }
    function combine(op, left, right) {
      var clauses = left && left.op === op ? left.clauses.slice() : [left];
      if (right && right.op === op) clauses.push.apply(clauses, right.clauses); else clauses.push(right);
      return { op: op, clauses: clauses };
    }
    function atom() {
      if (take('(')) {
        if (++nesting > 64) throw invalid('Too many nested groups.', peek().at);
        var expression = or();
        if (!take(')')) throw invalid('Close the parenthesized group.', peek().at);
        nesting--; return expression;
      }
      var field = 'text';
      if (peek().type === 'word' && tokens[index + 1].type === ':') {
        var prefix = tokens[index++]; index++;
        field = prefix.value;
        if (!TEXT_FIELDS.concat(['text', 'tag', 'author']).includes(field)) throw invalid('Unknown field "' + field + '". Use title, filename, tags, body, tag, or author.', prefix.at);
      }
      var token = peek();
      if (token.type !== 'word' && token.type !== 'phrase') throw invalid('Expected a search term, quoted phrase, or group.', token.at);
      index++;
      if (field === 'tag' || field === 'author') return { field: field, value: token.value };
      var match = token.type === 'phrase' ? 'phrase' : 'term';
      var text = token.value;
      if (match === 'term' && text.endsWith('*')) { match = 'prefix'; text = text.slice(0, -1); }
      if (!text || (match !== 'phrase' && text.includes('*'))) throw invalid('Use * only at the end of a nonempty term. Use --literal for literal asterisks.', token.at);
      return { field: field, match: match, value: text };
    }
    function unary() {
      if (take('NOT')) {
        if (++nesting > 64) throw invalid('Too many nested exclusions.', peek().at);
        var value = { op: 'not', clause: unary() }; nesting--; return value;
      }
      return atom();
    }
    function and() {
      var value = unary();
      while (true) {
        if (take('AND')) value = combine('and', value, unary());
        else if (['word', 'phrase', '(', 'NOT'].includes(peek().type)) value = combine('and', value, unary());
        else return value;
      }
    }
    function or() { var value = and(); while (take('OR')) value = combine('or', value, and()); return value; }
    var result = or();
    if (peek().type !== 'end') throw invalid('Unexpected ' + peek().type + '.', peek().at);
    return normalizeExpression(result);
  }

  function normalizeExpression(expression) {
    var nodes = 0;
    function visit(value, depth) {
      if (++nodes > 2048 || depth > 64) throw invalid('Expression has too many clauses or nested groups.');
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Each expression clause must be an object.');
      if (value.op) {
        if (value.op === 'not') return { op: 'not', clause: visit(value.clause, depth + 1) };
        if (!['and', 'or'].includes(value.op) || !Array.isArray(value.clauses) || !value.clauses.length) throw invalid('AND/OR expressions need a nonempty clauses array.');
        return { op: value.op, clauses: value.clauses.map(function (clause) { return visit(clause, depth + 1); }) };
      }
      if (!TEXT_FIELDS.concat(['text', 'tag', 'author']).includes(value.field)) throw invalid('Unknown expression field.');
      if (typeof value.value !== 'string' || !value.value.trim() || value.value.length > 16384) throw invalid('Expression values must contain text.');
      if (['tag', 'author'].includes(value.field)) return { field: value.field, value: value.value.trim() };
      if (!['term', 'phrase', 'prefix'].includes(value.match)) throw invalid('Text match must be term, phrase, or prefix.');
      return { field: value.field, match: value.match, value: value.value.trim() };
    }
    return expression == null ? null : visit(expression, 0);
  }

  // Optional lexical expansion, not stemming or semantic search. Keep quoted
  // phrases, prefixes, metadata and multi-word identifiers unchanged.
  function expandWordForms(expression) {
    if (!expression) return expression;
    if (expression.op === 'not') return { op: 'not', clause: expandWordForms(expression.clause) };
    if (expression.clauses) return { op: expression.op, clauses: expression.clauses.map(expandWordForms) };
    if (expression.match !== 'term' || !/^[a-zA-Z]{3,}$/.test(expression.value)) return expression;
    var word = expression.value.toLowerCase(), forms = [word];
    var irregular = { person: 'people', child: 'children', man: 'men', woman: 'women', analysis: 'analyses', criterion: 'criteria', index: 'indices', matrix: 'matrices' };
    var singular = Object.keys(irregular).find(function (key) { return irregular[key] === word; });
    if (irregular[word]) forms.push(irregular[word]);
    else if (singular) forms.push(singular);
    else if (/[^aeiou]ies$/.test(word)) forms.push(word.slice(0, -3) + 'y');
    else if (/(?:s|x|z|ch|sh)es$/.test(word)) forms.push(word.slice(0, -2));
    else if (/s$/.test(word) && !/(?:ss|us|is)$/.test(word)) forms.push(word.slice(0, -1));
    else if (/[^aeiou]y$/.test(word)) forms.push(word.slice(0, -1) + 'ies');
    else if (/(?:s|x|z|ch|sh)$/.test(word) && !/(?:us|is)$/.test(word)) forms.push(word + 'es');
    else if (!/s$/.test(word)) forms.push(word + 's');
    return forms.length === 1 ? expression : { op: 'or', clauses: forms.map(function (value) { return { field: expression.field, match: 'term', value: value }; }) };
  }

  function list(value, name, maximum) {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > (maximum || 1000)) throw invalid(name + ' must be an array' + (maximum ? ' of at most ' + maximum + ' entries.' : '.'));
    if (value.some(function (item) { return typeof item !== 'string' || !item.trim() || item.length > 512; })) throw invalid(name + ' entries must be nonempty strings.');
    return Array.from(new Set(value.map(function (item) { return item.trim(); }))).sort();
  }

  function integer(value, name, fallback, maximum, minimum) {
    if (value == null) return fallback;
    minimum = minimum == null ? 1 : minimum;
    if (!Number.isSafeInteger(Number(value)) || Number(value) < minimum || Number(value) > maximum) throw invalid(name + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
    return Number(value);
  }

  function normalizeSearchRequest(input, context) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Search request must be an object.');
    context = context || {};
    var expression = normalizeExpression(input.expression);
    if (input.query != null && typeof input.query !== 'string') throw invalid('Query must be text.');
    if (input.query && input.query.length > 16384) throw invalid('Query is too long.');
    if (input.mode != null && !['literal', 'query'].includes(input.mode)) throw invalid('Mode must be literal or query.');
    if (expression && input.query && input.query.trim()) throw invalid('Use query or expression, not both.');
    var query = input.query && input.query.trim() || '';
    if (input.mode === 'query' && query) { expression = parseQuery(query); query = ''; }
    if (input.word_forms != null && typeof input.word_forms !== 'boolean') throw invalid('word_forms must be true or false.');
    if (input.word_forms) expression = expandWordForms(expression);
    var fields = list(input.fields, 'fields');
    if (fields.some(function (field) { return !TEXT_FIELDS.includes(field); })) throw invalid('Fields must be title, filename, tags, or body.');
    var facets = input.facets === true ? FACETS.slice() : list(input.facets, 'facets');
    if (facets.some(function (field) { return !FACETS.includes(field); })) throw invalid('Facets must be tags, authors, or libraries.');
    var sort = input.sort || (expression ? 'relevance' : 'updated_desc');
    if (!SORTS.includes(sort)) throw invalid('Sort must be relevance, updated_desc, or created_desc.');
    function id(value, name) { if (value == null || value === '') return null; if (typeof value !== 'string' || value.length > (name === 'cursor' ? 4096 : 512)) throw invalid(name + ' must be an ID.'); return value; }
    function date(value, name) {
      if (value == null || value === '') return null;
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*Z|T.*[+-]\d{2}:\d{2})?$/.test(value) || !Number.isFinite(Date.parse(value))) throw invalid(name + ' must be an ISO date or date-time with a time zone.');
      var calendar = value.slice(0, 10);
      if (new Date(calendar + 'T00:00:00Z').toISOString().slice(0, 10) !== calendar) throw invalid(name + ' must be a real calendar date.');
      var timestamp = Date.parse(value);
      if (value.length === 10 && /Before$|_before$/.test(name)) timestamp += 86400000 - 1;
      return new Date(timestamp).toISOString();
    }
    function authors(value, name) { var values = Array.from(new Set(list(value, name).map(function (id) { return id === 'me' && context.userId ? context.userId : id; }))).sort(); return values.length ? values : undefined; }
    var result = { expression: expression, query: query, workspaceId: id(input.workspace_id || input.account_id, 'workspace_id'), projectId: id(input.project_id, 'project_id'),
      tags: list(input.tags, 'tags'), tagsAny: list(input.tags_any, 'tags_any'), tagsNone: list(input.tags_none, 'tags_none'),
      authorUserIds: authors(input.author_user_ids, 'author_user_ids'), updatedByUserIds: authors(input.updated_by_user_ids, 'updated_by_user_ids'),
      documentIds: input.document_ids == null ? undefined : list(input.document_ids, 'document_ids', 100000), sharedWithMe: input.shared_with_me === true, starredOnly: input.starred_only === true,
      createdAfter: date(input.created_after, 'created_after'), createdBefore: date(input.created_before, 'created_before'),
      updatedAfter: date(input.updated_after, 'updated_after'), updatedBefore: date(input.updated_before, 'updated_before'),
      fields: fields.length ? fields : TEXT_FIELDS.slice(), sort: sort, facets: facets,
      limit: integer(input.limit, 'limit', 50, 100), facetLimit: integer(input.facet_limit, 'facet_limit', 50, 1000),
      matchLimit: integer(input.match_limit, 'match_limit', 5, 100, 0), cursor: id(input.cursor, 'cursor') };
    if (input.starred_only != null && typeof input.starred_only !== 'boolean') throw invalid('starred_only must be true or false.');
    if (input.shared_with_me != null && typeof input.shared_with_me !== 'boolean') throw invalid('shared_with_me must be true or false.');
    if (result.createdAfter && result.createdBefore && result.createdAfter > result.createdBefore || result.updatedAfter && result.updatedBefore && result.updatedAfter > result.updatedBefore) throw invalid('Date ranges must put after before before.');
    return result;
  }

  exports.parseQuery = parseQuery;
  exports.normalizeExpression = normalizeExpression;
  exports.expandWordForms = expandWordForms;
  exports.normalizeSearchRequest = normalizeSearchRequest;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocsSearchQuery = {}));
