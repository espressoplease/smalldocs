#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { performance } = require('perf_hooks');
const { createAdapter } = require('./adapter');
const { BASE_TIME, USERS, createCorpus, expectedDocuments, expectedFacets, makeDocument } = require('./corpus');
const { createFixture, openFixture } = require('./fixture');
const { generatedScenarios } = require('./generated');
const { assertEvidence } = require('./evidence');
const { assertPerfectRetrieval, retrieval, timed, timingSummary } = require('./measure');
const { scenarios } = require('./scenarios');

function parseArgs(argv) {
  const options = { documents: 1200, repetitions: 7, keep: false, selected: [], pageSize: 100, randomCases: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--documents') options.documents = Number(argv[++index]);
    else if (arg === '--repetitions') options.repetitions = Number(argv[++index]);
    else if (arg === '--page-size') options.pageSize = Number(argv[++index]);
    else if (arg === '--output') options.output = path.resolve(argv[++index]);
    else if (arg === '--scenarios') options.selected = String(argv[++index]).split(',');
    else if (arg === '--keep') options.keep = true;
    else if (arg === '--all-visible') options.allVisible = true;
    else if (arg === '--benchmark-only') options.benchmarkOnly = true;
    else if (arg === '--fixture') options.fixture = path.resolve(argv[++index]);
    else if (arg === '--cold-probe') options.coldProbe = path.resolve(argv[++index]);
    else if (arg === '--random-cases') options.randomCases = Number(argv[++index]);
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown argument ${arg}`);
  }
  for (const field of ['documents', 'repetitions', 'pageSize']) {
    if (!Number.isSafeInteger(options[field]) || options[field] < 1) throw new Error(`Invalid ${field}`);
  }
  if (options.pageSize > 100) throw new Error('page-size must be at most 100');
  if (!Number.isSafeInteger(options.randomCases) || options.randomCases < 0) throw new Error('Invalid random-cases');
  return options;
}

function sortedEntries(map) {
  return [...map].sort((a, b) => a[0].localeCompare(b[0]));
}

function checkFacets(actual, expected, context, id) {
  assert.ok(actual && typeof actual === 'object', `${id}: missing facets`);
  const tagMap = new Map((actual.tags || []).map((row) => [row.tag, row.document_count]));
  const authorMap = new Map((actual.authors || []).map((row) => [row.user_id, row.document_count]));
  const libraryMap = new Map((actual.libraries || []).map((row) => [row.id, row.document_count]));
  const expectedLibraries = new Map([...expected.workspaces].map(([name, count]) => [context.workspaces[name], count]));
  assert.deepEqual(sortedEntries(tagMap), sortedEntries(expected.tags), `${id}: tag facets differ from authorized truth`);
  assert.deepEqual(sortedEntries(authorMap), sortedEntries(expected.authors), `${id}: author facets differ from authorized truth`);
  assert.deepEqual(sortedEntries(libraryMap), sortedEntries(expectedLibraries), `${id}: library facets differ from authorized truth`);
}

function checkDocuments(documents, corpusById, scenario) {
  const id = scenario.id;
  const evidence = { documents: 0, documents_with_positive_evidence: 0, snippets: 0, highlights: 0 };
  for (const document of documents) {
    const truth = corpusById.get(document.id);
    assert.ok(truth, `${id}: unknown document ${document.id}`);
    assert.equal(document.title, truth.title, `${id}: current title differs`);
    assert.equal(document.filename, truth.filename, `${id}: current filename differs`);
    assert.deepEqual(document.tags.slice().sort(), truth.tags.slice().sort(), `${id}: current tags differ`);
    assert.equal(Object.hasOwn(document, 'markdown'), false, `${id}: search returned a full document`);
    if (!scenario.userId || scenario.userId === USERS.reader) {
      assert.equal(JSON.stringify(document).includes('classifiedcanary'), false, `${id}: private snippet leaked`);
    }
    if (document.score != null) assert.ok(Number.isFinite(document.score), `${id}: non-finite score`);
    const checked = assertEvidence(document, truth, scenario);
    for (const key of Object.keys(evidence)) evidence[key] += checked[key];
  }
  return evidence;
}

async function evaluateScenario(scenario, context, adapter, options) {
  const expected = expectedDocuments(context.corpus, scenario, context);
  const expectedIds = expected.map((document) => document.id);
  const facets = expectedFacets(expected);
  const ids = [];
  const cursors = new Set();
  const times = [];
  let after;
  let pageCount = 0;
  let decryptions = 0;
  const evidence = { documents: 0, documents_with_positive_evidence: 0, snippets: 0, highlights: 0 };
  const corpusById = new Map(context.corpus.map((document) => [document.id, document]));
  do {
    const sample = await timed(() => adapter.search(adapter.requestFor(scenario,
      { after, limit: options.pageSize })));
    const page = sample.result;
    times.push(sample.milliseconds);
    pageCount += 1;
    assert.ok(page && Array.isArray(page.documents), `${scenario.id}: missing documents[]`);
    assert.ok(page.documents.length <= options.pageSize, `${scenario.id}: page exceeds requested size`);
    assert.equal(page.total_count, expected.length, `${scenario.id}: count includes denied or misses matching documents`);
    checkFacets(page.facets, facets, context, scenario.id);
    const checked = checkDocuments(page.documents, corpusById, scenario);
    for (const key of Object.keys(evidence)) evidence[key] += checked[key];
    ids.push(...page.documents.map((document) => document.id));
    if (page.has_more) {
      assert.ok(page.nextPosition, `${scenario.id}: has_more without continuation`);
      assert.ok(page.documents.length, `${scenario.id}: empty page with continuation`);
    }
    after = page.nextPosition || null;
    if (after) {
      const key = JSON.stringify(after);
      assert.equal(cursors.has(key), false, `${scenario.id}: cursor repeated`);
      cursors.add(key);
    }
    assert.ok(pageCount <= Math.ceil(context.corpus.length / options.pageSize) + 2,
      `${scenario.id}: unbounded pagination`);
    decryptions += context.takeDecryptions ? context.takeDecryptions() : 0;
  } while (after);
  const measurement = retrieval(ids, expectedIds);
  assertPerfectRetrieval(measurement, scenario.id);
  return { id: scenario.id, query: scenario.query, ...measurement, pages: pageCount,
    page_timing: timingSummary(times), decrypted_revisions: decryptions, evidence_provenance: evidence };
}

function comparable(page) {
  return { documents: page.documents.map((document) => ({ id: document.id,
    score: document.score, matches: document.matches, title: document.title, tags: document.tags })),
    total_count: page.total_count, facets: page.facets,
    has_more: page.has_more, nextPosition: page.nextPosition };
}

async function hiddenInfluence(context, adapter) {
  const scenario = { id: 'hidden-data-influence', expression: { field: 'text', match: 'term', value: 'operations' },
    matches: () => true };
  const request = adapter.requestFor(scenario, { limit: 17 });
  const before = comparable(await adapter.search(request));
  const base = context.corpus.length + 1000000;
  for (let index = 0; index < 13; index += 1) {
    const document = makeDocument(base + index);
    document.workspace = 'a';
    document.permission = 'private';
    document.markdown = `---\ntitle: classifiedcanary unique secret\ntags:\n  - classifiedfacet\n---\n# classifiedcanary\n${'operations '.repeat(1000)}\n`;
    document.title = 'classifiedcanary unique secret';
    document.tags = ['classifiedfacet'];
    await context.seedDocument(document);
    context.corpus.push(document);
  }
  const after = comparable(await adapter.search(request));
  assert.deepEqual(after, before, 'Hidden documents changed visible counts, facets, rankings, scores, snippets, or pagination');
  return { id: 'hidden-data-influence', pass: true, injected_private_documents: 13 };
}

