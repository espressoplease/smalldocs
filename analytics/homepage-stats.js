const fs = require('fs');
const path = require('path');
const seed = require('./homepage-stats-seed.json');

const REFRESH_MS = 60 * 60 * 1000;
function validCount(value) { return Number.isSafeInteger(value) && value >= 0; }
function validFetchedAt(value) { return typeof value === 'number' && value > 0 && Number.isFinite(new Date(value).getTime()); }

function createHomepageStats(options = {}) {
  const dbPath = process.env.ANALYTICS_DB || path.join(__dirname, '..', 'analytics.db');
  const cacheFile = options.cacheFile || dbPath + '.homepage-stats.json';
  const npm = options.npm || require('./npm-downloads');
  const github = options.github || require('./github-stars');
  const now = options.now || Date.now;
  let state = { ...(options.seed || seed) };
  try {
    const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    for (const [count, updated] of [['npmDownloads', 'npmUpdatedAt'], ['githubStars', 'githubUpdatedAt']]) {
      if (validCount(saved[count]) && Number.isFinite(Date.parse(saved[updated]))) {
        state[count] = saved[count]; state[updated] = saved[updated];
      }
    }
  } catch (_) { /* The bundled snapshot is available before the first successful refresh. */ }

  let inflight = null, attemptedAt = null;
  function getSnapshot() { return { ...state, npmPeriod: 'last-year' }; }
  function refresh() {
    if (inflight) return inflight;
    if (attemptedAt !== null && now() - attemptedAt < REFRESH_MS) return Promise.resolve(getSnapshot());
    attemptedAt = now();
    inflight = Promise.allSettled([
      Promise.resolve().then(() => npm.refresh()),
      Promise.resolve().then(() => github.refresh())
    ]).then(results => {
      const before = JSON.stringify(state);
      const downloads = results[0].status === 'fulfilled' && results[0].value;
      const stars = results[1].status === 'fulfilled' && results[1].value;
      if (downloads && validFetchedAt(downloads.fetchedAt) && Array.isArray(downloads.weekly)) {
        const total = downloads.weekly.reduce((sum, week) => week && validCount(week.downloads) ? sum + week.downloads : NaN, 0);
        if (validCount(total)) {
          state.npmDownloads = total;
          state.npmUpdatedAt = new Date(downloads.fetchedAt).toISOString();
        }
      }
      if (stars && validFetchedAt(stars.fetchedAt) && validCount(stars.total)) {
        state.githubStars = stars.total;
        state.githubUpdatedAt = new Date(stars.fetchedAt).toISOString();
      }
      if (JSON.stringify(state) !== before) {
        try {
          fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
          fs.writeFileSync(cacheFile + '.tmp', JSON.stringify(state) + '\n');
          fs.renameSync(cacheFile + '.tmp', cacheFile);
        } catch (_) { /* Keep the successful in-memory snapshot if disk storage is unavailable. */ }
      }
      return getSnapshot();
    }).catch(() => getSnapshot()).finally(() => { inflight = null; });
    return inflight;
  }
  return { getSnapshot, refresh };
}

module.exports = { createHomepageStats, REFRESH_MS };
