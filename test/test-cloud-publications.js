'use strict';
const crypto = require('crypto');
const { startFixture } = require('./cloud-onboarding-fixture');
const { CloudPublications, publicSnapshot } = require('../lib/cloud-publications');
const yaml = require('../cli/shared/sdocs-yaml');

module.exports = function (h) {
  const { assert, testAsync } = h;
  return async function () {
    const f = await startFixture();
    const privateText = 'private-review-unique-2867';
    const markdown = yaml.serializeFrontMatter({ title: 'A published guide', description: 'A useful public guide.',
      tags: ['private-tag-unique-8653'], source_path: '/private/source-unique-9876.md',
      styles: { color: '#123456', baseFontSize: 18, private_field: privateText,
        headers: { fontFamily: 'Inter', private_field: privateText } },
      comments: [{ id: 'c1', kind: 'inline', quote: 'Public introduction', author: 'Reviewer', text: privateText }] }) +
      '\n# A published guide\n\nPublic introduction.\n\n## Steps\n\nRead the guide.\n';
    const endpoint = document => '/api/cloud/v1/documents/' + document.id + '/publication';
    async function create(text = markdown, actor = 'bob') {
      const response = await f.api(actor, '/api/cloud/v1/account/documents', 'POST', {
        account_id: f.team.workspaceId, filename: 'guide.md', markdown: text, idempotency_key: crypto.randomUUID() });
      assert.strictEqual(response.status, 201, JSON.stringify(response.data));
      return response.data.document;
    }
    const publish = (doc, key = crypto.randomUUID(), actor = 'bob') => f.api(actor, endpoint(doc), 'POST', {
      expected_revision_id: doc.current_revision_id, idempotency_key: key });
    async function save(doc, text) {
      const response = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/revisions', 'POST', {
        expected_head_revision_id: doc.current_revision_id, markdown: text, idempotency_key: crypto.randomUUID() });
      assert.strictEqual(response.status, 201, JSON.stringify(response.data));
      return response.data.document;
    }
    async function page(url, headers = {}) {
      const response = await fetch(url, { headers, redirect: 'manual' });
      return { status: response.status, text: await response.text(), headers: response.headers };
    }
    const localPublications = renderPage => new CloudPublications({ store: f.store, origin: f.origin,
      renderPage: renderPage || (options => '<h1>' + options.title + '</h1>') });
    try {
      await testAsync('compiled publication cache retains only its published source and cannot resurrect a withdrawn page',async()=>{
        let doc=await create();
        const publication=(await publish(doc)).data.publication;
        const slug=new URL(publication.url).pathname.slice(3);
        doc=await save(doc,markdown+'\nA later private draft.\n');
        let release,arrived;
        const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{arrived=resolve;});
        const compiler=localPublications(async source=>{
          assert.ok(source.markdown.includes('Public introduction'));
          assert.ok(!source.markdown.includes('A later private draft.'));
          arrived();await gate;
          return {html:'<div id="_sd_rendered">Published text</div>',styles:{shape:'',math:false},rendererVersion:'new-renderer'};
        });
        const pending=compiler.rebuildPublished(slug);await started;
        await f.api('bob',endpoint(doc),'DELETE',{});release();
        assert.strictEqual(await pending,false);
        assert.strictEqual(compiler.getPublic(slug).active,0);
        assert.strictEqual(compiler.getPublic(slug).public_source,null);
      });
      await testAsync('failed compilation preserves the last public version and its source',async()=>{
        let doc=await create();await publish(doc);
        const before=f.store.db.prepare('SELECT * FROM cloud_publications WHERE document_id=?').get(doc.id);
        doc=await save(doc,markdown+'\nNew draft pending publication.\n');
        const compiler=localPublications(async()=>{throw Object.assign(new Error('Compiler unavailable'),{code:'publication_compile_failed'});});
        await assert.rejects(compiler.publish({userId:f.users.bob.id,documentId:doc.id,expectedRevisionId:doc.current_revision_id,idempotencyKey:crypto.randomUUID()}),error=>error.code==='publication_compile_failed');
        const after=compiler._row(doc.id);
        assert.strictEqual(after.rendered_html,before.rendered_html);
        assert.strictEqual(after.public_source,before.public_source);
        assert.strictEqual(after.published_revision_id,before.published_revision_id);
      });
      await testAsync('public snapshot excludes private metadata and portable review notes but keeps styling', async () => {
        const snapshot = publicSnapshot(markdown);
        assert.ok(snapshot.markdown.includes('#123456'));
        assert.ok(snapshot.markdown.includes('baseFontSize: 18'));
        for (const value of [privateText, 'private-tag-unique', 'source-unique', 'comments:', 'private_field']) {
          assert.ok(!snapshot.markdown.includes(value), value);
        }
        const portable = '# Guide\n\n[Public text][^c1]\n\n[^c1]: Reviewer - ' + privateText + '\n';
        const cleaned = publicSnapshot(portable).markdown;
        assert.ok(cleaned.includes('Public text'));
        assert.ok(!cleaned.includes(privateText));
      });
      await testAsync('publication is explicit, anonymous indexable HTML with isolated public metadata', async () => {
        const doc = await create();
        const status = await f.api('bob', endpoint(doc));
        assert.strictEqual(status.status, 200, JSON.stringify(status.data));
        assert.strictEqual(status.data.publication, null);
        assert.strictEqual(status.data.can_publish, true);
        assert.strictEqual(status.data.head_revision_id, doc.current_revision_id);
        assert.strictEqual((await page(f.origin + '/p/' + doc.id)).status, 404);
        const published = await publish(doc);
        assert.strictEqual(published.status, 200, JSON.stringify(published.data));
        const publication = published.data.publication;
        assert.ok(publication.url.startsWith(f.origin + '/p/a-published-guide-'));
        assert.strictEqual(publication.is_current, true);
        assert.strictEqual(publication.active, true);
        const response = await page(publication.url);
        assert.strictEqual(response.status, 200, response.text);
        assert.match(response.text, /<h1[^>]*>A published guide/);
        assert.ok(response.text.includes('Public introduction'));
        assert.ok(response.text.includes('canonical'));
        assert.ok(response.text.includes(publication.url));
        assert.strictEqual(response.headers.get('cache-control'), 'no-store');
        assert.strictEqual(response.headers.get('x-robots-tag'), 'noindex, nofollow');
        assert.ok(response.headers.get('content-security-policy').includes("connect-src 'self'"));
        for (const value of [privateText, 'private-tag-unique', 'source-unique', doc.id, doc.current_revision_id,
          f.users.bob.email, f.team.workspaceId, f.team.projectId]) assert.ok(!response.text.includes(value), value);
        const authenticated = await page(publication.url, { Cookie: f.users.bob.cookie });
        const sourceOf = html => JSON.parse(/<script id="sdocs-publication-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
        assert.deepStrictEqual(sourceOf(authenticated.text),sourceOf(response.text));
        const sitemap = await page(f.origin + '/publications-sitemap.xml');
        assert.ok(sitemap.text.includes(publication.url));
        assert.ok(!sitemap.text.includes(doc.id));
        const robots = await page(f.origin + '/robots.txt');
        assert.ok(robots.text.includes('/publications-sitemap.xml'));
      });
      await testAsync('public updates keep their URL and leave later drafts private until published', async () => {
        let doc = await create();
        const first = (await publish(doc)).data.publication;
        const renamed = markdown.replace(/A published guide/g, 'A renamed guide');
        doc = await save(doc, renamed + '\nUnpublished draft sentence.\n');
        assert.strictEqual((await f.api('bob', endpoint(doc))).data.publication.is_current, false);
        assert.ok(!(await page(first.url)).text.includes('Unpublished draft sentence'));
        const updated = await publish(doc);
        assert.strictEqual(updated.status, 200, JSON.stringify(updated.data));
        assert.strictEqual(updated.data.publication.url, first.url);
        assert.strictEqual(updated.data.publication.published_at_ms, first.published_at_ms);
        assert.ok((await page(first.url)).text.includes('Unpublished draft sentence'));
        const changedMetadata = renamed.replace(privateText, 'Changed private review text.') + '\nUnpublished draft sentence.\n';
        doc = await save(doc, changedMetadata);
        assert.strictEqual((await f.api('bob', endpoint(doc))).data.publication.is_current, true);
      });
      await testAsync('publish requires exact head, creator permission, current Terms and subscription write access', async () => {
        const doc = await create();
        f.store.setDocumentPermission({ userId: f.users.bob.id, documentId: doc.id, mode: 'everyone' });
        const member = await f.api('member', endpoint(doc));
        assert.strictEqual(member.status, 200);
        assert.strictEqual(member.data.can_publish, false);
        assert.strictEqual((await publish(doc, undefined, 'member')).status, 403);
        assert.strictEqual((await publish(doc, undefined, 'outsider')).status, 404);
        assert.strictEqual((await f.api('outsider', endpoint(doc))).status, 404);
        assert.strictEqual((await f.api('outsider', endpoint(doc), 'DELETE')).status, 404);
        assert.strictEqual((await f.api('bob', endpoint(doc), 'POST', { expected_revision_id: 'wrong',
          idempotency_key: crypto.randomUUID() })).status, 409);
        const otherDoc = await create();
        assert.strictEqual((await f.api('bob', endpoint(doc), 'POST', { expected_revision_id: otherDoc.current_revision_id,
          idempotency_key: crypto.randomUUID() })).status, 409);
        f.auth.db.prepare('DELETE FROM cloud_auth_terms_acceptances WHERE user_id=?').run(f.users.bob.id);
        assert.strictEqual((await publish(doc)).status, 403);
        f.auth.acceptCurrentTerms({ userId: f.users.bob.id, termsVersion: require('../lib/cloud-terms').CURRENT_TERMS_VERSION });
        const first = (await publish(doc)).data.publication;
        f.billing.upsertSubscription({ workspaceId: f.team.workspaceId, plan: 'team', status: 'canceled', provider: 'manual' });
        assert.strictEqual((await publish(doc)).status, 402);
        const stored = f.store.db.prepare('SELECT body_ciphertext FROM cloud_document_revisions WHERE id=?').get(doc.current_revision_id);
        f.store.db.prepare('UPDATE cloud_document_revisions SET body_ciphertext=? WHERE id=?').run(Buffer.from('invalid private ciphertext'), doc.current_revision_id);
        try {
          const management = await f.api('bob', endpoint(doc));
          assert.strictEqual(management.status, 200, JSON.stringify(management.data));
          assert.strictEqual(management.data.can_publish, false);
          assert.strictEqual(management.data.can_unpublish, true);
          assert.strictEqual(management.data.publication.can_manage, true);
        } finally {
          f.store.db.prepare('UPDATE cloud_document_revisions SET body_ciphertext=? WHERE id=?').run(stored.body_ciphertext, doc.current_revision_id);
        }
        assert.strictEqual((await page(first.url)).status, 200);
        const unpublished = await f.api('bob', endpoint(doc), 'DELETE');
        assert.strictEqual(unpublished.status, 200);
        assert.strictEqual(unpublished.data.can_publish, false);
        assert.strictEqual((await page(first.url)).status, 410);
        f.billing.upsertSubscription({ workspaceId: f.team.workspaceId, plan: 'team', status: 'active', provider: 'manual' });
      });
      await testAsync('duplicate retries preserve a later update or withdrawal and mismatched retries conflict', async () => {
        let doc = await create();
        const key = crypto.randomUUID();
        const first = await publish(doc, key);
        const repeated = await publish(doc, key);
        assert.deepStrictEqual(repeated.data, first.data);
        const oldDoc = doc;
        doc = await save(doc, markdown + '\nSecond publication.\n');
        assert.strictEqual((await publish(doc, key)).status, 409);
        await publish(doc);
        assert.strictEqual((await publish(oldDoc, key)).data.publication.published_revision_id, doc.current_revision_id);
        await f.api('bob', endpoint(doc), 'DELETE');
        const withdrawnRetry = await publish(oldDoc, key);
        assert.strictEqual(withdrawnRetry.data.publication.active, false);
        assert.strictEqual((await page(first.data.publication.url)).status, 410);
        const republished = await publish(doc);
        assert.strictEqual(republished.data.publication.url, first.data.publication.url);
        await f.api('bob', endpoint(doc), 'DELETE');
        assert.strictEqual((await f.api('bob', endpoint(doc), 'DELETE')).status, 200);
      });
      await testAsync('published snapshots survive source revision pruning and never decrypt on public reads', async () => {
        let doc = await create();
        const publication = (await publish(doc)).data.publication;
        const revision = doc.current_revision_id;
        doc = await save(doc, '# Current private draft\n');
        f.store.db.prepare('DELETE FROM cloud_document_revisions WHERE id=?').run(revision);
        assert.strictEqual(f.store.db.prepare('SELECT id FROM cloud_document_revisions WHERE id=?').get(revision), undefined);
        const response = await page(publication.url);
        assert.strictEqual(response.status, 200);
        assert.ok(response.text.includes('Public introduction'));
        assert.ok(!response.text.includes('Current private draft'));
        const publications = localPublications();
        const original = f.store._decryptRevision;
        f.store._decryptRevision = () => { throw new Error('Public requests must not decrypt private revisions'); };
        try { assert.ok(publications.getPublic(new URL(publication.url).pathname.slice(3)).rendered_html.includes('Public introduction')); }
        finally { f.store._decryptRevision = original; }
      });
      await testAsync('document deletion withdraws public HTML immediately and restore never republishes', async () => {
        const doc = await create();
        const publication = (await publish(doc)).data.publication;
        const deleted = await f.api('bob', '/api/cloud/v1/documents/' + doc.id, 'DELETE', {
          expected_head_revision_id: doc.current_revision_id });
        assert.strictEqual(deleted.status, 200, JSON.stringify(deleted.data));
        const removed = await page(publication.url);
        assert.strictEqual(removed.status, 410);
        assert.ok(!removed.text.includes('Public introduction'));
        assert.ok(!(await page(f.origin + '/publications-sitemap.xml')).text.includes(publication.url));
        const restored = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/restore', 'POST', {
          expected_head_revision_id: doc.current_revision_id });
        assert.strictEqual(restored.status, 200, JSON.stringify(restored.data));
        assert.strictEqual((await page(publication.url)).status, 410);
        assert.strictEqual((await f.api('bob', endpoint(doc))).data.publication.active, false);
      });
      await testAsync('permission revocation and head changes during rendering abort publication atomically', async () => {
        f.store.grantProject({ actorUserId: f.users.bob.id, workspaceId: f.team.workspaceId,
          projectId: f.team.projectId, userId: f.users.member.id, role: 'editor' });
        const memberDoc = await create(markdown, 'member');
        const revoked = localPublications(async () => {
          f.store.removeWorkspaceMember({ actorUserId: f.users.bob.id, workspaceId: f.team.workspaceId,
            userId: f.users.member.id });
          return '<h1>Must not publish</h1>';
        });
        await assert.rejects(revoked.publish({ userId: f.users.member.id, documentId: memberDoc.id,
          expectedRevisionId: memberDoc.current_revision_id, idempotencyKey: crypto.randomUUID() }), error => error.code === 'resource_unavailable');
        assert.strictEqual(revoked._row(memberDoc.id), undefined);
        const doc = await create();
        const movedHead = localPublications(async () => {
          await save(doc, '# Later saved head\n');
          return '<h1>Must not publish</h1>';
        });
        await assert.rejects(movedHead.publish({ userId: f.users.bob.id, documentId: doc.id,
          expectedRevisionId: doc.current_revision_id, idempotencyKey: crypto.randomUUID() }), error => error.code === 'revision_conflict');
        assert.strictEqual(movedHead._row(doc.id), undefined);
      });
      await testAsync('unpublish during first publication rendering prevents an in-flight publication from appearing', async () => {
        const doc = await create();
        const publications = localPublications(async () => {
          publications.unpublish({ userId: f.users.bob.id, documentId: doc.id });
          return '<h1>Must not publish</h1>';
        });
        await assert.rejects(publications.publish({ userId: f.users.bob.id, documentId: doc.id,
          expectedRevisionId: doc.current_revision_id, idempotencyKey: crypto.randomUUID() }), error => error.code === 'revision_conflict');
        assert.strictEqual(publications._row(doc.id), undefined);
      });
      await testAsync('simultaneous retries commit one publication and recheck write entitlement before committing', async () => {
        const doc = await create();
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        let renders = 0;
        const publications = localPublications(async options => {
          renders++;
          if (renders === 2) release();
          await gate;
          return '<h1>' + options.title + '</h1>';
        });
        const input = { userId: f.users.bob.id, documentId: doc.id,
          expectedRevisionId: doc.current_revision_id, idempotencyKey: crypto.randomUUID() };
        const results = await Promise.all([publications.publish(input), publications.publish(input)]);
        assert.deepStrictEqual(results[0], results[1]);
        assert.strictEqual(f.store.db.prepare('SELECT COUNT(*) AS n FROM cloud_publications WHERE document_id=?').get(doc.id).n, 1);
        const blockedDoc = await create();
        let allowed = true;
        const blocked = localPublications(async () => { allowed = false; return '<h1>Must not publish</h1>'; });
        await assert.rejects(blocked.publish({ userId: f.users.bob.id, documentId: blockedDoc.id,
          expectedRevisionId: blockedDoc.current_revision_id, idempotencyKey: crypto.randomUUID(),
          beforeCommit() { if (!allowed) throw Object.assign(new Error('subscription_required'), { code: 'subscription_required' }); },
        }), error => error.code === 'subscription_required');
        assert.strictEqual(blocked._row(blockedDoc.id), undefined);
      });
      await testAsync('project deletion withdraws snapshots and restoring its source cannot revive them', async () => {
        const doc = await create();
        const publication = (await publish(doc)).data.publication;
        f.store.db.prepare('UPDATE cloud_projects SET deleted_at_ms=? WHERE id=?').run(Date.now(), f.team.projectId);
        assert.strictEqual((await page(publication.url)).status, 410);
        f.store.db.prepare('UPDATE cloud_projects SET deleted_at_ms=NULL WHERE id=?').run(f.team.projectId);
        assert.strictEqual((await page(publication.url)).status, 410);
      });
      await testAsync('workspace deletion withdraws snapshots and restoring its source cannot revive them', async () => {
        const doc = await create();
        const publication = (await publish(doc)).data.publication;
        f.store.db.prepare('UPDATE cloud_workspaces SET deleted_at_ms=? WHERE id=?').run(Date.now(), f.team.workspaceId);
        assert.strictEqual((await page(publication.url)).status, 410);
        f.store.db.prepare('UPDATE cloud_workspaces SET deleted_at_ms=NULL WHERE id=?').run(f.team.workspaceId);
        assert.strictEqual((await page(publication.url)).status, 410);
      });
    } finally { await f.close(); }
  };
};
