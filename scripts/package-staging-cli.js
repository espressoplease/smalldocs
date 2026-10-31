#!/usr/bin/env node
const path = require('path');
const { buildPackage } = require('../lib/staging-cli-package');
const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/package-staging-cli.js OUTPUT.tgz');
buildPackage(path.resolve(__dirname, '..'), path.resolve(output));
