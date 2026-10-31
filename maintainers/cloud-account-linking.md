# Cloud account linking

Google and email-code login are sign-in methods on a permanent Cloud user ID.
Libraries, document permissions, CLI credentials, subscriptions and trial dates
continue to use that ID. Connecting a method does not create or move a library,
change a subscription, restart a trial or grant company membership.

## Automatic matching

The Google adapter validates the signature, issuer, audience, expiry, nonce and
verified-email claim. OAuth uses PKCE, a single-use state and a browser binding.
The Google subject identifies the provider identity; email is not its stable ID.

Google is authoritative for a verified Gmail address, or a verified address with
a nonempty Google hosted-domain claim. A new Google identity can then use the
existing email-code identity for the same normalized address. A new Google user
also receives an email-code identity, so either login method returns to that user.

For other Google addresses, the browser must complete a fresh mailbox-code
challenge before any identity is added or a new user is created. The pending
Google identity lives in a short-lived server context. An HttpOnly, SameSite
cookie holds its opaque token; the database stores only the keyed token hash.
The challenge must match both that context and the provider email. Expired,
replayed and replaced challenges cannot complete it.

An existing Google subject stays attached to its original user when its email
changes. It cannot move an email identity already owned by somebody else. Legacy
Gmail-only identities gain an email-code alias when that mailbox is verified.
Other legacy duplicate accounts are not silently merged.

## Deliberate connections

Preferences lists the connected methods and provides Connect Google and Add an
email address. Connecting a different Google address requires a recent browser
session, a fresh OAuth flow and a confirmation that names the current account.
The OAuth linking intent is bound to the original browser session. An ordinary
Google login does not connect to the account currently open in that browser.

Adding an email requires the signed-in account and a code sent to the new
address. Verification checks the code's target user against the active session.
All completion requests require the application's Origin. A sign-in method
already owned by a different user is refused with a recovery message. No data,
billing or access-control records are merged. There is no account-merge tool.

Invitations may match any verified email identity already attached to the user.
Accepting the invitation remains a separate permission-checked action. An email
address or Google hosted-domain claim alone does not add library membership.

## Implementation and verification

- `lib/cloud-oauth.js` determines Google email authority from verified claims.
- `lib/cloud-auth-linking.js` resolves users and manages linking contexts.
- `lib/cloud-auth.js` stores identities and consumes mailbox challenges atomically.
- `/cloud/link` handles Google confirmation and additional mailbox proof.
- `/cloud/link-email` adds another mailbox from Preferences.
- `/api/cloud/auth/link` reads or completes the pending Google context.
- `/api/cloud/v1/me` returns the user's own sign-in methods for Preferences.

`test/test-cloud-auth-linking.js` covers identity ownership, stable provider IDs,
expiry, replay, atomic failures, disabled users and session binding.
`test/test-cloud-oauth.js` verifies signed Google tokens and the authority rules.
`test/cloud-account-linking.spec.js` exercises the production HTTP handlers and
browser forms with signed provider fixtures and captured local SMTP messages.
It checks both signup orders, Gmail and Workspace, third-party mailbox proof,
explicit connections, existing-account conflicts, company isolation, document
access and unchanged trial and subscription records.

The provider fixture intercepts transport inside the disposable test process.
It does not add a test-login route or provider bypass to the application. These
checks do not replace a live Google consent and login check on staging.

References:

- [Google ID-token verification and email authority](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
- [Google OpenID Connect and stable subjects](https://developers.google.com/identity/openid-connect/openid-connect)
- [Account linking and proof of both identities](https://auth0.com/docs/manage-users/user-accounts/user-account-linking)
