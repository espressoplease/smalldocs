(function (exports) {
  'use strict';

  var STORAGE_KEY = 'sdocs.cloud.account_id';

  function storedId(storage) {
    try { return storage && storage.getItem(STORAGE_KEY); } catch (_) { return null; }
  }

  function remember(storage, accountId) {
    try {
      if (!storage) return;
      if (accountId) storage.setItem(STORAGE_KEY, accountId);
      else storage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }

  function resolve(accounts, explicitId, storage) {
    accounts = Array.isArray(accounts) ? accounts : [];
    var requested = explicitId || storedId(storage);
    var selected = requested && accounts.find(function (account) { return account.id === requested; });
    if (selected) {
      remember(storage, selected.id);
      return selected;
    }
    if (requested) remember(storage, null);
    if (accounts.length === 1) {
      remember(storage, accounts[0].id);
      return accounts[0];
    }
    return null;
  }

  function label(account, user) {
    if (!account) return 'Cloud';
    if (account.kind === 'personal') return 'Personal';
    return account.name || 'Cloud';
  }

  function orderedLibraries(libraries) {
    return libraries.slice().sort(function (a, b) {
      return Number(a.kind !== 'personal') - Number(b.kind !== 'personal');
    });
  }

  // Lucide user-round and users-round, shared by both library switchers.
  function icon(kind) {
    var paths = kind === 'personal'
      ? '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>'
      : '<path d="M18 21a8 8 0 0 0-16 0"/><circle cx="10" cy="8" r="5"/><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"/>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-library-kind="' + (kind === 'personal' ? 'personal' : 'team') + '">' + paths + '</svg>';
  }

  function initials(value) {
    var parts = String(value || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : ''))
      .toUpperCase();
  }

  function colorHash(id) {
    var hash = 0;
    String(id || '').split('').forEach(function (character) { hash = ((hash * 31) + character.charCodeAt(0)) >>> 0; });
    return hash;
  }
  function color(id) {
    var hue = (colorHash('library:' + id) * 137.508) % 360;
    var lightness = hue >= 40 && hue <= 180 ? 35 : 40;
    return 'hsl(' + hue.toFixed(3) + ', 65%, ' + lightness + '%)';
  }
  function personColor(id, isYou) {
    if (!id || isYou) return null;
    // Derive the hue from identity, never the current roster or selected access.
    return 'hsl(' + ((colorHash(id) * 137.508) % 360).toFixed(3) + ', 65%, 40%)';
  }
  exports.color = color;
  exports.icon = icon;
  exports.orderedLibraries = orderedLibraries;
  exports.personColor = personColor;
  exports.STORAGE_KEY = STORAGE_KEY;
  exports.storedId = storedId;
  exports.remember = remember;
  exports.resolve = resolve;
  exports.label = label;
  exports.initials = initials;
})(typeof module !== 'undefined' && module.exports
  ? module.exports : (window.SDocsCloudAccountSelection = {}));