async function revokeBetweenPages(context, adapter) {
  const scenario = { id: 'revoke-between-pages', expression: { field: 'text', match: 'term', value: 'operations' },
    matches: () => true, sort: 'updated_desc' };
  const first = await adapter.search(adapter.requestFor(scenario, { limit: 2 }));
  assert.ok(first.nextPosition, 'Revocation scenario needs multiple pages');
  const nextBeforeRevocation = await adapter.search(adapter.requestFor(scenario,
    { limit: 100, after: first.nextPosition }));
  const target = context.corpus.find((document) => document.id === nextBeforeRevocation.documents[0].id);
  assert.ok(target, 'Revocation scenario needs an accessible non-owned document');
  context.store.setDocumentPermission({ userId: target.author, documentId: target.id,
    mode: 'custom', memberUserIds: [] });
  target.permission = 'private';
  let next;
  try {
    next = await adapter.search(adapter.requestFor(scenario, { limit: 100, after: first.nextPosition }));
  } catch (error) {
    // Expiring a cursor when the authorized corpus changes is also safe. A new
    // search is still checked against the fresh independent permission manifest.
    if (!['invalid_request', 'search_cursor_expired', 'cursor_expired'].includes(error.code)) throw error;
  }
  if (next) assert.equal(next.documents.some((document) => document.id === target.id), false,
    'A document revoked between pages was returned');
  const refreshed = await adapter.search(adapter.requestFor(scenario, { limit: 100 }));
  const expected = expectedDocuments(context.corpus, scenario, context);
  assert.equal(refreshed.total_count, expected.length, 'Revocation did not invalidate result count');
  checkFacets(refreshed.facets, expectedFacets(expected), context, scenario.id);
  const check = await adapter.search(adapter.requestFor({ ...scenario, documentIds: [target.id] }));
  assert.equal(check.total_count, 0, 'Explicit document IDs bypassed revocation');
  assert.deepEqual(check.documents, [], 'Revoked document leaked through explicit ID filter');
  return { id: 'revoke-between-pages', pass: true, revoked_document_id: target.id };
}

