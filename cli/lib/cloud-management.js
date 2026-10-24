'use strict';

const crypto = require('crypto');

const HELP = `Account management

  sdoc cloud billing --json
  sdoc cloud subscribe [--no-open] --json
  sdoc cloud settings [install|libraries|people|billing|machines|preferences] [--account UUID] [--no-open] --json
  sdoc cloud invite EMAIL [--role member|admin] [--account UUID] --json
  sdoc cloud invitations [--account UUID] --json
  sdoc cloud revoke-invite INVITATION_ID [--account UUID] --json
  sdoc cloud remove-member USER_ID [--account UUID] --json
  sdoc cloud trial-feedback --note "Feedback from the user" [--rating 1..5] --json

Billing reports your trial deadline, seven-day warning period, payment wall,
paid coverage, subscription links and notices. Document receipts include the
same subscription state and notices. During the warning week, saves continue.
Afterwards, trial_payment_required blocks Cloud content until payment is confirmed.
Use the returned subscribe_url for the human to complete Stripe Checkout.
The command opens a subscription page; it does not charge the user.
Settings billing opens invoice, payment-method and cancellation management.
Browser sign-in is independent of CLI authorization. Never collect card details.

Invitations queue an email when delivery is configured and return an accept_url.
Check notification_scheduled before reporting delivery. They require the same
library permissions as the UI.
Resolve USER_ID with cloud members. Removing a member revokes library access
and reconciles sponsored seats. An owner cannot remove the final owner.
Inviting a person does not share existing private documents with them.
Use these commands on the human's instruction. Ask the human for trial feedback;
submit their words rather than inventing feedback. Feedback is shared with SmallDocs.
`;

const ACTIONS = ['billing', 'subscribe', 'settings', 'invite', 'invitations',
  'revoke-invite', 'remove-member', 'trial-feedback'];

async function run(opts, client, helpers) {
  const { emit, openBrowser, CloudCommandError } = helpers;
  const action = opts.file;
  const invalid = message => { throw new CloudCommandError('invalid_request', message); };
  const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const query = opts.accountFlag ? '?account_id=' + encodeURIComponent(opts.accountFlag) : '';
  async function account() {
    const value = await client.authenticated('/api/cloud/v1/account' + query);
    return value.account.id;
  }
  if (action === 'billing') {
    const data = await client.authenticated('/api/cloud/billing/subscription');
    return emit(opts, 'cloud.billing', data);
  }
  if (action === 'subscribe' || action === 'settings') {
    const panels = ['install', 'libraries', 'people', 'billing', 'machines', 'preferences', 'overview'];
    const panel = opts.extra || 'install';
    if (action === 'settings' && !panels.includes(panel)) invalid('Choose settings panel: ' + panels.join(', '));
    const params = new URLSearchParams();
    if (action === 'settings') params.set('panel', panel);
    if (opts.accountFlag) params.set('workspace_id', await account());
    const url = client.origin + (action === 'subscribe' ? '/cloud/subscribe'
      : '/cloud/admin?' + params.toString());
    if (!opts.noOpenFlag) openBrowser(url, message => process.stderr.write(message + '\n'));
    return emit(opts, 'cloud.' + action, { url, human_action_required: true,
      payment_taken: false }, url);
  }
  if (action === 'trial-feedback') {
    if (!opts.noteText || !opts.noteText.trim()) invalid('Use --note with feedback supplied by the human.');
    if (opts.ratingFlag != null && (!Number.isInteger(opts.ratingFlag) || opts.ratingFlag < 1 || opts.ratingFlag > 5)) invalid('Rating must be from 1 to 5.');
    const data = await client.authenticated('/api/cloud/v1/trial-feedback', json({
      comment: opts.noteText, rating: opts.ratingFlag == null ? null : opts.ratingFlag,
      idempotency_key: crypto.randomUUID() }));
    return emit(opts, 'cloud.trial-feedback', data, 'Feedback received.');
  }
  const id = await account();
  if (action === 'invite') {
    if (!opts.extra || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(opts.extra)) invalid('Use cloud invite EMAIL.');
    if (opts.roleFlag && !['member', 'admin'].includes(opts.roleFlag)) invalid('Invitation role must be member or admin.');
    const data = await client.authenticated('/api/cloud/v1/account/invitations', json({
      account_id: id, email: opts.extra, role: opts.roleFlag || 'member' }));
    return emit(opts, 'cloud.invite', data, (data.invitation.notification_scheduled ? 'Invitation queued for ' : 'Invitation created for ') + data.invitation.email + '.');
  }
  if (action === 'invitations') {
    const data = await client.authenticated('/api/cloud/v1/account/invitations?account_id=' + encodeURIComponent(id));
    return emit(opts, 'cloud.invitations', data);
  }
  if (!opts.extra) invalid('Use cloud ' + action + ' ' + (action === 'remove-member' ? 'USER_ID' : 'INVITATION_ID'));
  const endpoint = action === 'remove-member'
    ? '/api/cloud/v1/workspaces/' + encodeURIComponent(id) + '/members/' + encodeURIComponent(opts.extra)
    : '/api/cloud/v1/account/invitations/' + encodeURIComponent(opts.extra);
  const options = json({ account_id: id }); options.method = 'DELETE';
  const data = await client.authenticated(endpoint, options);
  return emit(opts, 'cloud.' + action, { ...data, account_id: id,
    ...(action === 'remove-member' ? { user_id: opts.extra } : { invitation_id: opts.extra }) });
}

module.exports = { ACTIONS, HELP, run };
