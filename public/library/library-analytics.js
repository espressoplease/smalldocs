// Record one aggregate homepage or Library visit through the reader's
// first-party endpoint, without starting the reader update flow.
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

    var params = new URLSearchParams(window.location.search);
    var loadType = document.currentScript && document.currentScript.dataset.loadType === 'home'
      ? 'home' : params.get('scope') === 'cloud' ? 'cloud-library' : 'library';
    var now = new Date();
    var query = '?cohort=' + encodeURIComponent(cohort) + '&lt=' + loadType
      + '&lh=' + now.getHours() + '&ld=' + now.getDay();
    if (loadType === 'home' && params.get('src')) query += '&src=' + encodeURIComponent(params.get('src').trim().toLowerCase());
    fetch('/version-check' + query, { credentials: 'same-origin' }).catch(function () {});
  } catch (e) {}
})();
