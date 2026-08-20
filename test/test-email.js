'use strict';

const net = require('net');

function startCaptureServer() {
  const messages = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    let dataMode = false;
    let dataLines = [];
    socket.write('220 mail.test ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let end;
      while ((end = buffer.indexOf('\r\n')) !== -1) {
        let line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (dataMode) {
          if (line === '.') {
            messages.push(dataLines.join('\r\n'));
            dataLines = [];
            dataMode = false;
            socket.write('250 queued\r\n');
          } else {
            if (line.startsWith('..')) line = line.slice(1);
            dataLines.push(line);
          }
          continue;
        }
        const command = line.toUpperCase();
        if (command.startsWith('EHLO ')) socket.write('250-mail.test\r\n250 PIPELINING\r\n');
        else if (command.startsWith('MAIL FROM:')) socket.write('250 sender ok\r\n');
        else if (command.startsWith('RCPT TO:')) socket.write('250 recipient ok\r\n');
        else if (command === 'DATA') { dataMode = true; socket.write('354 continue\r\n'); }
        else if (command === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
        else socket.write('500 unexpected command\r\n');
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, messages,
      port: server.address().port }));
  });
}

function decodeMimeParts(message) {
  const boundaryMatch = message.match(/boundary="([^"]+)"/i);
  if (!boundaryMatch) return [];
  return message.split('--' + boundaryMatch[1]).slice(1, -1).map((part) => {
    const split = part.replace(/^\r\n/, '').split('\r\n\r\n');
    return { headers: split[0], body: Buffer.from(split.slice(1).join('\r\n\r\n')
      .replace(/\r\n/g, ''), 'base64').toString('utf8') };
  });
}