async function revokeDuringDecryption(context, adapter, foreignConnection) {
  const scenario = { id: foreignConnection ? 'revoke-through-second-connection' : 'revoke-during-decryption',
    expression: { field: 'text', match: 'term', value: 'operations' }, matches: () => true };
  const baseline = await adapter.search(adapter.requestFor(scenario, { limit: 3 }));
  const target = context.corpus.find((document) => document.id === baseline.documents[0].id);
  const original = context.store._decryptRevision;
  const second = foreignConnection ? openFixture(context.directory, { omitCorpus: true }) : null;
  let revoked = false;
  context.store._decryptRevision = async function(row) {
    const content = await original.call(this, row);
    if (!revoked && row.document_id === target.id) {
      revoked = true;
      (second ? second.store : this).setDocumentPermission({ userId: target.author, documentId: target.id,
        mode: 'custom', memberUserIds: [] });
      target.permission = 'private';
    }
    return content;
  };
  try {
    const result = await adapter.search(adapter.requestFor(scenario, { limit: 3 }));
    assert.equal(revoked, true, 'Concurrent revocation hook was not reached');
    assert.equal(result.documents.some((document) => document.id === target.id), false,
      'A document revoked while its body was being decrypted reached the response');
    const expected = expectedDocuments(context.corpus, scenario, context);
    assert.equal(result.total_count, expected.length, 'In-flight revocation leaked through total_count');
    checkFacets(result.facets, expectedFacets(expected), context, scenario.id);
    return { id: scenario.id, pass: true, revoked_document_id: target.id };
  } finally {
    context.store._decryptRevision = original;
    if (second) second.close();
  }
}

