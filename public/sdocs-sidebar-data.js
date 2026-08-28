(function (exports) {
  'use strict';

  function normaliseTags(tags) {
    var seen = {};
    return (Array.isArray(tags) ? tags : []).map(function (tag) {
      return String(tag).trim();
    }).filter(function (tag) {
      var key = tag.toLowerCase();
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function timestamp(entry) {
    if (!entry) return 0;
    var value = entry.updated_at || entry.mtime || entry.firstSeen || 0;
    var time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function entriesByRecency(entries) {
    return (Array.isArray(entries) ? entries : []).slice().sort(function (a, b) {
      return timestamp(b) - timestamp(a) || String(a.id || '').localeCompare(String(b.id || ''));
    });
  }

  function isCurrentEntry(entry, current) {
    if (!entry || !current) return false;
    if (current.id && entry.id && current.id === entry.id) return true;
    return Boolean(current.path && entry.path && current.path === entry.path);
  }

  function withoutCurrent(entries, current) {
    return (Array.isArray(entries) ? entries : []).filter(function (entry) {
      return !isCurrentEntry(entry, current);
    });
  }

  function relatedGroups(currentTags, entries, current) {
    var tags = normaliseTags(currentTags);
    var groups = {};

    withoutCurrent(entries, current).forEach(function (entry) {
      var entryTags = {};
      normaliseTags(entry.tags).forEach(function (tag) { entryTags[tag.toLowerCase()] = true; });
      var shared = tags.filter(function (tag) { return entryTags[tag.toLowerCase()]; });
      if (!shared.length) return;
      var key = shared.map(function (tag) { return tag.toLowerCase(); }).join('\u0000');
      if (!groups[key]) groups[key] = { tags: shared, entries: [] };
      groups[key].entries.push(entry);
    });

    return Object.keys(groups).map(function (key) {
      var group = groups[key];
      group.entries = entriesByRecency(group.entries);
      return group;
    }).sort(function (a, b) {
      if (a.tags.length !== b.tags.length) return b.tags.length - a.tags.length;
      return timestamp(b.entries[0]) - timestamp(a.entries[0]);
    });
  }

  function recentEntries(entries, current, limit) {
    var resultLimit = Math.max(0, Number(limit) || 0);
    return entriesByRecency(withoutCurrent(entries, current)).slice(0, resultLimit);
  }

  function sharedDocumentCount(groups) {
    return (Array.isArray(groups) ? groups : []).reduce(function (total, group) {
      return total + (Array.isArray(group.entries) ? group.entries.length : 0);
    }, 0);
  }

  function sharedTagCount(groups) {
    var tags = {};
    (Array.isArray(groups) ? groups : []).forEach(function (group) {
      normaliseTags(group.tags).forEach(function (tag) { tags[tag.toLowerCase()] = true; });
    });
    return Object.keys(tags).length;
  }

  exports.normaliseTags = normaliseTags;
  exports.entriesByRecency = entriesByRecency;
  exports.isCurrentEntry = isCurrentEntry;
  exports.withoutCurrent = withoutCurrent;
  exports.relatedGroups = relatedGroups;
  exports.recentEntries = recentEntries;
  exports.sharedDocumentCount = sharedDocumentCount;
  exports.sharedTagCount = sharedTagCount;
})(typeof module !== 'undefined' && module.exports
  ? module.exports : (window.SDocsSidebarData = {}));
