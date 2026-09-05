#!/usr/bin/env node
'use strict';

const path = require('path');
const { createCloudJobs } = require('../lib/cloud-jobs');

const EMAIL_JOB_TYPES = ['invitation_email', 'document_notification_email', 'billing_state_email'];

function usage() {
  return [
    'Usage: node scripts/cloud-job-status.js [--db PATH] [--email] [--json] [--fail-on-dead]',
    '',
    'Reads Cloud job state without printing job payloads, recipient addresses, or document data.',
    'Use --email to show only invitation, document-notification, and billing-state delivery jobs.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { dbPath: process.env.CLOUD_JOBS_DB || '', email: false,
    json: false, failOnDead: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--db') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--db requires a path');
      options.dbPath = value;
    }
    else if (arg === '--email') options.email = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--fail-on-dead') options.failOnDead = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error('unknown option: ' + arg);
  }
  if (!options.help && !options.dbPath) throw new Error('CLOUD_JOBS_DB or --db is required');
  return options;
}

function formatAge(generatedAtMs, timestamp) {
  if (timestamp == null) return '-';
  const seconds = Math.max(0, Math.floor((generatedAtMs - timestamp) / 1000));
  if (seconds < 120) return seconds + 's';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 120) return minutes + 'm';
  return Math.floor(minutes / 60) + 'h';
}

function renderText(summary) {
  const lines = [
    'Cloud jobs at ' + new Date(summary.generatedAtMs).toISOString(),
    'Total ' + summary.total + ' | queued ' + summary.states.queued +
      ' | running ' + summary.states.running + ' | complete ' + summary.states.complete +
      ' | dead ' + summary.states.dead,
    'Oldest due ' + formatAge(summary.generatedAtMs, summary.oldestDueAtMs) +
      ' | expired leases ' + summary.expiredLeaseCount,
  ];
  for (const item of summary.types) {
    lines.push(item.type + ': queued ' + item.queued + ', running ' + item.running +
      ', complete ' + item.complete + ', dead ' + item.dead);
  }
  for (const error of summary.errors) {
    lines.push('error ' + error.type + '/' + error.code + ': ' + error.count);
  }
  return lines.join('\n');
}

function run(argv, io) {
  io = io || { log: console.log, error: console.error };
  let options;
  try { options = parseArgs(argv); }
  catch (error) {
    io.error(error.message + '\n\n' + usage());
    return 1;
  }
  if (options.help) {
    io.log(usage());
    return 0;
  }
  let jobs;
  try { jobs = createCloudJobs({ dbPath: path.resolve(options.dbPath), readonly: true }); }
  catch (_) {
    io.error('Could not open the Cloud jobs database. Check CLOUD_JOBS_DB or --db.');
    return 1;
  }
  try {
    const summary = jobs.summary({ types: options.email ? EMAIL_JOB_TYPES : [] });
    io.log(options.json ? JSON.stringify(summary, null, 2) : renderText(summary));
    return options.failOnDead &&
      (summary.states.dead > 0 || summary.expiredLeaseCount > 0) ? 2 : 0;
  } catch (_) {
    io.error('Could not read Cloud job status. Check that this is a Cloud jobs database.');
    return 1;
  } finally {
    jobs.close();
  }
}

if (require.main === module) process.exitCode = run(process.argv.slice(2));

module.exports = { EMAIL_JOB_TYPES, formatAge, parseArgs, renderText, run, usage };
