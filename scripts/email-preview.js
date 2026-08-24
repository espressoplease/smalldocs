#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const templates = require('../lib/email-templates');
const notify = require('../teams/notify');

const root = path.join(__dirname, '..');
const smtpPort = Number(process.env.MAILPIT_SMTP_PORT || 1025);
const uiPort = Number(process.env.MAILPIT_UI_PORT || 8025);
const uiOrigin = 'http://127.0.0.1:' + uiPort;

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isReady() {
  try {
    const response = await fetch(uiOrigin + '/readyz');
    return response.ok;
  } catch (_) {
    return false;
  }
}

async function ensureMailpit() {
  if (await isReady()) return;
  if (process.argv.includes('--no-start')) {
    throw new Error('Mailpit is not available at ' + uiOrigin);
  }
  const started = spawnSync('docker', [
    'compose', '-p', 'smalldocs-email-preview', '-f',
    path.join(root, 'test', 'mailpit.compose.yml'), 'up', '-d',
  ], { cwd: root, stdio: 'inherit' });
  if (started.error || started.status !== 0) {
    throw new Error('Could not start Mailpit. Install Mailpit or Docker, then read ' +
      'maintainers/email-testing.md.');
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await isReady()) return;
    await pause(200);
  }
  throw new Error('Mailpit started but did not become ready at ' + uiOrigin);
}

async function sendPreview(recipient, message) {
  const result = await notify.sendTo(recipient, message.subject, message.text, message.html);
  if (!result.ok) throw new Error('Could not capture ' + recipient + ': ' + result.error);
}

async function main() {
  await ensureMailpit();
  process.env.NOTIFY_SMTP_HOST = '127.0.0.1';
  process.env.NOTIFY_SMTP_PORT = String(smtpPort);
  process.env.NOTIFY_SMTP_SECURITY = 'none';
  process.env.NOTIFY_SMTP_USER = '';
  process.env.NOTIFY_SMTP_PASS = '';
  process.env.NOTIFY_EMAIL_FROM = 'notifications@smalldocs.test';
  process.env.NOTIFY_EMAIL_TO = 'preview@smalldocs.test';

  await sendPreview('signin@preview.smalldocs.test', templates.signInCode({
    code: '384921', expiresMinutes: 10,
  }));
  await sendPreview('invitation@preview.smalldocs.test', templates.workspaceInvitation({
    acceptUrl: 'https://cloud-staging.smalldocs.org/cloud/invite?token=preview-token',
    inviter: 'Tom Smith', accountName: 'SmallDocs Demo',
  }));
  await sendPreview('documents@preview.smalldocs.test', templates.documentNotification({
    actor: 'Tom Smith',
    note: 'I pulled these together after checking the release against the staging test plan.',
    documents: [
      { title: 'Release notes',
        url: 'https://cloud-staging.smalldocs.org/docs?cloud-document=release-notes' },
      { title: 'Cloud test plan',
        url: 'https://cloud-staging.smalldocs.org/docs?cloud-document=test-plan' },
      { title: 'Security review',
        url: 'https://cloud-staging.smalldocs.org/docs?cloud-document=security-review' },
    ],
  }));
  const billingUrl = 'https://cloud-staging.smalldocs.org/cloud/admin?panel=billing';
  const billingPreviews = [
    ['subscription-started', { type: 'subscription_started', accountName: 'SmallDocs Demo',
      accessEndsAt: '24 September 2026', billingUrl,
      termsUrl: 'https://cloud-staging.smalldocs.org/legal',
      cancellationUrl: 'https://cloud-staging.smalldocs.org/cancellation' }],
    ['payment-failed', { type: 'payment_failed', accountName: 'SmallDocs Demo',
      accessEndsAt: '28 August 2026', deletionDate: '20 October 2026', billingUrl }],
    ['payment-recovered', { type: 'payment_recovered', accountName: 'SmallDocs Demo', billingUrl }],
    ['payment-read-only', { type: 'payment_read_only', accountName: 'SmallDocs Demo',
      deletionDate: '20 October 2026', billingUrl }],
    ['cancellation-scheduled', { type: 'cancellation_scheduled', accountName: 'SmallDocs Demo',
      accessEndsAt: '1 September 2026', deletionDate: '1 October 2026', billingUrl }],
    ['cancellation-reversed', { type: 'cancellation_reversed', accountName: 'SmallDocs Demo',
      billingUrl }],
    ['cancellation-effective', { type: 'cancellation_effective', accountName: 'SmallDocs Demo',
      deletionDate: '1 October 2026', billingUrl }],
    ['deletion-warning', { type: 'deletion_warning', accountName: 'SmallDocs Demo',
      deletionDate: '1 October 2026', billingUrl }],
  ];
  for (const [recipient, input] of billingPreviews) {
    await sendPreview(recipient + '@preview.smalldocs.test', templates.billingState(input));
  }
  process.stdout.write('\nCaptured ' + (3 + billingPreviews.length) +
    ' preview messages.\nOpen ' + uiOrigin + '\n');
}

main().catch((error) => {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
});
