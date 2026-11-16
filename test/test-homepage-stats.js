const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHomepageStats, REFRESH_MS } = require('../analytics/homepage-stats');
const seed = require('../analytics/homepage-stats-seed.json');

module.exports = function ({ assert, testAsync }) {
  return async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-homepage-stats-'));
    let fixtureId = 0;
    function fixture(overrides = {}) {
      let time = Date.parse('2026-11-17T17:00:00Z');
      const cacheFile = path.join(dir, String(++fixtureId), 'counts.json');
      const calls = { npm: 0, github: 0 };
      const values = {
        npm: () => ({ weekly: [{ downloads: 5200 }, { downloads: 125 }], fetchedAt: time }),
        github: () => ({ total: 233, weekly: [{ stars: 200 }, { stars: 233 }], fetchedAt: time })
      };
      const options = { cacheFile, now: () => time,
        npm: { refresh: () => { calls.npm++; return values.npm(); } },
        github: { refresh: () => { calls.github++; return values.github(); } }, ...overrides };
      return { stats: createHomepageStats(options), options, cacheFile, calls, values,
        advance: () => { time += REFRESH_MS; } };
    }
    try {
      await testAsync('Homepage counts are available immediately before any provider request', async () => {
        const f = fixture();
        assert.deepStrictEqual(f.stats.getSnapshot(), { ...seed, npmPeriod: 'last-year' });
        assert.deepStrictEqual(f.calls, { npm: 0, github: 0 });
        const snapshot = f.stats.getSnapshot();
        snapshot.npmDownloads = 0;
        assert.strictEqual(f.stats.getSnapshot().npmDownloads, seed.npmDownloads);
      });
      await testAsync('Homepage sums npm weekly downloads and uses the GitHub total, then persists both', async () => {
        const f = fixture();
        const result = await f.stats.refresh();
        assert.strictEqual(result.npmDownloads, 5325);
        assert.strictEqual(result.githubStars, 233);
        assert.strictEqual(result.npmUpdatedAt, '2026-11-17T17:00:00.000Z');
        const saved = JSON.parse(fs.readFileSync(f.cacheFile, 'utf8'));
        assert.strictEqual(saved.npmDownloads, 5325);
        assert.strictEqual(saved.githubStars, 233);
      });
      await testAsync('Homepage last successful counts survive a restart and provider failures', async () => {
        const f = fixture();
        f.values.npm = () => ({ weekly: [{ downloads: 6000 }], fetchedAt: Date.now() });
        f.values.github = () => ({ total: 250, fetchedAt: Date.now() });
        await f.stats.refresh();
        f.values.npm = () => { throw new Error('npm unavailable'); };
        f.values.github = () => Promise.reject(new Error('GitHub unavailable'));
        const restarted = createHomepageStats(f.options);
        assert.strictEqual(restarted.getSnapshot().npmDownloads, 6000);
        assert.strictEqual(restarted.getSnapshot().githubStars, 250);
        const before = restarted.getSnapshot();
        assert.deepStrictEqual(await restarted.refresh(), before);
        assert.deepStrictEqual(restarted.getSnapshot(), before);
      });
      await testAsync('Homepage refresh updates a successful provider while retaining the failed provider', async () => {
        const f = fixture();
        await f.stats.refresh();
        f.advance();
        f.values.npm = () => Promise.reject(new Error('npm unavailable'));
        f.values.github = () => ({ total: 234, fetchedAt: Date.now() });
        const result = await f.stats.refresh();
        assert.strictEqual(result.npmDownloads, 5325);
        assert.strictEqual(result.npmUpdatedAt, '2026-11-17T17:00:00.000Z');
        assert.strictEqual(result.githubStars, 234);
        const restarted = createHomepageStats(f.options);
        assert.deepStrictEqual(restarted.getSnapshot(), result);
      });
      await testAsync('Homepage concurrent refreshes share one request and failed attempts wait an hour', async () => {
        const f = fixture();
        let finish;
        f.values.npm = () => new Promise(resolve => { finish = resolve; });
        f.values.github = () => { throw new Error('offline'); };
        const first = f.stats.refresh();
        assert.strictEqual(f.stats.refresh(), first);
        await Promise.resolve();
        assert.deepStrictEqual(f.calls, { npm: 1, github: 1 });
        finish(null);
        await first;
        await f.stats.refresh();
        assert.deepStrictEqual(f.calls, { npm: 1, github: 1 });
        f.advance();
        f.values.npm = () => null;
        await f.stats.refresh();
        assert.deepStrictEqual(f.calls, { npm: 2, github: 2 });
      });
      await testAsync('Homepage ignores invalid provider data independently and accepts valid zero counts', async () => {
        const f = fixture();
        f.values.npm = () => ({ weekly: [{ downloads: -1 }], fetchedAt: Date.now() });
        f.values.github = () => ({ total: 300, fetchedAt: Infinity });
        assert.deepStrictEqual(await f.stats.refresh(), { ...seed, npmPeriod: 'last-year' });
        f.advance();
        f.values.npm = () => ({ weekly: [], fetchedAt: Date.now() });
        f.values.github = () => ({ total: 0, fetchedAt: Date.now() });
        const result = await f.stats.refresh();
        assert.strictEqual(result.npmDownloads, 0);
        assert.strictEqual(result.githubStars, 0);
      });
      await testAsync('Homepage falls back safely for damaged saved data without discarding a valid other metric', async () => {
        const f = fixture();
        fs.mkdirSync(path.dirname(f.cacheFile));
        fs.writeFileSync(f.cacheFile, '{broken');
        assert.deepStrictEqual(createHomepageStats(f.options).getSnapshot(), { ...seed, npmPeriod: 'last-year' });
        fs.writeFileSync(f.cacheFile, JSON.stringify({ npmDownloads: -5, npmUpdatedAt: 'bad',
          githubStars: 280, githubUpdatedAt: seed.githubUpdatedAt }));
        const restored = createHomepageStats(f.options).getSnapshot();
        assert.strictEqual(restored.npmDownloads, seed.npmDownloads);
        assert.strictEqual(restored.githubStars, 280);
      });
      await testAsync('Homepage retains successful in-memory counts if the cache file cannot be written', async () => {
        const blocker = path.join(dir, 'not-a-directory');
        fs.writeFileSync(blocker, '');
        const f = fixture({ cacheFile: path.join(blocker, 'counts.json') });
        f.values.github = () => ({ total: 300, fetchedAt: Date.now() });
        assert.strictEqual((await f.stats.refresh()).githubStars, 300);
        assert.strictEqual(f.stats.getSnapshot().githubStars, 300);
      });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
};
