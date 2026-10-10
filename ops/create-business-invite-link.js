#!/usr/bin/env node
'use strict';

const crypto = require('crypto');

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function clean(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}

function createInviteLink(input) {
  const origin = clean(input.origin, 300) || 'https://smalldocs.org';
  const url = new URL('/cloud/business-invite', origin);
  const token = clean(input.token, 500);
  const preview = clean(input.preview, 30);
  if (token) url.searchParams.set('token', token);
  if (preview) url.searchParams.set('preview', preview);

  const payload = {
    name: clean(input.name, 80),
    first_name: clean(input.first_name, 128),
    last_name: clean(input.last_name, 128),
    email: clean(input.email, 254),
    company: clean(input.company, 120),
    inviter: clean(input.inviter, 80),
  };
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const packed = Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
  url.hash = 'invite=v1.' + base64Url(key) + '.' + base64Url(packed);
  return url.toString();
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

if (require.main === module) {
  readStdin().then((source) => {
    const input = JSON.parse(source);
    process.stdout.write(createInviteLink(input) + '\n');
  }).catch((error) => {
    process.stderr.write('Could not create invite link: ' + error.message + '\n');
    process.exitCode = 1;
  });
}

module.exports = { createInviteLink };
