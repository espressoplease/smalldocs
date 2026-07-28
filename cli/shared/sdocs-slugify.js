// sdocs-slugify.js — Slugify heading text into URL-safe IDs
// Shared by sdocs-app.js (browser) and test/test-slugify.js (Node)
(function (exports) {
'use strict';

function slugify(text) {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// Candidate element ids for a raw in-page link fragment, most literal first.
//
// Headings get their id from slugify(), which drops `_` and collapses repeated
// hyphens. GitHub's slugger keeps `_` and leaves a doubled hyphen wherever
// punctuation sat, so a link written against GitHub (`#step-1--setup`) does not
// match the id we generated (`step-1-setup`). Try the fragment as written, then
// the two shapes it most often needs to become.
function anchorCandidates(fragment) {
  var out = [];
  function push(v) { if (v && out.indexOf(v) === -1) out.push(v); }
  push(fragment);
  push(slugify(fragment));
  push(fragment.replace(/-+/g, '-').replace(/^-|-$/g, ''));
  return out;
}

exports.slugify = slugify;
exports.anchorCandidates = anchorCandidates;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocSlugify = {}));
