# Browser and CLI login persistence

Browser login has a rolling 30-day inactivity window. An authenticated page or
Cloud API request renews both the server expiry and the persistent browser
cookie. Static file requests do not renew a session. A person who continues
using SmallDocs stays signed in; after 30 days without authenticated activity,
they sign in again. Existing unexpired sessions adopt this behaviour on their
next authenticated request.

The server retains the same random session token and stores its keyed hash.
`created_at_ms` records the original sign-in and never changes during renewal.
`last_seen_at_ms` and `expires_at_ms` advance monotonically in the existing
SQLite row. Renewal does not add another write beyond the activity update.
The browser cookie retains its host-only, HttpOnly, Secure and SameSite=Lax
settings on HTTPS. It remains persistent when the browser closes. Cookies on
local HTTP keep the existing local-development cookie name and transport.

Expiry and revocation are checked before renewal. The update also requires an
unrevoked, unexpired row, so renewal cannot revive a revoked session. Disabled
users cannot renew. SQLite retains renewed expiry across server restarts and
deployments. Cookie clearing and session revocation during logout take
precedence over a renewal earlier in the request.

Sensitive actions still require a sign-in within the last 30 minutes, based on
`created_at_ms`. Using the application renews ordinary access but does not reset
that authentication age. Signing in again creates a new browser session.

CLI authorization is separate. Access tokens last 15 minutes and refresh
automatically using a rotating refresh token. CLI credentials have no scheduled
expiry; they remain connected until logout, machine revocation, account
disablement, invalid credentials or detected refresh-token reuse. Browser
logout does not revoke an independently authorized CLI machine. CLI credentials
are scoped to their Cloud origin, as are browser cookies.

Verification: `test-cloud-auth.js` covers rolling expiry, monotonic updates,
original sign-in time, persistence, expiry, revocation and disabled users.
`cloud-session-renewal.spec.js` checks real HTTP responses and browser cookie
storage, a reopened browser context, logout, expired and revoked cookies,
recent-authentication checks and static file requests. Existing authentication,
account linking and CLI token suites cover the connected flows.

## Homepage entry

A normal visit to `/` by a signed-in browser opens Cloud Library. The library
uses the existing browser selection and checks it against current memberships
before opening it. A stale or inaccessible choice cannot grant access to a
library. Without a remembered choice, the existing one-library or chooser
behaviour applies. Sign-in itself is not repeated.

Both marketing templates load `sdocs-home-entry.js` before rendering. That
shared entry script keeps root fragment documents directed to `/docs`, and
preserves explicit marketing pages (`/home`, `/home-next`) and section anchors.
Those explicit pages show Open library to signed-in readers. Signed-out visitors
continue to see the marketing page and its login options. A remembered Local
Library connection only affects the legacy homepage.
