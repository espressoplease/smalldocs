#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { createCloudJobs } = require('../lib/cloud-jobs');
const notify = require('../teams/notify');

function positiveNumber(value, fallback, name) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(name + ' must be positive');
  return number;
}

function settings(env) {
  env = env || process.env;
  return {
    origin: env.SDOCS_MONITOR_ORIGIN || 'http://127.0.0.1:3003',
    backupDir: env.SDOCS_MONITOR_BACKUP_DIR || '/var/backups/smalldocs',
    backupMaxAgeMs: positiveNumber(env.SDOCS_MONITOR_BACKUP_MAX_AGE_HOURS, 26,
      'SDOCS_MONITOR_BACKUP_MAX_AGE_HOURS') * 60 * 60 * 1000,
    diskWarningPercent: positiveNumber(env.SDOCS_MONITOR_DISK_WARNING_PERCENT, 80,
      'SDOCS_MONITOR_DISK_WARNING_PERCENT'),
    jobsDb: env.CLOUD_JOBS_DB || '/var/lib/smalldocs/cloud-jobs/cloud_jobs.db',
    pendingMaxAgeMs: positiveNumber(env.SDOCS_MONITOR_PENDING_MAX_AGE_MINUTES, 15,
      'SDOCS_MONITOR_PENDING_MAX_AGE_MINUTES') * 60 * 1000,
    stateFile: env.SDOCS_MONITOR_STATE_FILE || '/var/lib/smalldocs-monitor/state.json',
    alertEmail: String(env.SDOCS_ALERT_EMAIL_TO || '').trim(),
    reminderMs: positiveNumber(env.SDOCS_MONITOR_REMINDER_HOURS, 6,
      'SDOCS_MONITOR_REMINDER_HOURS') * 60 * 60 * 1000,
  };
}

function checkHttp(origin, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve) => {
    let target;
    try { target = new URL('/', origin); }
    catch (_) {
      resolve({ ok: false, code: 'http_configuration', detail: 'monitor origin is invalid' });
      return;
    }
    if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
      resolve({ ok: false, code: 'http_configuration', detail: 'monitor origin must use loopback HTTP' });
      return;
    }
    const req = http.get(target, { timeout: timeoutMs || 5000 }, (res) => {
      res.resume();
      res.on('end', () => resolve({
        ok: res.statusCode === 200,
        code: res.statusCode === 200 ? 'http_ok' : 'http_status',
        detail: 'HTTP ' + res.statusCode,
        latencyMs: Date.now() - started,
      }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (error) => resolve({ ok: false, code: 'http_unavailable',
      detail: error.code || error.message, latencyMs: Date.now() - started }));
  });
}

function latestBackup(directory) {
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
  catch (error) {
    return { ok: false, code: 'backup_directory', detail: error.code || error.message };
  }
  let latest = null;
  for (const entry of entries) {
    if (!entry.isFile() || !/^smalldocs-.*\.tar\.gz$/.test(entry.name)) continue;
    const stat = fs.statSync(path.join(directory, entry.name));
    if (!latest || stat.mtimeMs > latest.mtimeMs) latest = { name: entry.name, mtimeMs: stat.mtimeMs };
  }
  if (!latest) return { ok: false, code: 'backup_missing', detail: 'no backup archive found' };
  return { ok: true, code: 'backup_found', detail: latest.name, mtimeMs: latest.mtimeMs };
}

function checkBackup(directory, now, maximumAgeMs) {
  const latest = latestBackup(directory);
  if (!latest.ok) return latest;
  const ageMs = Math.max(0, now - latest.mtimeMs);
  return { ok: ageMs <= maximumAgeMs, code: ageMs <= maximumAgeMs ? 'backup_ok' : 'backup_stale',
    detail: Math.floor(ageMs / (60 * 60 * 1000)) + ' hours old', ageMs };
}

function checkDisk(directory, warningPercent) {
  try {
    const stat = fs.statfsSync(directory);
    const total = Number(stat.blocks) * Number(stat.bsize);
    const available = Number(stat.bavail) * Number(stat.bsize);
    const usedPercent = total > 0 ? ((total - available) / total) * 100 : 100;
    return { ok: usedPercent < warningPercent,
      code: usedPercent < warningPercent ? 'disk_ok' : 'disk_high',
      detail: usedPercent.toFixed(1) + '% used', usedPercent };
  } catch (error) {
    return { ok: false, code: 'disk_check_failed', detail: error.code || error.message };
  }
}