async function keyFailureIsAtomic(context, adapter) {
  const original = context.store._projectKey;
  let attempted = 0;
  context.store._projectKey = async () => {
    attempted += 1;
    throw Object.assign(new Error('encryption service is unavailable'), { code: 'temporary_service_failure' });
  };
  try {
    const expression = { field: 'text', match: 'term', value: 'operations' };
    await assert.rejects(() => adapter.search(adapter.requestFor({ expression })),
      (error) => error.code === 'temporary_service_failure', 'A key outage returned partial search results');
    assert.ok(attempted > 0, 'Key outage hook was not reached');
    attempted = 0;
    const denied = await adapter.search(adapter.requestFor({ expression, userId: USERS.outsider }));
    assert.equal(denied.total_count, 0);
    assert.deepEqual(denied.documents, []);
    assert.equal(attempted, 0, 'An unauthorized principal reached project decryption');
    return { id: 'key-failure-is-atomic', pass: true };
  } finally { context.store._projectKey = original; }
}

async function currentRevisionLifecycle(context, adapter) {
  const document = makeDocument(context.corpus.length + 2000000);
  document.workspace = 'a';
  document.permission = 'everyone';
  document.title = 'Fresh revision evidence';
  document.tags = ['beforetag'];
  document.markdown = '---\ntitle: Fresh revision evidence\ntags:\n  - beforetag\n---\n# Fresh revision evidence\nOperations oldrevisionneedle\n';
  context.setClock(BASE_TIME + 1000000000);
  document.createdAt = BASE_TIME + 1000000000;
  let saved = await context.seedDocument(document);
  context.corpus.push(document);
  const scenario = { id: 'revision-lifecycle', expression: { field: 'body', match: 'term', value: 'oldrevisionneedle' },
    documentIds: [document.id], matches: () => true };
  assert.equal((await adapter.search(adapter.requestFor(scenario))).total_count, 1);
  const longToken = 'pneumonoultramicroscopicsilicovolcanoconiosis'.repeat(1000);
  const newMarkdown = '---\ntitle: Revised evidence\ntags:\n  - aftertag\n---\n# Revised evidence\nOperations newrevisionneedle\n' + longToken + '\n';
  context.setClock(BASE_TIME + 1000001000);
  saved = await context.store.saveRevision({ userId: USERS.reader, documentId: document.id,
    filename: document.filename, markdown: newMarkdown,
    expectedHeadRevisionId: saved.current_revision_id, idempotencyKey: 'eval-current-revision-save' });
  const old = await adapter.search(adapter.requestFor(scenario));
  assert.equal(old.total_count, 0, 'Historical body remains searchable as current content');
  assert.deepEqual(old.documents, []);
  const revisedScenario = { ...scenario, expression: { field: 'body', match: 'term', value: 'newrevisionneedle' } };
  let current = await adapter.search(adapter.requestFor(revisedScenario));
  assert.equal(current.total_count, 1, 'New revision not indexed');
  assert.equal(current.documents[0].title, 'Revised evidence');
  assert.deepEqual(current.documents[0].tags, ['aftertag']);
  assert.deepEqual(current.facets.tags, [{ tag: 'aftertag', document_count: 1 }]);
  assert.equal((await adapter.search(adapter.requestFor({ ...revisedScenario,
    updatedBy: [USERS.reader] }))).total_count, 1, 'Last editor filter misses the new revision author');
  assert.equal((await adapter.search(adapter.requestFor({ ...revisedScenario,
    updatedBy: [document.author] }))).total_count, 0, 'Last editor filter uses the creator instead of the current revision author');
  assert.equal((await adapter.search(adapter.requestFor({ ...scenario,
    expression: { field: 'body', match: 'prefix', value: longToken.slice(0, 80) } }))).total_count, 1,
  'A prefix longer than the stored short-prefix dictionary lost its matching document');
  const expectedHeadRevisionId = saved.current_revision_id;
  context.store.deleteDocument({ userId: document.author, documentId: document.id, expectedHeadRevisionId });
  assert.equal((await adapter.search(adapter.requestFor(revisedScenario))).total_count, 0,
    'Deleted document remains searchable');
  await context.store.restoreDeletedDocument({ userId: document.author, documentId: document.id,
    expectedHeadRevisionId });
  current = await adapter.search(adapter.requestFor(revisedScenario));
  assert.equal(current.total_count, 1, 'Restored document is missing');
  document.markdown = newMarkdown;
  document.title = 'Revised evidence';
  document.tags = ['aftertag'];
  return { id: 'current-revision-lifecycle', pass: true };
}

