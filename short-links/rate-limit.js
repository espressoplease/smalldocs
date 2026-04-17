/**
 * In-memory IP rate limiter for short-link creates.
 *
 * Tracks a rolling 1-hour window per IP. Returns false once a client
 * exceeds the cap. Cheap enough for a single-process Node server; swap
 * for nginx/reverse-proxy limits if the app ever scales horizontally.
 */

const WINDOW_MS = 60 * 60 * 1000;       // 1 hour
const DEFAULT_LIMIT = 30;                // creates per IP per window
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;  // prune stale entries every 10 min

const hits = new Map();  // ip -> { count, windowStart }
let limit = DEFAULT_LIMIT;
let cleanupTimer = null;

function now() { return Date.now(); }

function check(ip) {
  if (!ip) return true;  // unknown client; let it through, server will still enforce size caps
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
