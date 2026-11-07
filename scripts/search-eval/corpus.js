'use strict';

// The manifest is the ground truth. Expected result sets come from these facts,
// never from a production tokenizer, query parser, SQL query, or search result.
const USERS = {
  owner: 'usr_search_eval_owner', reader: 'usr_search_eval_reader',
  alice: 'usr_search_eval_alice', bob: 'usr_search_eval_bob',
  carol: 'usr_search_eval_carol', outsider: 'usr_search_eval_outsider',
};
const AUTHORS = [USERS.alice, USERS.bob, USERS.carol];
const TOPICS = [
  ['incident', 'incident response'], ['release', 'release readiness'],
  ['budget', 'budget forecast'], ['hiring', 'hiring pipeline'],
  ['latency', 'latency analysis'], ['compliance', 'compliance review'],
  ['renewal', 'renewal schedule'], ['inventory', 'inventory ledger'],
];
const REGIONS = ['Lisbon', 'Berlin', 'Oslo', 'Tokyo', 'Nairobi'];
const STAGES = ['draft', 'approved', 'archived', 'proposed'];
const BASE_TIME = Date.parse('2026-01-01T00:00:00.000Z');
const SPECIAL = [
  { key: 'cpp', text: 'The C++ client integrates node.js, C# and RFC-9110.' },
  { key: 'punctuation-control', text: 'The C client integrates node js, C and RFC 9110.' },
  { key: 'unicode-composed', text: 'The café résumé describes naïve São Paulo delegates.' },
  { key: 'unicode-decomposed', text: 'The cafe\u0301 re\u0301sume\u0301 describes nai\u0308ve delegates.' },
  { key: 'cjk', text: '東京会議で検索を確認する。' },
  { key: 'emoji', text: 'Launch signal 🚀 has a distinct status.' },
  { key: 'quotes', text: 'The author wrote "incident response" in the incident response runbook.' },
  { key: 'literal-operators', text: 'The string AND OR NOT appears in source code.' },
  { key: 'prefix-short', text: 'The short marker helios starts here.' },
  { key: 'prefix-long', text: 'The long marker heliosphere starts here.' },
  { key: 'phrase-boundary', text: 'A silver\n\ncompass marks the assembly point.' },
  { key: 'phrase-reversed', text: 'A compass made of silver marks the assembly point.' },
];

function makeDocument(ordinal, options) {
  options = options || {};
  const topic = TOPICS[ordinal % TOPICS.length];
  const region = REGIONS[Math.floor(ordinal / 8) % REGIONS.length];
  const stage = STAGES[Math.floor(ordinal / 40) % STAGES.length];
  const special = SPECIAL[ordinal] || null;
  const workspace = special ? 'a' : ['a', 'b', 'closed'][Math.floor(ordinal / 3) % 3];
  const permission = special || options.allVisible ? 'everyone'
    : ['private', 'everyone', 'reader', 'other'][Math.floor(ordinal / 13) % 4];
  const author = AUTHORS[Math.floor(ordinal / 7) % AUTHORS.length];
  const denied = !options.allVisible && (workspace === 'closed' || !['everyone', 'reader'].includes(permission));
  const titleMarker = ordinal % 17 === 0;
  const fileMarker = ordinal % 19 === 0;
  const bodyMarker = ordinal % 23 === 0;
  const tagMarker = ordinal % 29 === 0;
  const rare = ordinal % 997 === 0;
  const tags = [topic[0], region.toLowerCase(), stage];
  if (tagMarker) tags.push('tagbeacon');
  if (denied) tags.push('classifiedfacet');
  const title = `${topic[0]} ${region} ${ordinal}${titleMarker ? ' headlinebeacon' : ''}`;
  const filename = `${fileMarker ? 'pathbeacon-' : 'record-'}${ordinal}.md`;
  const lines = [
    `# ${title}`, '',
    `Operations ${topic[1]} for ${region} is ${stage}.`,
    `The record number is ${ordinal}. The assigned review cycle has an operational owner.`,
    `Review evidence includes capacity estimates, service measurements and a written decision.`,
    bodyMarker ? 'The bodybeacon checkpoint carries a separate observation.' : 'The checkpoint carries a separate observation.',
    rare ? 'The quorumneedle evidence is ready for investigation.' : 'The evidence is ready for investigation.',
    special ? special.text : 'This reference supports the next planning session.',
    denied ? 'classifiedcanary private evidence must stay within the assigned readership.' : 'The assigned readership can consult this operational evidence.',
  ];
  const markdown = ['---', `title: ${title}`, 'tags:', ...tags.map((tag) => `  - ${tag}`),
    '---', ...lines, ''].join('\n');
  return {
    ordinal, id: `e0000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`,
    workspace, project: ordinal % 4, author, permission, topic: topic[0],
    region: region.toLowerCase(), stage, tags, title, filename, markdown,
    titleMarker, fileMarker, bodyMarker, tagMarker, rare,
    special: special && special.key,
    createdAt: BASE_TIME + Math.floor(ordinal / 5) * 1000,
    updatedAt: BASE_TIME + Math.floor(ordinal / 5) * 1000,
    deleted: false,
  };
}

