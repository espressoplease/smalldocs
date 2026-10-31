// Provider transport for the disposable signup server. The application still
// verifies the signed token, nonce, audience, browser binding and PKCE flow.
const fs = require('fs');
const crypto = require('crypto');
const keys = JSON.parse(fs.readFileSync(process.env.SDOCS_TEST_GOOGLE_KEYS, 'utf8'));
const originalFetch = global.fetch;
global.fetch = async function (url, options) {
  if (String(url) === 'https://www.googleapis.com/oauth2/v3/certs') {
    return Response.json({ keys: [keys.jwk] });
  }
  if (String(url) === 'https://oauth2.googleapis.com/token') {
    const values = new URLSearchParams(options.body);
    const identity = JSON.parse(Buffer.from(values.get('code'), 'base64url').toString('utf8'));
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const content = encode({ alg: 'RS256', kid: keys.jwk.kid }) + '.' + encode({
      iss: 'https://accounts.google.com', aud: process.env.GOOGLE_OAUTH_CLIENT_ID,
      sub: identity.subject || identity.email, email: identity.email, email_verified: true,
      ...(identity.hd ? { hd: identity.hd } : {}),
      given_name: identity.first, family_name: identity.last, nonce: identity.nonce,
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const signature = crypto.sign('RSA-SHA256', Buffer.from(content), keys.privateKey).toString('base64url');
    return Response.json({ id_token: content + '.' + signature });
  }
  return originalFetch(url, options);
};
