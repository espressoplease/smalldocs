# Account and library settings

31 October 2026. Cloud-first, single-plan navigation.

A person has one account and can access several libraries. A setting belongs to
its actual scope, rather than the library last opened in the browser.

| Area | Scope | Entry point |
| --- | --- | --- |
| Documents, search, tags, stars and author filters | Selected library | Library |
| Members, invitations, invitation roles and allowed domains | Selected Team library | Manage members |
| Deleted documents and library deletion | Selected library, existing permissions | Library settings in the library menu |
| Create or join a library, restore a deleted Team library | Library management | Create team library |
| Subscription, invoices, payment method and cancellation | Signed-in person's billing account | Account settings, Billing |
| Sign-in methods and local-library navigation preference | Signed-in person | Account settings, Preferences |
| Connected machines and revoking CLI credentials | Signed-in person | Account settings, Connected machines |
| Installing the CLI and agent skill | Signed-in person, optional document destination | Account settings, Install |

## Navigation and reuse

`/library/settings?workspace=ID&panel=people` manages members.
`panel=overview` opens the selected library's settings and deleted documents.
`panel=libraries` opens creation, joining and deleted-library recovery.

The documents page and library settings use the same header component,
`public/sdocs-library-header.js`, the same library styles, and local Inter font
files. The switcher, colours and action buttons retain their positions. Documents
links retain the selected library. Switching libraries from settings retains the
current section, except that Personal opens its private settings rather than
Members. Library selection does not move documents or change a machine default.

`/cloud/admin` now opens account Billing. Account settings has no global library
switcher. Install has a destination selector scoped to that installation prompt,
including an explicit destination returned from an invitation. Selecting it does
not change the active library in other pages. Existing `/cloud/admin` links for
people, overview or libraries redirect to library management and retain an
explicit workspace ID. CLI settings commands emit the canonical routes.

## Loading and permissions

Account Billing uses `/api/cloud/billing/subscription` and the new
`POST /api/cloud/billing/portal`. The server derives the payer from the signed-in
person. Submitted workspace IDs cannot select another payer's Stripe customer.
The existing recent-authentication and same-origin checks apply. Payment and
cancellation still happen in Stripe. Account Billing, preferences and machines do
not list or decrypt library documents or fetch library membership.

Library settings fetch only the selected section. Members loads membership,
invitation and domain policy. Library settings loads deleted documents with an
explicit workspace filter. Creating or joining loads deleted libraries the person
can restore. It does not enumerate every document to display a count. Existing
server membership, document access, invitation and owner checks remain decisive.
An inaccessible explicit library ID shows an unavailable state, rather than
falling back to another library. Changing a section clears stale controls and
ignores older asynchronous responses. Changing libraries closes the previous
page and its pending confirmation.

Personal remains private, cannot gain members, and cannot be deleted as a Team
library. A Team member can open Members and perform only the actions permitted by
the existing invitation policy. Only an owner sees library deletion. Account
settings does not expose the selected Team's billing or payment controls.

## Verification

`cloud-settings-scopes.spec.js` covers shared header geometry on desktop and
mobile, navigation, Personal, member roles, legacy links, inaccessible libraries,
account loading and selected-library recovery. The existing library, account
selection, signup, invitation, account linking, trial and subscription suites
cover the connected journeys. `test-cloud-single-billing.js` covers payer
selection and refuses anonymous, cross-origin and sponsored-member attempts to
open someone else's payment portal. `test-cloud-agent-management.js` exercises
canonical settings links through the real CLI.