function createCorpus(count, options) {
  if (!Number.isSafeInteger(count) || count < SPECIAL.length) {
    throw new Error(`Corpus must contain at least ${SPECIAL.length} documents`);
  }
  return Array.from({ length: count }, (_, ordinal) => makeDocument(ordinal, options));
}

function visible(document, userId, memberships) {
  if (document.deleted || !(memberships[userId] || []).includes(document.workspace)) return false;
  return document.author === userId || document.permission === 'everyone' ||
    (document.permission === 'reader' && userId === USERS.reader) ||
    (document.permission === 'other' && userId === USERS.owner);
}

function defaultMemberships() {
  return {
    [USERS.owner]: ['a', 'b', 'closed'], [USERS.reader]: ['a', 'b'],
    [USERS.alice]: ['a', 'b', 'closed'], [USERS.bob]: ['a', 'b', 'closed'],
    [USERS.carol]: ['a', 'b', 'closed'], [USERS.outsider]: [],
  };
}

function expectedDocuments(corpus, scenario, context) {
  const userId = scenario.userId || USERS.reader;
  return corpus.filter((document) => visible(document, userId, context.memberships) &&
    (!scenario.workspace || document.workspace === scenario.workspace) &&
    (scenario.project == null || document.project === scenario.project) &&
    (!scenario.documentIds || scenario.documentIds.includes(document.id)) &&
    (!scenario.authors || scenario.authors.includes(document.author)) &&
    (!scenario.updatedBy || scenario.updatedBy.includes(document.lastEditor || document.author)) &&
    (scenario.sharedWithMe == null || (document.author !== userId) === scenario.sharedWithMe) &&
    (!scenario.tags || scenario.tags.every((tag) => document.tags.includes(tag))) &&
    (!scenario.tagsAny || scenario.tagsAny.some((tag) => document.tags.includes(tag))) &&
    (!scenario.tagsNone || scenario.tagsNone.every((tag) => !document.tags.includes(tag))) &&
    (!scenario.createdAfter || document.createdAt >= scenario.createdAfter) &&
    (!scenario.createdBefore || document.createdAt <= scenario.createdBefore) &&
    (!scenario.updatedAfter || document.updatedAt >= scenario.updatedAfter) &&
    (!scenario.updatedBefore || document.updatedAt <= scenario.updatedBefore) &&
    scenario.matches(document));
}

function expectedFacets(documents) {
  const tags = new Map();
  const authors = new Map();
  const workspaces = new Map();
  for (const document of documents) {
    for (const tag of document.tags) tags.set(tag, (tags.get(tag) || 0) + 1);
    authors.set(document.author, (authors.get(document.author) || 0) + 1);
    workspaces.set(document.workspace, (workspaces.get(document.workspace) || 0) + 1);
  }
  return { tags, authors, workspaces };
}

module.exports = { AUTHORS, BASE_TIME, SPECIAL, USERS, createCorpus, defaultMemberships,
  expectedDocuments, expectedFacets, makeDocument, visible };
