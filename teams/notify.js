/**
 * Email notification for teams-interest submissions.
 *
 * A minimal SMTP-over-TLS client on Node builtins (no nodemailer), enough
 * to deliver one plain-text message through an authenticated submission
 * server such as Gmail (smtp.gmail.com:465 with an App Password).
 *
 * Configuration is entirely environment-driven; with no config the module
 * is a silent no-op so the form keeps working (submissions are stored in
 * SQLite either way - mail is a ping, not the system of record):
 *
 *   NOTIFY_SMTP_USER   account to authenticate as (also the From address)
 *   NOTIFY_SMTP_PASS   password (for Gmail: an App Password, not the
 *                      account password)
 *   NOTIFY_EMAIL_TO    recipient (defaults to NOTIFY_SMTP_USER)
 *   NOTIFY_SMTP_HOST   default smtp.gmail.com
 *   NOTIFY_SMTP_PORT   default 465 (implicit TLS)
 *
 * send() never throws and never rejects: it resolves { ok, error } so a
 * failed ping can be logged without affecting the HTTP response.
 */
const tls = require('tls');

const TIMEOUT_MS = 10 * 1000;

function config() {
  const user = process.env.NOTIFY_SMTP_USER || '';
  const pass = process.env.NOTIFY_SMTP_PASS || '';
  return {
    user,
    pass,
    to:   process.env.NOTIFY_EMAIL_TO || user,
    host: process.env.NOTIFY_SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.NOTIFY_SMTP_PORT || 465),
  };
}

function isConfigured() {
  const c = config();
  return Boolean(c.user && c.pass && c.to);
}

// SMTP DATA bodies terminate on a bare "." line; leading dots in content
// must be doubled (RFC 5321 dot-stuffing). CRLF line endings throughout.
function dotStuff(text) {
  return text.replace(/\r?\n/g, '\r\n').replace(/(^|\r\n)\./g, '$1..');
}

function send(subject, text) {
  if (!isConfigured()) return Promise.resolve({ ok: false, error: 'not_configured' });
  const c = config();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.end(); } catch (_) {}
      if (!ok) console.log(`[notify] mail failed: ${error}`);
      resolve({ ok, error: error || null });
    };

    const socket = tls.connect({ host: c.host, port: c.port, servername: c.host });
    const timer = setTimeout(() => finish(false, 'timeout'), TIMEOUT_MS);

    // The dialogue is a fixed script: wait for the expected status code,
    // send the next command. Multi-line replies ("250-...") buffer until
    // the final "250 " line arrives.
    const date = new Date().toUTCString();
    const headers = [
      `From: SmallDocs <${c.user}>`,
      `To: <${c.to}>`,
      `Subject: ${subject.replace(/[\r\n]+/g, ' ')}`,
      `Date: ${date}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
    ].join('\r\n');
    const authPlain = Buffer.from(`\u0000${c.user}\u0000${c.pass}`).toString('base64');
    const script = [
      { expect: 220, send: `EHLO smalldocs.org` },
      { expect: 250, send: `AUTH PLAIN ${authPlain}` },
      { expect: 235, send: `MAIL FROM:<${c.user}>` },
      { expect: 250, send: `RCPT TO:<${c.to}>` },
      { expect: 250, send: `DATA` },
      { expect: 354, send: `${headers}\r\n\r\n${dotStuff(text)}\r\n.` },
      { expect: 250, send: `QUIT` },
      { expect: 221, send: null },
    ];
    let step = 0;
    let buf = '';

    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      // Wait for a complete final reply line: "NNN ..." followed by CRLF.
      const m = buf.match(/(^|\r\n)(\d{3}) [^\r\n]*\r\n$/);
      if (!m) return;
      const code = Number(m[2]);
      buf = '';
      const s = script[step];
      if (!s || code !== s.expect) {
        finish(false, `unexpected ${code} at step ${step}`);
        return;
      }
      step++;
      if (s.send === null) { finish(true); return; }
      socket.write(s.send + '\r\n');
    });

    socket.on('error', (e) => finish(false, e.code || e.message));
    socket.on('close', () => {
      if (step >= script.length) finish(true);
      else finish(false, 'connection_closed');
    });
  });
}

module.exports = { isConfigured, send, dotStuff };
