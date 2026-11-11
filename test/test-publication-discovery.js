'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Database = require('better-sqlite3');
const { startFixture } = require('./cloud-onboarding-fixture');
const { CloudPublications } = require('../lib/cloud-publications');
const { pageNumber, renderDirectory } = require('../lib/publication-directory');

module.exports = function ({ test, testAsync, assert }) {
  test('homepage and library beacons identify each surface without retaining a visitor identifier', () => {
    const source = fs.readFileSync(path.join(__dirname, '../public/library/library-analytics.js'), 'utf8');
    for (const [loadType, search, stored, expected] of [
      ['home', '?src=Email-Launch', '', 'home'], ['', '?scope=cloud', '2026-W41', 'cloud-library'],
      ['', '', 'opt-out', 'library'], ['home', '', null, 'home'],
    ]) {
      const calls = [];
      vm.runInNewContext(source, { Date, URLSearchParams, document: { currentScript: { dataset: { loadType } } },
        window: { location: { search } }, localStorage: { getItem() { if (stored === null) throw Error('Blocked'); return stored; }, setItem() {} },
        fetch(url) { calls.push(url); return Promise.resolve(); } });
      assert.strictEqual(calls.length, 1);
      const url = new URL(calls[0], 'https://smalldocs.org');
      assert.strictEqual(url.searchParams.get('lt'), expected);
      if (stored === 'opt-out' || stored === null) assert.strictEqual(url.searchParams.get('cohort'), '');
      if (search.includes('src=')) assert.strictEqual(url.searchParams.get('src'), 'email-launch');
    }
    const homepage = fs.readFileSync(path.join(__dirname, '../public/homepage-next.html'), 'utf8');
    assert.strictEqual((homepage.match(/library-analytics.js/g) || []).length, 1);
    assert.ok(homepage.includes('href="/published"'));
  });

  test('public directory validates page numbers and escapes only published title/description data', () => {
    for (const value of ['0', '-1', '1.2', 'x', '9007199254740993', '1e3']) assert.strictEqual(pageNumber(value), null);
    assert.strictEqual(pageNumber(null), 1); assert.strictEqual(pageNumber('2001'), 2001);
    const html = renderDirectory({ origin: 'https://smalldocs.org', page: 2, items: [
      { slug: 'guide-safe', title: '<img src=x onerror=alert(1)>', description: '<script>secret</script>', published_at_ms: 1 },
    ], has_next: true, has_previous: true, views: new Map([['guide-safe', 1234]]) });
    assert.ok(html.includes('href="https://smalldocs.org/published?page=2"'));
    assert.ok(html.includes('href="/published" rel="prev"'));
    assert.ok(html.includes('href="/published?page=3" rel="next"'));
    assert.ok(html.includes('&lt;img')); assert.ok(!html.includes('<img'));
    assert.ok(html.includes('1,234 page views')); assert.ok(!html.includes('<script>secret'));
    const options = { origin: 'https://smalldocs.org', page: 1, items: [
      { slug: 'guide-safe', title: 'Guide', published_at_ms: 1 },
    ], has_next: false, has_previous: false };
    assert.ok(renderDirectory({ ...options, views: new Map([['guide-safe', 1]]) }).includes('1 page view</span>'));
    assert.ok(!renderDirectory(options).includes('class="published-views"'), 'unavailable counts are not presented as zero');
  });

  return async function () {
    const f = await startFixture({ analytics: true });
    const publications = new CloudPublications({ store: f.store, origin: f.origin });
    let doc, slug;
    const read = async (endpoint, options) => {
      const response = await fetch(f.origin + endpoint, { redirect: 'manual', ...options });
      return { status: response.status, headers: response.headers, html: await response.text() };
    };
    try {
      await testAsync('directory exposes published snapshots but never unpublished drafts or private documents', async () => {
        const created = await f.api('bob', '/api/cloud/v1/account/documents', 'POST', { account_id: f.team.workspaceId,
          filename: 'public-guide.md', markdown: '---\ntags: [private-tag-canary]\n---\n# Published guide\n\nPublic introduction.\n', idempotency_key: crypto.randomUUID() });
        assert.strictEqual(created.status, 201, JSON.stringify(created.data)); doc = created.data.document;
        const pub = await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/publication', 'POST', {
          expected_revision_id: doc.current_revision_id, idempotency_key: crypto.randomUUID() });
        assert.strictEqual(pub.status, 200, JSON.stringify(pub.data)); slug = new URL(pub.data.publication.url).pathname.slice(3);
        await f.api('bob', '/api/cloud/v1/documents/' + doc.id + '/revisions', 'POST', {
          expected_head_revision_id: doc.current_revision_id, markdown: '# PRIVATE DRAFT CANARY\n\nDraft body secret.\n', idempotency_key: crypto.randomUUID() });
        await f.api('bob', '/api/cloud/v1/account/documents', 'POST', { account_id: f.team.workspaceId,
          filename: 'secret.md', markdown: '# UNPUBLISHED CANARY\n', idempotency_key: crypto.randomUUID() });
        const result = await read('/published');
        assert.strictEqual(result.status, 200); assert.ok(result.html.includes('Published guide'));
        assert.ok(result.html.includes('/p/' + slug));
        for (const secret of ['PRIVATE DRAFT CANARY', 'UNPUBLISHED CANARY', 'private-tag-canary', f.users.bob.email, doc.id]) assert.ok(!result.html.includes(secret), secret);
        assert.strictEqual(result.headers.get('x-robots-tag'), 'noindex, nofollow');
        assert.strictEqual((await read('/published?page=1')).status, 301);
        for (const value of ['0', '2', '-1', '999999999999999999999']) assert.strictEqual((await read('/published?page=' + value)).status, 404);
      });

      await testAsync('published views increment atomically on GET, persist on restart, and leave revisions and sitemap dates alone', async () => {
        const before = publications.getPublic(slug);
        assert.strictEqual((await read('/p/' + slug, { method: 'HEAD' })).status, 200);
        const count = () => {
          const db = new Database(path.join(f.dir, 'analytics.db'), { readonly: true });
          try { return db.prepare('SELECT views FROM publication_views WHERE slug=?').get(slug)?.views || 0; } finally { db.close(); }
        };
        assert.strictEqual(count(), 0);
        const responses = await Promise.all(Array.from({ length: 40 }, () => read('/p/' + slug)));
        assert.ok(responses.every(result => result.status === 200)); assert.strictEqual(count(), 40);
        assert.ok(responses.some(result => result.html.includes('40 page views')));
        assert.ok((await read('/published')).html.includes('40 page views'));
        await read('/p/missing-public-page'); await read('/p/' + slug, { method: 'HEAD' });
        assert.strictEqual(count(), 40);
        assert.deepStrictEqual(publications.getPublic(slug), before);
        await f.restart(path.join(__dirname, '..'));
        assert.strictEqual(count(), 40);
        assert.ok((await read('/p/' + slug)).html.includes('41 page views'));
      });

      await testAsync('withdrawn or deleted publications disappear from the directory and sitemap immediately', async () => {
        const endpoint = '/api/cloud/v1/documents/' + doc.id + '/publication';
        assert.strictEqual((await f.api('bob', endpoint, 'DELETE', {})).status, 200);
        assert.ok(!(await read('/published')).html.includes('/p/' + slug));
        assert.ok(!(await read('/publications-sitemap.xml')).html.includes('/p/' + slug));
        assert.strictEqual((await read('/p/' + slug)).status, 410);
        // The deletion triggers clear snapshots, even if a stale active flag is later observed.
        f.store.db.prepare('UPDATE cloud_publications SET active=1 WHERE document_id=?').run(doc.id);
        f.store.db.prepare('UPDATE cloud_documents SET deleted_at_ms=1 WHERE id=?').run(doc.id);
        assert.strictEqual(publications.listPublicPage().items.length, 0);
        assert.strictEqual(publications.publicCount(), 0);
      });

      await testAsync('100,001-publication directory and sitemap stay bounded, indexed and free of per-page-entry queries', async () => {
        const base = f.store.db.prepare('SELECT * FROM cloud_documents WHERE id=?').get(doc.id);
        f.store.db.transaction(() => {
          f.store.db.prepare(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<100001)
            INSERT INTO cloud_documents(id,workspace_id,project_id,current_revision_id,created_by_user_id,created_at_ms,updated_at_ms)
            SELECT 'catalog-'||printf('%06d',i),?,?,NULL,?,100000+i,100000+i FROM n`)
            .run(base.workspace_id, base.project_id, base.created_by_user_id);
          f.store.db.exec(`INSERT INTO cloud_publications(document_id,public_id,slug,published_revision_id,fingerprint,rendered_html,published_at_ms,updated_at_ms,active,public_source,renderer_version)
            SELECT id,id,id,'test-revision','test-fingerprint','<div id="_sd_rendered">Published</div>',created_at_ms,updated_at_ms,1,
              json_object('title','Public '||id,'description','Public description'), 'test-renderer'
            FROM cloud_documents WHERE id LIKE 'catalog-%'`);
        }).immediate();
        let statements = [];
        const prepare = f.store.db.prepare;
        f.store.db.prepare = function (sql) { statements.push(sql); return prepare.call(this, sql); };
        const start = performance.now(), memory = process.memoryUsage().heapUsed;
        let first, last, plan;
        try {
          first = publications.listPublicPage();
          assert.strictEqual(statements.length, 1);
          last = publications.listPublicPage({ page: 2001 });
          assert.strictEqual(statements.length, 2);
          plan = prepare.call(f.store.db, 'EXPLAIN QUERY PLAN ' + statements[0]).all(51, 0);
        } finally { f.store.db.prepare = prepare; }
        assert.strictEqual(first.items.length, 50); assert.strictEqual(first.items[0].slug, 'catalog-100001');
        assert.strictEqual(last.items.length, 1); assert.strictEqual(last.has_next, false); assert.strictEqual(last.has_previous, true);
        assert.ok(plan.some(row => row.detail.includes('cloud_publications_date')));
        assert.ok(!plan.some(row => row.detail.includes('TEMP B-TREE')));
        assert.ok(process.memoryUsage().heapUsed - memory < 16 * 1024 * 1024);
        console.log('  100,001-page catalogue: first + last queries ' + Math.round(performance.now() - start) + ' ms, 2 statements');
        const one = await read('/published'), two = await read('/published?page=2');
        assert.strictEqual((one.html.match(/class="res" /g) || []).length, 50);
        assert.ok(one.html.includes('href="/published?page=2" rel="next"'));
        assert.ok(two.html.includes('https://localhost') === false);
        const index = await read('/publications-sitemap.xml');
        assert.ok(index.html.includes('<sitemapindex'));
        for (let page = 1; page <= 3; page++) {
          const sitemap = await read('/publications-sitemap.xml?page=' + page);
          assert.strictEqual((sitemap.html.match(/<url>/g) || []).length, page < 3 ? 50000 : 1);
        }
        assert.strictEqual((await read('/publications-sitemap.xml?page=4')).status, 404);
        assert.strictEqual(publications.listPublic({ rendererVersion: 'test-renderer' }).length, 0);
        // Parent deletion must still hide all 100k entries without querying each document.
        f.store.db.prepare('UPDATE cloud_projects SET deleted_at_ms=1 WHERE id=?').run(base.project_id);
        assert.strictEqual(publications.publicCount(), 0);
        assert.strictEqual(publications.listPublicPage().items.length, 0);
        assert.strictEqual((await read('/published?page=2')).status, 404);
      });
    } finally { await f.close(); }
  };
};
if (require.main === module) { const h = require('./runner'); module.exports(h)().then(() => h.report()); }