module.exports = function(harness) {
  const { assert, test, testAsync } = harness;

  return async function() {
    console.log('\n── Email Tests ──────────────────────────────────\n');

    const templates = require('../lib/email-templates');
    const notify = require('../teams/notify');

    test('email templates render text and HTML from the same values', () => {
      const signIn = templates.signInCode({ code: '384921', expiresMinutes: 10 });
      assert.strictEqual(signIn.subject, 'Your SmallDocs sign-in code');
      assert.ok(signIn.text.includes('384921'));
      assert.ok(signIn.html.includes('384921'));
      assert.ok(signIn.html.includes('Expires in 10 minutes'));
      assert.ok(signIn.html.includes('color:#2563eb'));
      assert.ok(signIn.html.includes('border-top:1px solid #e7e2da'));
      assert.ok(signIn.html.includes('This message was sent by SmallDocs.'));
      assert.ok(!signIn.html.includes('This message was sent by SmallDocs Cloud.'));
      assert.ok(!signIn.html.includes('>Sign-in code</span>'));

      const invitation = templates.workspaceInvitation({
        acceptUrl: 'https://cloud-staging.smalldocs.org/cloud/invite?token=abc',
        inviter: 'Tom Smith', accountName: 'SmallDocs Demo',
      });
      assert.ok(invitation.text.includes('token=abc'));
      assert.ok(invitation.text.includes('Tom Smith invited you to join SmallDocs Demo'));
      assert.ok(invitation.html.includes('>Join SmallDocs Demo</h1>'));
      assert.ok(invitation.html.includes('Open invitation'));

      const documents = templates.documentNotification({ actor: 'Tom Smith', documents: [
        { title: 'Release notes', url: 'https://smalldocs.org/docs?cloud-document=one' },
        { title: 'Test plan', url: 'https://smalldocs.org/docs?cloud-document=two' },
      ], note: 'Review these together.\nThe release note changed.' });
      assert.ok(documents.subject.includes('2 document links'));
      assert.ok(documents.text.includes('Release notes'));
      assert.ok(documents.text.includes('Note from Tom:\nReview these together.'));
      assert.ok(documents.html.includes('Test plan'));
      assert.ok(documents.html.includes('Note from Tom'));
      assert.ok(documents.html.includes('Review these together.<br>The release note changed.'));

      const oneDocument = templates.documentNotification({ actor: 'Tom Smith', documents: [
        { title: 'Release notes', url: 'https://smalldocs.org/docs?cloud-document=one' },
      ] });
      assert.strictEqual(oneDocument.subject,
        'Tom Smith sent you a document link from SmallDocs Cloud');
      assert.ok(oneDocument.text.startsWith('Tom Smith sent you a document in SmallDocs Cloud.'));
      assert.ok(oneDocument.html.includes('>Document from Tom Smith</h1>'));
    });

    test('email templates escape names and titles in HTML', () => {
      const message = templates.documentNotification({ actor: '<Admin>', note: '<b>Review</b>', documents: [{
        title: '<script>alert(1)</script>', url: 'https://smalldocs.org/docs?id=one&view=cloud',
      }] });
      assert.ok(!message.html.includes('<script>alert(1)</script>'));
      assert.ok(message.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
      assert.ok(message.html.includes('&lt;Admin&gt;'));
      assert.ok(message.html.includes('&lt;b&gt;Review&lt;/b&gt;'));
      assert.ok(!message.html.includes('<b>Review</b>'));
      assert.ok(message.html.includes('id=one&amp;view=cloud'));
      assert.throws(() => templates.workspaceInvitation({ acceptUrl: 'javascript:alert(1)' }),
        /http or https/);
    });

    test('multipart messages carry plain-text and HTML alternatives', () => {
      const message = notify.buildMessage({
        from: 'notifications@smalldocs.test', to: 'person@example.test',
        subject: 'Documents from José', text: 'Plain text', html: '<p>HTML</p>',
        boundary: 'fixed-boundary', date: 'Fri, 21 Aug 2026 12:00:00 GMT',
      });
      assert.ok(message.includes('Content-Type: multipart/alternative; boundary="fixed-boundary"'));
      assert.ok(message.includes('Subject: =?UTF-8?B?'));
      const parts = decodeMimeParts(message);
      assert.strictEqual(parts.length, 2);
      assert.ok(parts[0].headers.includes('text/plain'));
      assert.strictEqual(parts[0].body, 'Plain text');
      assert.ok(parts[1].headers.includes('text/html'));
      assert.strictEqual(parts[1].body, '<p>HTML</p>');
    });

    await testAsync('local SMTP captures the complete rendered message', async () => {
      const capture = await startCaptureServer();
      const keys = ['NOTIFY_SMTP_HOST', 'NOTIFY_SMTP_PORT', 'NOTIFY_SMTP_SECURITY',
        'NOTIFY_SMTP_USER', 'NOTIFY_SMTP_PASS', 'NOTIFY_EMAIL_FROM', 'NOTIFY_EMAIL_TO'];
      const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
      try {
        process.env.NOTIFY_SMTP_HOST = '127.0.0.1';
        process.env.NOTIFY_SMTP_PORT = String(capture.port);
        process.env.NOTIFY_SMTP_SECURITY = 'none';
        delete process.env.NOTIFY_SMTP_USER;
        delete process.env.NOTIFY_SMTP_PASS;
        process.env.NOTIFY_EMAIL_FROM = 'notifications@smalldocs.test';
        process.env.NOTIFY_EMAIL_TO = 'preview@smalldocs.test';
        const template = templates.signInCode({ code: '384921' });
        const result = await notify.sendTo('person@example.test', template.subject,
          template.text, template.html);
        assert.strictEqual(result.ok, true);
        assert.strictEqual(capture.messages.length, 1);
        const parts = decodeMimeParts(capture.messages[0]);
        assert.strictEqual(parts.length, 2);
        assert.ok(parts[0].body.includes('384921'));
        assert.ok(parts[1].body.includes('Sign in to SmallDocs'));
      } finally {
        await new Promise((resolve) => capture.server.close(resolve));
        keys.forEach((key) => {
          if (previous[key] == null) delete process.env[key];
          else process.env[key] = previous[key];
        });
      }
    });

    test('plaintext SMTP is limited to the local machine', () => {
      const keys = ['NOTIFY_SMTP_HOST', 'NOTIFY_SMTP_PORT', 'NOTIFY_SMTP_SECURITY',
        'NOTIFY_EMAIL_FROM', 'NOTIFY_EMAIL_TO'];
      const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
      process.env.NOTIFY_SMTP_HOST = 'smtp.example.com';
      process.env.NOTIFY_SMTP_PORT = '1025';
      process.env.NOTIFY_SMTP_SECURITY = 'none';
      process.env.NOTIFY_EMAIL_FROM = 'notifications@smalldocs.test';
      process.env.NOTIFY_EMAIL_TO = 'preview@smalldocs.test';
      assert.strictEqual(notify.isConfigured(), false);
      keys.forEach((key) => {
        if (previous[key] == null) delete process.env[key];
        else process.env[key] = previous[key];
      });
    });
  };
};
