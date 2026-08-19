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
    if (account.kind === 'personal' && user) {
      var fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
      if (fullName) return fullName;
    }
    return account.name || 'Cloud';
  }

  function initials(value) {
    var parts = String(value || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : ''))
      .toUpperCase();
  }

  exports.STORAGE_KEY = STORAGE_KEY;
  exports.storedId = storedId;
  exports.remember = remember;
  exports.resolve = resolve;
  exports.label = label;
  exports.initials = initials;
})(typeof module !== 'undefined' && module.exports
  ? module.exports : (window.SDocsCloudAccountSelection = {}));