async function membershipRevocation(context, adapter) {
  const scenario = { id: 'membership-revocation', expression: { field: 'text', match: 'term', value: 'operations' },
    matches: () => true };
  const staleScope = adapter.requestFor(scenario);
  context.store.removeWorkspaceMember({ actorUserId: USERS.owner,
    workspaceId: context.workspaces.b, userId: USERS.reader });
  context.memberships[USERS.reader] = context.memberships[USERS.reader].filter((name) => name !== 'b');
  let stale;
  try { stale = await adapter.search(staleScope); }
  catch (error) { if (error.code !== 'resource_unavailable') throw error; }
  if (stale) {
    const denied = new Set(context.corpus.filter((document) => document.workspace === 'b').map((document) => document.id));
    assert.equal(stale.documents.some((document) => denied.has(document.id)), false, 'A stale workspace scope bypassed membership revocation');
    const expected = expectedDocuments(context.corpus, scenario, context);
    assert.equal(stale.total_count, expected.length, 'Revoked membership leaked through count');
    checkFacets(stale.facets, expectedFacets(expected), context, scenario.id);
  }
  const fresh = await adapter.search(adapter.requestFor(scenario));
  assert.equal(fresh.total_count, expectedDocuments(context.corpus, scenario, context).length);
  return { id: 'membership-revocation', pass: true };
}

async function rebuildLegacyDocuments(context, adapter) {
  const scenario = { id: 'legacy-index-rebuild',
    expression: { field: 'text', match: 'term', value: 'operations' }, matches: () => true };
  const request = adapter.requestFor(scenario);
  const expected = expectedDocuments(context.corpus, scenario, context);
  // Only this disposable fixture is modified. Removing derived rows reproduces
  // an encrypted library created before search indexing was introduced.
  context.store.db.prepare('DELETE FROM cloud_search_documents').run();
  const allowedIds = new Set(expected.map((document) => document.id));
  const original = context.store._decryptRevision;
  let decrypted = 0;
  context.store._decryptRevision = async function(row) {
    assert.ok(allowedIds.has(row.document_id), 'Index rebuild decrypted an inaccessible document');
    decrypted += 1;
    return original.call(this, row);
  };
  let batches = 0;
  try {
    try {
      const first = await adapter.search(request);
      assert.equal(first.total_count, expected.length, 'A partially rebuilt index silently omitted documents');
    } catch (error) {
      assert.equal(error.code, 'search_index_building', 'Unexpected migration error');
    }
    let after;
    while (!context.store.searchIndexStatus(request).ready) {
      const batch = await context.store.rebuildSearchIndex({ ...request, limit: 137, after });
      batches += 1;
      after = batch.nextPosition;
      assert.ok(batches <= Math.ceil(expected.length / 100) + 2, 'Index migration stopped making progress');
    }
    const complete = await adapter.search(request);
    assert.equal(complete.total_count, expected.length);
    checkFacets(complete.facets, expectedFacets(expected), context, scenario.id);
    return { id: scenario.id, pass: true, explicit_batches: batches, decrypted_revisions: decrypted };
  } finally { context.store._decryptRevision = original; }
}