function checkJobs(dbPath, now, maximumAgeMs) {
  let jobs;
  try { jobs = createCloudJobs({ dbPath, readonly: true }); }
  catch (error) {
    return { ok: false, code: 'jobs_unavailable', detail: error.code || error.message };
  }
  try {
    const summary = jobs.summary();
    const oldestAgeMs = summary.oldestPendingAtMs == null ? 0 : Math.max(0, now - summary.oldestPendingAtMs);
    if (summary.states.dead > 0) return { ok: false, code: 'jobs_dead',
      detail: summary.states.dead + ' dead jobs' };
    if (summary.expiredLeaseCount > 0) return { ok: false, code: 'jobs_expired_lease',
      detail: summary.expiredLeaseCount + ' expired leases' };
    if (oldestAgeMs > maximumAgeMs) return { ok: false, code: 'jobs_stale',
      detail: Math.floor(oldestAgeMs / 60000) + ' minute oldest pending job' };
    return { ok: true, code: 'jobs_ok', detail: summary.states.queued + ' queued jobs' };
  } catch (error) {
    return { ok: false, code: 'jobs_check_failed', detail: error.code || error.message };
  } finally {
    jobs.close();
  }
}

function readState(filename) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) { return {}; }
}

function writeState(filename, state) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = filename + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(state) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, filename);
}

function incidentKey(checks) {
  return checks.filter((check) => !check.ok).map((check) => check.code).sort().join(',');
}

function renderAlert(checks, recovered) {
  const lines = [recovered ? 'SmallDocs production monitoring recovered.' :
    'SmallDocs production monitoring found a problem.', ''];
  for (const check of checks) lines.push((check.ok ? 'OK ' : 'FAIL ') + check.code + ': ' + check.detail);
  lines.push('', 'This alert contains operational counts and status only.');
  return lines.join('\n');
}

async function run(options) {
  options = options || {};
  const now = options.now == null ? Date.now() : options.now;
  const config = options.config || settings(options.env);
  const checks = await Promise.all([
    (options.checkHttp || checkHttp)(config.origin),
    Promise.resolve((options.checkBackup || checkBackup)(config.backupDir, now, config.backupMaxAgeMs)),
    Promise.resolve((options.checkDisk || checkDisk)(config.backupDir, config.diskWarningPercent)),
    Promise.resolve((options.checkJobs || checkJobs)(config.jobsDb, now, config.pendingMaxAgeMs)),
  ]);
  const key = incidentKey(checks);
  const previous = (options.readState || readState)(config.stateFile);
  const recovered = !key && Boolean(previous.incidentKey);
  const changed = key !== (previous.incidentKey || '');
  const reminderDue = Boolean(key) && now - Number(previous.alertedAtMs || 0) >= config.reminderMs;
  let delivery = null;
  if ((changed || reminderDue) && (key || recovered)) {
    if (!config.alertEmail) delivery = { ok: false, error: 'alert_email_not_configured' };
    else delivery = await (options.sendTo || notify.sendTo)(config.alertEmail,
      recovered ? 'SmallDocs production recovered' : 'SmallDocs production alert',
      renderAlert(checks, recovered));
  }
  const alertedAtMs = delivery && delivery.ok ? now : Number(previous.alertedAtMs || 0);
  (options.writeState || writeState)(config.stateFile, { incidentKey: key, checkedAtMs: now, alertedAtMs });
  const result = { ok: !key, incidentKey: key, checks,
    alert: delivery ? { attempted: true, ok: delivery.ok, error: delivery.error || null } : { attempted: false } };
  console.log('[production-monitor] ' + JSON.stringify(result));
  return result.ok && (!delivery || delivery.ok) ? 0 : 2;
}

if (require.main === module) {
  run().then((code) => { process.exitCode = code; }, (error) => {
    console.error('[production-monitor] ' + (error.code || error.message));
    process.exitCode = 2;
  });
}

module.exports = { checkBackup, checkDisk, checkHttp, checkJobs, incidentKey, latestBackup,
  readState, renderAlert, run, settings, writeState };
