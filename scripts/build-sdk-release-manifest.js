#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const versionIndex = process.argv.indexOf('--version');
const version = versionIndex >= 0 ? process.argv[versionIndex + 1] : '0.3.0';
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  throw new Error('SDK release version must look like x.y.z');
}

const releaseRoot = path.join(repo, 'sdk', 'browser', 'releases', version);
if (!fs.existsSync(releaseRoot)) throw new Error('Missing SDK release directory: ' + version);

function filesUnder(directory, prefix) {
  const out = [];
  fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .forEach((entry) => {
      const relative = prefix ? path.join(prefix, entry.name) : entry.name;
      if (relative === 'release-manifest.json') return;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) out.push(...filesUnder(absolute, relative));
      else if (entry.isFile()) out.push(relative.split(path.sep).join('/'));
    });
  return out;
}

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

const files = {};
filesUnder(releaseRoot, '').forEach((relative) => {
  const contents = fs.readFileSync(path.join(releaseRoot, relative));
  files[relative] = { bytes: contents.length, sha256: digest(contents) };
});

const target = path.join(releaseRoot, 'release-manifest.json');
const contents = Buffer.from(JSON.stringify({ version, files }, null, 2) + '\n');
const matches = fs.existsSync(target) && fs.readFileSync(target).equals(contents);
if (process.argv.includes('--check')) {
  if (!matches) {
    console.error('SDK ' + version + ' release manifest is stale');
    process.exit(1);
  }
} else {
  fs.writeFileSync(target, contents);
  console.log('SDK ' + version + ' release manifest updated: ' + Object.keys(files).length + ' files');
}