async function benchmark(context, adapter, options) {
  const cases = [
    { id: 'rare-term', expression: { field: 'text', match: 'term', value: 'quorumneedle' }, matches: (d) => d.rare },
    { id: 'broad-term', expression: { field: 'text', match: 'term', value: 'operations' }, matches: () => true },
    { id: 'broad-phrase', expression: { field: 'text', match: 'phrase', value: 'incident response' },
      matches: (d) => d.topic === 'incident' || d.special === 'quotes' },
    { id: 'prefix', expression: { field: 'text', match: 'prefix', value: 'operat' }, matches: () => true },
    { id: 'metadata-intersection', expression: { field: 'text', match: 'term', value: 'operations' },
      tags: ['approved', 'lisbon'], authors: [USERS.alice], matches: () => true },
    { id: 'negative', expression: { field: 'text', match: 'term', value: 'definitelyabsentneedle' }, matches: () => false },
  ];
  const reports = [];
  for (const scenario of cases) {
    const expected = expectedDocuments(context.corpus, scenario, context);
    const expectedIds = new Set(expected.map((document) => document.id));
    const values = [];
    let total = null;
    let decryptions = 0;
    for (let index = 0; index < options.repetitions; index += 1) {
      if (context.takeDecryptions) context.takeDecryptions();
      const sample = await timed(() => adapter.search(adapter.requestFor(scenario)));
      values.push(sample.milliseconds);
      total = sample.result.total_count;
      assert.equal(total, expected.length, `${scenario.id}: benchmark returned an incorrect total`);
      checkFacets(sample.result.facets, expectedFacets(expected), context, scenario.id);
      assert.ok(sample.result.documents.every((document) => expectedIds.has(document.id)),
        `${scenario.id}: benchmark returned irrelevant or denied documents`);
      decryptions += context.takeDecryptions ? context.takeDecryptions() : 0;
    }
    reports.push({ id: scenario.id, total_count: total, ...timingSummary(values),
      decrypted_revisions: decryptions });
    process.stderr.write(`Measured ${scenario.id}: ${total} matches, median ${Math.round(timingSummary(values).median_ms)} ms\n`);
  }
  return reports;
}

function assertBlindIndex(context) {
  const tables = context.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'cloud_search_%'")
    .all().map((row) => row.name);
  assert.ok(tables.length, 'No derived search index tables were found');
  const needles = ['classifiedcanary', 'headlinebeacon', 'incident response'];
  for (const table of tables) {
    assert.ok(/^\w+$/.test(table));
    const columns = context.store.db.prepare(`PRAGMA table_info(${table})`).all();
    for (const column of columns) {
      assert.ok(/^\w+$/.test(column.name));
      for (const needle of needles) {
        const found = context.store.db.prepare(`SELECT 1 FROM ${table} WHERE instr(CAST(${column.name} AS BLOB),?)>0 LIMIT 1`)
          .get(Buffer.from(needle));
        assert.equal(Boolean(found), false, `Derived search index ${table}.${column.name} stores plaintext ${needle}`);
      }
    }
  }
  return { id: 'blind-index-at-rest', pass: true, tables_checked: tables.length, plaintext_needles: needles };
}

function storageSummary(context) {
  const tables = context.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'cloud_search_%'").all();
  const rows = {};
  for (const { name } of tables) {
    assert.ok(/^\w+$/.test(name));
    rows[name] = context.store.db.prepare(`SELECT count(*) AS count FROM ${name}`).get().count;
  }
  const pageCount = context.store.db.pragma('page_count', { simple: true });
  const pageSize = context.store.db.pragma('page_size', { simple: true });
  return { sqlite_allocated_bytes: pageCount * pageSize, search_table_rows: rows };
}

