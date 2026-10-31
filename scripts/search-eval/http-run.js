#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { startFixture } = require('../../test/cloud-onboarding-fixture');
const { exerciseCursorAttacks } = require('./http-attacks');

async function main() {
  const fixture = await startFixture({ singlePlan: true });
  const results = [];
  const outputIndex = process.argv.indexOf('--output');
  const output = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : null;
  try {
    const visible = [];
    for (let index = 0; index < 7; index += 1) {
      const document = await fixture.store.createDocument({ userId: fixture.users.bob.id,
        projectId: fixture.team.projectId, filename: `operations-${index}.md`,
        markdown: `---\ntags:\n  - operations\n---\n# Operations ${index}\nOperational evidence for incident response.\n`,
        idempotencyKey: `http-search-eval-${index}` });
      fixture.store.setDocumentPermission({ userId: fixture.users.bob.id,
        documentId: document.id, mode: 'everyone' });
      visible.push(document);
    }
    const privateDocument = await fixture.store.createDocument({ userId: fixture.users.bob.id,
      projectId: fixture.team.projectId, filename: 'classifiedcanary.md',
      markdown: '---\ntags:\n  - classifiedfacet\n---\n# Operations classifiedcanary\nIncident response classifiedcanary evidence.\n',
      idempotencyKey: 'http-search-eval-private' });
    const search = async (body, principal) => {
      const response = await fixture.api(principal, '/api/cloud/v1/search', 'POST', body);
      return { status: response.status, body: response.data };
    };
    const request = { query: 'operations', mode: 'query', workspace_id: fixture.team.workspaceId,
      facets: ['tags', 'authors', 'libraries'], sort: 'relevance' };
    const reader = await search(request, 'member');
    assert.equal(reader.status, 200, JSON.stringify(reader.body));
    assert.equal(reader.body.total_count, visible.length);
    assert.equal(JSON.stringify(reader.body).includes('classifiedcanary'), false);
    assert.equal(JSON.stringify(reader.body).includes('classifiedfacet'), false);
    assert.equal(reader.body.documents.some((document) => document.id === privateDocument.id), false);
    results.push({ id: 'http-authorized-counts-facets-snippets', pass: true });
    results.push(...await exerciseCursorAttacks({ search, request, principal: 'bob', secondPrincipal: 'member' }));
    const page = await search({ ...request, limit: 2 }, 'member');
    const next = await search({ ...request, limit: 2, cursor: page.body.next_cursor }, 'member');
    const revokeId = next.body.documents[0].id;
    fixture.store.setDocumentPermission({ userId: fixture.users.bob.id,
      documentId: revokeId, mode: 'custom', memberUserIds: [] });
    const revoked = await search({ ...request, limit: 2, cursor: page.body.next_cursor }, 'member');
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
    assert.equal(revoked.body.total_count, visible.length - 1);
    assert.equal(revoked.body.documents.some((document) => document.id === revokeId), false);
    results.push({ id: 'http-cursor-rechecks-revoked-access', pass: true });
    const report = { assertions: results.length, results, failures: [] };
    if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } finally { await fixture.close(); }
}

if (require.main === module) main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
module.exports = { main };
