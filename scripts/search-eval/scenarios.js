'use strict';

const { BASE_TIME, USERS } = require('./corpus');

const term = (value, field) => ({ field: field || 'text', match: 'term', value });
const phrase = (value) => ({ field: 'text', match: 'phrase', value });
const and = (...clauses) => ({ op: 'and', clauses });
const or = (...clauses) => ({ op: 'or', clauses });
const not = (clause) => ({ op: 'not', clause });

const EXPRESSIONS = {
  'rare-current-content': term('quorumneedle'), 'common-term-full-recall': term('operations'),
  'implicit-and': and(term('incident'), term('Lisbon')),
  'explicit-and': and(term('incident'), term('Lisbon')),
  'phrase-order': phrase('incident response'), 'or': or(term('incident'), term('release')),
  'not': and(term('operations'), not(term('archived'))),
  'grouped-boolean': and(or(term('incident'), term('release')), term('Lisbon')),
  'title-field': term('headlinebeacon', 'title'), 'filename-field': term('pathbeacon', 'filename'),
  'body-field': term('bodybeacon', 'body'), 'all-tags': term('operations'),
  'any-tags': term('operations'), 'author-filter': term('operations'),
  'workspace-filter': term('operations'), 'project-filter': term('operations'),
  'explicit-document-subset': term('operations'), 'updated-lower-bound': term('operations'),
  'updated-upper-bound': term('operations'), 'combined-metadata-and-text': or(term('Lisbon'), term('Berlin')),
  'negative-hidden-body': term('classifiedcanary'), 'negative-hidden-tag': term('classifiedfacet'),
  'outsider': term('operations'), prefix: { field: 'text', match: 'prefix', value: 'helios' },
  'whole-token': term('helios'), 'phrase-across-whitespace': phrase('silver compass'),
  'unicode-canonical': term('café'), 'unicode-cjk': term('東京会議で検索を確認する'),
  'punctuation-phrase': phrase('node.js'),
  'excluded-tags': term('operations'), 'created-lower-bound': term('operations'),
  'created-upper-bound': term('operations'), 'own-documents': term('operations'),
  'last-editor-filter': term('operations'), 'restricted-fields': term('operations'),
  'nested-not': and(term('operations'), not(or(term('incident'), term('release')))),
  'negative-only': not(term('classifiedcanary')),
  'empty-document-subset': term('operations'),
};

// Each predicate is a fact from the generation recipe. There is deliberately no
// reference query parser: changing a product parser cannot change this oracle.
function scenarios(corpus) {
  return [
    { id: 'rare-current-content', query: 'quorumneedle', matches: (d) => d.rare },
    { id: 'common-term-full-recall', query: 'operations', matches: () => true },
    { id: 'implicit-and', query: 'incident Lisbon', matches: (d) => (d.topic === 'incident' || d.special === 'quotes') && d.region === 'lisbon' },
    { id: 'explicit-and', query: 'incident AND Lisbon', matches: (d) => (d.topic === 'incident' || d.special === 'quotes') && d.region === 'lisbon' },
    { id: 'phrase-order', query: '"incident response"', matches: (d) => d.topic === 'incident' || d.special === 'quotes' },
    { id: 'or', query: 'incident OR release', matches: (d) => ['incident', 'release'].includes(d.topic) || d.special === 'quotes' },
    { id: 'not', query: 'operations NOT archived', matches: (d) => d.stage !== 'archived' },
    { id: 'grouped-boolean', query: '(incident OR release) AND Lisbon', matches: (d) =>
      (['incident', 'release'].includes(d.topic) || d.special === 'quotes') && d.region === 'lisbon' },
    { id: 'title-field', query: 'title:headlinebeacon', matches: (d) => d.titleMarker },
    { id: 'filename-field', query: 'filename:pathbeacon', matches: (d) => d.fileMarker },
    { id: 'body-field', query: 'body:bodybeacon', matches: (d) => d.bodyMarker },
    { id: 'all-tags', query: 'operations', tags: ['incident', 'lisbon'], matches: () => true },
    { id: 'any-tags', query: 'operations', tagsAny: ['incident', 'release'], matches: () => true },
    { id: 'author-filter', query: 'operations', authors: [USERS.alice], matches: () => true },
    { id: 'workspace-filter', query: 'operations', workspace: 'a', matches: () => true },
    { id: 'project-filter', query: 'operations', workspace: 'b', project: 2, matches: () => true },
    { id: 'explicit-document-subset', query: 'operations',
      documentIds: corpus.filter((d) => d.ordinal % 37 === 0).slice(0, 100).map((d) => d.id), matches: () => true },
    { id: 'updated-lower-bound', query: 'operations', updatedAfter: BASE_TIME + 10000, matches: () => true },
    { id: 'updated-upper-bound', query: 'operations', updatedBefore: BASE_TIME + 5000, matches: () => true },
    { id: 'combined-metadata-and-text', query: 'Lisbon OR Berlin', tags: ['approved'],
      authors: [USERS.bob], matches: (d) => ['lisbon', 'berlin'].includes(d.region) },
    { id: 'negative-hidden-body', query: 'classifiedcanary', matches: () => false },
    { id: 'negative-hidden-tag', query: 'classifiedfacet', matches: () => false },
    { id: 'outsider', query: 'operations', userId: USERS.outsider, matches: () => true },
    { id: 'prefix', query: 'helios*', matches: (d) => ['prefix-short', 'prefix-long'].includes(d.special) },
    { id: 'whole-token', query: 'helios', matches: (d) => d.special === 'prefix-short' },
    { id: 'phrase-across-whitespace', query: '"silver compass"', matches: (d) => d.special === 'phrase-boundary' },
    { id: 'unicode-canonical', query: 'café', matches: (d) => ['unicode-composed', 'unicode-decomposed'].includes(d.special) },
    { id: 'unicode-cjk', query: '東京会議で検索を確認する', matches: (d) => d.special === 'cjk' },
    { id: 'punctuation-phrase', query: '"node.js"', matches: (d) => ['cpp', 'punctuation-control'].includes(d.special) },
    { id: 'excluded-tags', query: 'operations', tagsNone: ['archived', 'proposed'], matches: () => true },
    { id: 'created-lower-bound', query: 'operations', createdAfter: BASE_TIME + 10000, matches: () => true },
    { id: 'created-upper-bound', query: 'operations', createdBefore: BASE_TIME + 5000, matches: () => true },
    { id: 'own-documents', query: 'operations', userId: USERS.alice, authors: [USERS.alice], sharedWithMe: false, matches: () => true },
    { id: 'last-editor-filter', query: 'operations', updatedBy: [USERS.carol], matches: () => true },
    { id: 'restricted-fields', query: 'operations', fields: ['title'], matches: () => false },
    { id: 'nested-not', query: 'operations NOT (incident OR release)', matches: (d) =>
      !['incident', 'release'].includes(d.topic) && d.special !== 'quotes' },
    { id: 'negative-only', query: 'NOT classifiedcanary', matches: () => true },
    { id: 'empty-document-subset', query: 'operations', documentIds: [], matches: () => true },
  ].map((scenario) => ({ ...scenario, expression: EXPRESSIONS[scenario.id] }));
}

module.exports = { scenarios };
