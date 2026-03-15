/**
 * Shared test harness for sdocs-dev
 * Provides test(), testAsync(), get(), and report()
 */
const assert = require('assert');
const http = require('http');

// ── Colours ──────────────────────────────────────────
const GREEN = '\x1b[32m\u2714\x1b[0m';
const RED   = '\x1b[31m\u2718\x1b[0m';

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`${GREEN} ${name}`);
    passed++;
  } catch (e) {
    console.log(`${RED} ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`${GREEN} ${name}`);
    passed++;
  } catch (e) {
    console.log(`${RED} ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}

function report() {
  console.log(`\n── Results ─────────────────────────────────────\n`);
  console.log(`  ${GREEN} ${passed} passed`);
  if (failed > 0) {
    console.log(`  ${RED} ${failed} failed`);
    process.exit(1);
  } else {
    console.log(`\n  All tests passed!\n`);
  }
}

module.exports = { assert, test, testAsync, get, report, GREEN, RED };
