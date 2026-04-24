/**
 * Per-IP rate limiter for feedback submissions.
 *
 * Mirrors short-links/rate-limit.js with a tighter cap: genuine feedback is
 * infrequent and a lower ceiling makes spam expensive.
 */

const WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_LIMIT = 10;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

const hits = new Map();
let limit = DEFAULT_LIMIT;
let cleanupTimer = null;

function now() { return Date.now(); }

function check(ip) {
  if (!ip) return true;
  const entry = hits.get(ip);
  const t = now();
  if (!entry || t - entry.windowStart > WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: t });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

function cleanup() {
  const t = now();
  for (const [ip, entry] of hits) {
    if (t - entry.windowStart > WINDOW_MS) hits.delete(ip);
  }
}

function startCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
  if (cleanupTimer.unref) cleanupTimer.unref();
}

function stopCleanup() {
  if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
}

function reset() { hits.clear(); }

function setLimit(n) { limit = n; }

module.exports = { check, cleanup, startCleanup, stopCleanup, reset, setLimit };
