# Personal and Team libraries

29 October 2026. This describes the Cloud-first single-plan model.

Each person has one private Personal library and can create or join Team
libraries. The unique active Personal-library index and transactional lookup
make concurrent onboarding idempotent. Completing a profile or connecting a
CLI provisions Personal, including when the destination is a team invitation.
Invitation acceptance retains the team destination for Install settings.

Personal cannot receive invitations, additional members or another owner.
The store enforces this for browser and CLI callers, including a check before
committing an invitation after asynchronous encryption. The error is
`personal_library_private`, with a readable message and a `settings_url` for
creating a Team library. Existing document permission checks remain in place.

Team libraries start with the creator as owner. Adding a person does not share
existing private documents. Document access is chosen separately. Creating a
Team library does not move existing documents or change a computer's default.

Billing accounts cover people across libraries. Existing libraries are attached
before Personal is provisioned so the existing payer, subscription and trial
deadline are retained. Team sponsorship does not give the sponsor access to
the person's Personal library. It does not create a second paid subscription.
Opening Personal preserves an existing team sponsor during a trial as well as
after payment, so library navigation does not remove a future billed seat.

Existing Team libraries retain their type, documents and memberships. They are
not reclassified based on their name or number of members. If an existing user
has no Personal library, onboarding adds one. Their existing documents stay in
their existing libraries until deliberately moved. Existing Personal libraries
are displayed as Personal without rewriting encrypted names or document data.

The library page keeps the switcher visible with one library and offers Create
team library next to it. Personal shows a note linking to team creation. Settings
hides People for Personal. Both switchers use the shared Lucide user-round and
users-round SVGs, with Personal first. Colours derive from the library ID and
use the same helper as document library pills; changing selection does not
reassign a colour. Person colours and the neutral You icon are separate.

Verification covers:

- Concurrent signup and CLI authorization, one Personal library, and one trial.
- Invited signup retaining both Personal and the invited team.
- Personal invitation rejection through browser and CLI APIs.
- Team sponsors being unable to read Personal documents.
- Existing subscription, trial, document and membership preservation.
- Team invitations, seat reconciliation, payment retries and cancellation.
- Desktop and phone switchers, matching document colours, and private-library
  guidance leading to team creation.

The relevant suites include `test-cloud-single-plan.js`,
`test-cloud-signup-readiness.js`, `test-cloud-cli-onboarding.js`,
`test-cloud-agent-management.js`, `test-cloud-single-billing.js`,
`cloud-library-kinds.spec.js` and `cloud-account-selection.spec.js`.
