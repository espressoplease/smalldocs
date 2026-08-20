'use strict';

function cleanLine(value, fallback) {
  const text = String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
  return text || fallback || '';
}

function cleanMultiline(value) {
  return String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(value) {
  const url = new URL(String(value));
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('email links must use http or https');
  }
  return url.toString();
}

function documentShell(preview, content) {
  return '<!doctype html>' +
    '<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(preview) + '</title></head>' +
    '<body style="margin:0;background:#ffffff;color:#1b1815;' +
      'font-family:Inter,Arial,sans-serif;line-height:1.5">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' +
      escapeHtml(preview) + '</div>' +
    '<div style="max-width:560px;margin:0 auto;padding:32px 24px">' +
      '<div style="color:#2563eb;font-size:15px;font-weight:600;' +
        'letter-spacing:-0.02em;margin:0 0 25px">SmallDocs</div>' +
      '<div style="border-top:1px solid #e7e2da;padding-top:20px">' + content + '</div>' +
      '<p style="color:#938c82;font-size:12px;margin:22px 0 0">' +
        'This message was sent by SmallDocs.</p>' +
    '</div></body></html>';
}

function heading(text) {
  return '<h1 style="font-size:18px;line-height:1.3;font-weight:600;' +
    'letter-spacing:-0.022em;margin:0 0 8px">' + escapeHtml(text) + '</h1>';
}

function paragraph(text, margin) {
  return '<p style="color:#56504a;font-size:14px;margin:' + (margin || '0') + '">' +
    escapeHtml(text) + '</p>';
}

function button(label, href) {
  return '<p style="margin:15px 0 0"><a href="' + escapeHtml(safeUrl(href)) + '" ' +
    'style="display:inline-block;background:#ede8e2;border:1px solid #d4cfc9;' +
    'color:#1b1815;text-decoration:none;font-size:13px;font-weight:500;line-height:1;' +
    'border-radius:6px;padding:9px 13px">' + escapeHtml(label) + '</a></p>';
}

function signInCode(input) {
  const code = cleanLine(input && input.code);
  if (!code) throw new Error('sign-in code is required');
  const expiresMinutes = Number(input && input.expiresMinutes) || 10;
  const subject = 'Your SmallDocs sign-in code';
  const preview = 'Use ' + code + ' to sign in to SmallDocs.';
  const text = 'Your SmallDocs sign-in code is: ' + code + '\n\n' +
    'The code expires in ' + expiresMinutes + ' minutes.\n\n' +
    'If you did not request this code, you can ignore this email.';
  const html = documentShell(preview,
    heading('Sign in to SmallDocs') +
    paragraph('Enter this code in the sign-in window.', '0 0 14px') +
    '<div style="border-top:1px solid #e7e2da;border-bottom:1px solid #e7e2da;' +
      'padding:11px 0"><span style="font-family:ui-monospace,SFMono-Regular,Consolas,' +
      'monospace;font-size:24px;font-weight:600;letter-spacing:0.08em;' +
      'user-select:all">' + escapeHtml(code) + '</span></div>' +
    '<p style="color:#938c82;font-size:12.5px;margin:10px 0 0">Expires in ' +
      expiresMinutes + ' minutes. If you did not request this code, you can ignore this email.</p>');
  return { subject, text, html };
}

function workspaceInvitation(input) {
  const acceptUrl = safeUrl(input && input.acceptUrl);
  const inviter = cleanLine(input && input.inviter, 'A SmallDocs account member');
  const accountName = cleanLine(input && input.accountName, 'a SmallDocs account');
  const invitation = inviter + ' invited you to join ' + accountName + ' in SmallDocs Cloud.';
  const subject = inviter + ' invited you to ' + accountName;
  const preview = invitation;
  const text = invitation + '\n\n' +
    'Open the invitation:\n' + acceptUrl;
  const html = documentShell(preview,
    heading('Join ' + accountName) +
    paragraph(invitation, '0') +
    button('Open invitation', acceptUrl));
  return { subject, text, html };
}

function documentNotification(input) {
  const actor = cleanLine(input && input.actor, 'Someone');
  const note = cleanMultiline(input && input.note);
  const noteAuthor = actor.split(/\s+/)[0];
  const documents = Array.isArray(input && input.documents) ? input.documents.map((document) => ({
    title: cleanLine(document && document.title, 'Untitled'),
    url: safeUrl(document && document.url),
  })) : [];
  if (!documents.length) throw new Error('at least one document is required');
  const count = documents.length;
  const singular = count === 1;
  const noun = 'document' + (count === 1 ? '' : 's');
  const subject = singular
    ? actor + ' sent you a document link from SmallDocs Cloud'
    : actor + ' sent ' + count + ' document links from SmallDocs Cloud';
  const preview = actor + ' sent you ' + (singular ? 'a document' : count + ' ' + noun) +
    ' in SmallDocs Cloud.';
  const textLinks = documents.map((document) => document.title + '\n' + document.url).join('\n\n');
  const textNote = note ? '\n\nNote from ' + noteAuthor + ':\n' + note : '';
  const text = preview + textNote + '\n\n' + textLinks;
  const htmlNote = note ? '<div style="border-left:2px solid #2563eb;padding:7px 0 7px 11px;' +
    'margin:0 0 13px"><p style="font-size:10.5px;letter-spacing:0.06em;text-transform:' +
    'uppercase;color:#938c82;margin:0 0 3px">Note from ' + escapeHtml(noteAuthor) + '</p>' +
    '<p style="color:#56504a;font-size:13px;margin:0">' +
      escapeHtml(note).replace(/\n/g, '<br>') + '</p></div>' : '';
  const list = documents.map((document) =>
    '<p style="border-top:1px solid #e7e2da;font-size:13.5px;margin:0;padding:9px 0">' +
      '<a href="' + escapeHtml(document.url) + '" style="color:#2563eb;font-weight:500;' +
      'text-decoration:none">' + escapeHtml(document.title) + '</a></p>'
  ).join('');
  const html = documentShell(preview,
    heading((singular ? 'Document' : 'Documents') + ' from ' + actor) +
    paragraph(preview, '0 0 14px') + htmlNote + list);
  return { subject, text, html };
}

module.exports = { cleanLine, cleanMultiline, escapeHtml, safeUrl, signInCode, workspaceInvitation,
  documentNotification };