async function largePagination(context, adapter) {
  const scenario = { id: 'large-pagination-boundaries', sort: 'updated_desc',
    expression: { field: 'text', match: 'term', value: 'operations' }, matches: () => true };
  const expected = expectedDocuments(context.corpus, scenario, context)
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
  const corpusById = new Map(context.corpus.map((document) => [document.id, document]));
  const offsets = [...new Set([0, 37, Math.floor(expected.length / 2) + 3,
    Math.max(0, expected.length - 77)])].filter((offset) => offset < expected.length);
  const samples = [];
  for (const offset of offsets) {
    const previous = offset ? expected[offset - 1] : null;
    const after = previous ? { id: previous.id, score: 0,
      created_at_ms: previous.createdAt, updated_at_ms: previous.updatedAt } : undefined;
    const sample = await timed(() => adapter.search(adapter.requestFor(scenario, { limit: 100, after })));
    const page = sample.result;
    const expectedPage = expected.slice(offset, offset + 100);
    assert.deepEqual(page.documents.map((document) => document.id), expectedPage.map((document) => document.id),
      `100k keyset continuation differs at offset ${offset}`);
    assert.equal(page.total_count, expected.length);
    checkFacets(page.facets, expectedFacets(expected), context, scenario.id);
    assert.equal(Boolean(page.nextPosition), offset + 100 < expected.length,
      `Incorrect final-page detection at offset ${offset}`);
    const evidence = checkDocuments(page.documents, corpusById, scenario);
    samples.push({ offset, returned_documents: page.documents.length,
      precision: 1, recall_within_page: 1, milliseconds: Math.round(sample.milliseconds),
      evidence_provenance: evidence });
  }
  return { id: scenario.id, pass: true, total_count: expected.length,
    continuation_source: 'independent manifest timestamps and IDs; no production cursor arithmetic', samples };
}

async function coldProbe(directory) {
  const start = performance.now();
  const context = openFixture(directory);
  const opened = performance.now();
  try {
    let decryptions = 0;
    const originalDecrypt = context.store._decryptRevision.bind(context.store);
    context.store._decryptRevision = async (...args) => { decryptions += 1; return originalDecrypt(...args); };
    const adapter = createAdapter(context);
    const scenario = { id: 'cold-broad-query', expression: { field: 'text', match: 'term', value: 'operations' }, matches: () => true };
    const sample = await timed(() => adapter.search(adapter.requestFor(scenario)));
    const expected = expectedDocuments(context.corpus, scenario, context);
    const expectedIds = new Set(expected.map((document) => document.id));
    assert.equal(sample.result.total_count, expected.length);
    assert.ok(sample.result.documents.every((document) => expectedIds.has(document.id)));
    checkFacets(sample.result.facets, expectedFacets(expected), context, scenario.id);
    const evidence = checkDocuments(sample.result.documents, new Map(context.corpus.map((document) => [document.id, document])), scenario);
    return { startup_ms: Math.round(opened - start), query_ms: Math.round(sample.milliseconds),
      total_count: sample.result.total_count, returned_documents: sample.result.documents.length,
      decrypted_revisions: decryptions, evidence_provenance: evidence,
      definition: 'fresh Node process and CloudStore; operating-system disk cache is retained',
      startup_definition: 'store opening plus evaluator corpus-manifest construction' };
  } finally { context.close(); }
}

