// Record an aggregate Library page visit through the same first-party endpoint
// used by the reader. The Library does not start the reader update flow, so it
// makes one background request when the shell loads.
(function () {
  'use strict';

  function isoWeek() {
    var d = new Date();
    var utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    var day = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - day);
    var yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
    var week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
    return utc.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
  }

  try {
    var cohort = '';
    try {
      cohort = localStorage.getItem('sdocs_cohort') || '';
      if (!cohort) {
        cohort = isoWeek();
        localStorage.setItem('sdocs_cohort', cohort);
      }
      if (cohort === 'opt-out') cohort = '';
    } catch (e) {}

    var scope = new URLSearchParams(window.location.search).get('scope');
    var loadType = scope === 'cloud' ? 'cloud-library' : 'library';
    var now = new Date();
    var query = '?cohort=' + encodeURIComponent(cohort) + '&lt=' + loadType
      + '&lh=' + now.getHours() + '&ld=' + now.getDay();
    fetch('/version-check' + query, { credentials: 'same-origin' }).catch(function () {});
  } catch (e) {}
})();
