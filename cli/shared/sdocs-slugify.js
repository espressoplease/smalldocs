// sdocs-slugify.js — Slugify heading text into URL-safe IDs
// Shared by sdocs-app.js (browser) and test/test-slugify.js (Node)
(function (exports) {
'use strict';

function slugify(text) {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

exports.slugify = slugify;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocSlugify = {}));