async function run(options) {
  const started = performance.now();
  const context = options.fixture ? openFixture(options.fixture) : await createFixture(createCorpus(options.documents, options), { keep: options.keep,
    allVisible: options.allVisible,
    progress: (value) => process.stderr.write(`Seeded ${value.seeded}/${value.total} documents in ${value.milliseconds} ms\n`) });
  let decryptions = 0;
  const originalDecrypt = context.store._decryptRevision.bind(context.store);
  context.store._decryptRevision = async (...args) => { decryptions += 1; return originalDecrypt(...args); };
  context.takeDecryptions = () => { const result = decryptions; decryptions = 0; return result; };
  const report = { document_count: context.corpus.length, plaintext_bytes: context.bytes,
    seed_ms: context.seedMilliseconds, runtime: process.version, seed_method: 'public encrypted document writes',
    initial_access: options.allVisible || context.allVisible ? 'all documents visible' : 'mixed document and workspace permissions',
    coverage: options.benchmarkOnly ? 'first page with exact independent totals and facets, selected independent pagination boundaries, latency, cold process, and index encryption'
      : 'all matching documents across every page, exact independent totals and facets, and adversarial mutations',
    correctness: [], security: [], performance: [], failures: [] };
  const capture = async (category, id, operation) => {
    const start = performance.now();
    try {
      const result = await operation();
      report[category].push(result);
      process.stderr.write(`PASS ${id} (${Math.round(performance.now() - start)} ms)\n`);
    } catch (error) {
      report.failures.push({ id, category, error: error.message, code: error.code || null,
        stack: error.stack });
      process.stderr.write(`FAIL ${id}: ${error.message}\n`);
    }
  };
  try {
    const adapter = createAdapter(context);
    const cold = spawnSync(process.execPath, [__filename, '--cold-probe', context.directory],
      { encoding: 'utf8', env: process.env, maxBuffer: 1024 * 1024 });
    if (cold.status !== 0) throw new Error('Cold-process probe failed: ' + cold.stderr);
    report.cold_process = JSON.parse(cold.stdout);
    const planned = options.benchmarkOnly ? [] : [...scenarios(context.corpus), ...generatedScenarios(options.randomCases)]
      .filter((scenario) => !options.selected.length || options.selected.includes(scenario.id));
    for (const scenario of planned) {
      await capture('correctness', scenario.id, () => evaluateScenario(scenario, context, adapter, options));
    }
    report.performance = await benchmark(context, adapter, options);
    if (context.corpus.length >= 10000) {
      await capture('correctness', 'large-pagination-boundaries', () => largePagination(context, adapter));
    }
    report.storage = storageSummary(context);
    await capture('security', 'blind-index-at-rest', () => assertBlindIndex(context));
    if (!options.benchmarkOnly) {
      await capture('security', 'hidden-data-influence', () => hiddenInfluence(context, adapter));
      await capture('security', 'revoke-between-pages', () => revokeBetweenPages(context, adapter));
      await capture('security', 'revoke-during-decryption', () => revokeDuringDecryption(context, adapter));
      await capture('security', 'revoke-through-second-connection', () => revokeDuringDecryption(context, adapter, true));
      await capture('security', 'key-failure-is-atomic', () => keyFailureIsAtomic(context, adapter));
      await capture('security', 'current-revision-lifecycle', () => currentRevisionLifecycle(context, adapter));
      await capture('security', 'membership-revocation', () => membershipRevocation(context, adapter));
      await capture('security', 'legacy-index-rebuild', () => rebuildLegacyDocuments(context, adapter));
    }
  } catch (error) {
    report.failures.push({ id: 'runner', error: error.message, stack: error.stack });
  } finally {
    report.elapsed_ms = Math.round(performance.now() - started);
    report.peak_rss_bytes = process.resourceUsage().maxRSS * 1024;
    if (options.keep || options.fixture) report.fixture_directory = context.directory;
    context.close();
  }
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.coldProbe) {
    process.stdout.write(JSON.stringify(await coldProbe(options.coldProbe)) + '\n');
    return;
  }
  if (options.help) {
    console.log('Usage: node scripts/search-eval/run.js [--documents 1200] [--all-visible] [--repetitions 7] [--page-size 100]\n' +
      '  [--random-cases 100] [--scenarios ID,ID] [--benchmark-only] [--output FILE] [--keep]\n' +
      '  [--fixture /tmp/sdocs-search-eval-DIRECTORY]');
    return;
  }
  const report = await run(options);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.failures.length) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
module.exports = { benchmark, checkFacets, evaluateScenario, hiddenInfluence, main,
  coldProbe, largePagination, membershipRevocation, parseArgs, revokeBetweenPages, run, storageSummary };
