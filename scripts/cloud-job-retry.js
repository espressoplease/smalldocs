#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createCloudJobs } = require('../lib/cloud-jobs');

const ALLOWED_TYPES = Object.freeze(['team_seat_sync']);

function usage() {
  return [
    'Usage: node scripts/cloud-job-retry.js --type team_seat_sync --confirm [--db PATH] [--limit N]',
    '',
    'Requeues dead Team seat-reconciliation jobs without printing job payloads or identifiers.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { dbPath: process.env.CLOUD_JOBS_DB || '', type: '', limit: 100,
    confirm: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--db') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--db requires a path');
      options.dbPath = value;
    } else if (arg === '--type') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--type requires a value');
      options.type = value;
    } else if (arg === '--limit') {
      const value = Number(argv[++index]);
      if (!Number.isSafeInteger(value) || value < 1 || value > 1000) {
        throw new Error('--limit must be an integer from 1 to 1000');
      }
      options.limit = value;
    } else if (arg === '--confirm') options.confirm = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error('unknown option: ' + arg);
  }
  if (options.help) return options;
  if (!options.dbPath) throw new Error('CLOUD_JOBS_DB or --db is required');
  if (!ALLOWED_TYPES.includes(options.type)) throw new Error('--type must be team_seat_sync');
  if (!options.confirm) throw new Error('--confirm is required');
  return options;
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
  const dbPath = path.resolve(options.dbPath);
  if (!fs.existsSync(dbPath)) {
    io.error('Could not open the Cloud jobs database. Check CLOUD_JOBS_DB or --db.');
    return 1;
  }
  let jobs;
  try { jobs = createCloudJobs({ dbPath }); }
  catch (_) {
    io.error('Could not open the Cloud jobs database. Check CLOUD_JOBS_DB or --db.');
    return 1;
  }
  try {
    const result = jobs.requeueDead({ type: options.type, limit: options.limit });
    io.log('Requeued ' + result.requeued + ' dead ' + options.type + ' job' +
      (result.requeued === 1 ? '' : 's') + '.');
    return 0;
  } catch (_) {
    io.error('Could not requeue Cloud jobs. Check that this is a Cloud jobs database.');
    return 1;
  } finally {
    jobs.close();
  }
}

if (require.main === module) process.exitCode = run(process.argv.slice(2));

module.exports = { ALLOWED_TYPES, parseArgs, run, usage };
