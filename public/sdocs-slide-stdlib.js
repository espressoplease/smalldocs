// sdocs-slide-stdlib.js - built-in slide templates (UMD).
//
// Each entry is a DSL string the resolver registers under the given name,
// alongside user `@template` definitions. User-defined templates shadow
// stdlib names (with a warning surfaced through the slide error badge),
// so authors can override any built-in without touching this file.
//
// Design constants applied across every template:
//   - 1-unit safe margin on all four sides of a 16x9 grid (roughly 6%
//     horizontal, 5-7% vertical, matching the standard slide safe area).
//   - No shape fill colours for shapes containing title/body text. The
//     section divider uses `grid bg=` for full-bleed contrast instead.
//   - Title role (64px) reserved for cover + quote + section. In-deck
//     content slides use subtitle role (40px) so action titles can wrap
//     to two lines without filling half the page.
//   - Caption role (14px) reserved for eyebrows / footers / attributions
//     - never for load-bearing content (it renders as ~3px in a 240px
//     thumbnail, illegible).
//   - Optional slots default to empty content, so omitting them renders
//     nothing visible. Required slots (#name!) emit a resolver error
//     when the consumer doesn't fill them.
//
// All templates assume a 16x9 grid. Authors who need a different aspect
// ratio should copy a template into a user `@template` and edit the grid.

(function (exports) {
'use strict';

var TEMPLATES = {

  // Opening slide. Once per deck, sets the tone before anything else.
  cover: [
    'grid 16 9',
    'r 1 1 14 0.7 #eyebrow text=caption color=#64748b align=left |',
    'r 1 3.2 14 2.2 #title! text=title align=left | (required: cover title)',
    'r 1 5.8 14 1.0 #subtitle text=subtitle color=#475569 align=left |',
    'r 1 7.7 14 0.6 #meta text=caption color=#64748b align=left |',
  ].join('\n'),

  // The workhorse. 60-70% of body slides. Title at top, body filling the
  // safe area below, optional footer for source / page / context. Title
  // uses subtitle role so an action title can wrap to two lines without
  // crowding the body.
  'title-body': [
    'grid 16 9',
    'r 1 0.7 14 1.1 #title! text=subtitle align=left | (required: slide title)',
    'r 1 2.2 14 5.7 #body! text=body align=left valign=top | (required: slide body)',
    'r 1 8.1 14 0.4 #footer text=caption color=#94a3b8 align=left |',
  ].join('\n'),

  // Two equal columns with a 1-unit gutter, both bodies anchored top so
  // matched-length content reads as parallel. Optional column headers in
  // caption role above each body.
  'two-column': [
    'grid 16 9',
    'r 1 0.7 14 1.1 #title! text=subtitle align=left | (required: slide title)',
    'r 1 2.4 6.5 0.5 #left-header text=caption color=#475569 align=left |',
    'r 1 3.0 6.5 5.0 #left! text=body align=left valign=top | (required: left column)',
    'r 8.5 2.4 6.5 0.5 #right-header text=caption color=#475569 align=left |',
    'r 8.5 3.0 6.5 5.0 #right! text=body align=left valign=top | (required: right column)',
  ].join('\n'),

  // Three-way compare. A/B/C variants, before/during/after, three
  // perspectives on the same question. Three equal columns (4.3 wide
  // each) separated by 0.55-unit gutters, optional headers above each.
  // Bias to keeping all three columns roughly the same length - if one
  // is half-empty, drop it and use two-column.
  'three-column': [
    'grid 16 9',
    'r 1 0.7 14 1.1 #title! text=subtitle align=left | (required: slide title)',
    'r 1 2.4 4.3 0.5 #left-header text=caption color=#475569 align=left |',
    'r 1 3.0 4.3 5.0 #left! text=body align=left valign=top | (required: left column)',
    'r 5.85 2.4 4.3 0.5 #mid-header text=caption color=#475569 align=left |',
    'r 5.85 3.0 4.3 5.0 #mid! text=body align=left valign=top | (required: middle column)',
    'r 10.7 2.4 4.3 0.5 #right-header text=caption color=#475569 align=left |',
    'r 10.7 3.0 4.3 5.0 #right! text=body align=left valign=top | (required: right column)',
  ].join('\n'),

  // Exhibit. Chart on the left (~56% wide), takeaway column on the
  // right (~28% wide). The chart is the evidence; the takeaway tells
  // the audience what to see. Optional source caption at the bottom.
  // Reserve for business decks where the audience needs a verbal
  // handle on the chart under time pressure - if your audience can
  // read the chart themselves in 5 seconds, use figure-hero instead.
  exhibit: [
    'grid 16 9',
    'r 1 0.7 14 1.1 #title! text=subtitle align=left | (required: action title)',
    'r 1 2 9 6 #chart! align=center valign=center | (required: ![alt](url) or chart)',
    'r 10.5 2 4.5 6 #takeaway! text=body align=left valign=center | (required: takeaway)',
    'r 1 8.1 14 0.4 #source text=caption color=#94a3b8 align=left |',
  ].join('\n'),

  // Image-and-text. Image fills the left half of the safe area, body
  // sits on the right. The image slot accepts markdown image syntax:
  // `#image: ![alt](url)`. Optional small title above both columns.
  'image-and-text': [
    'grid 16 9',
    'r 1 0.7 14 0.9 #title text=caption color=#475569 align=left |',
    'r 1 1.9 7.5 6.2 #image! align=center valign=center | (required: ![alt](url))',
    'r 9 1.9 6 6.2 #body! text=body align=left valign=center | (required: body)',
  ].join('\n'),

  // Image-dominant slide. The figure carries the slide; a small
  // caption sits below. Use when the image IS the argument (a chart,
  // a screenshot, a product shot, a photo). If you want supporting
  // body text alongside the image, use `image-and-text` instead.
  'figure-hero': [
    'grid 16 9',
    'r 1 0.6 14 7.0 #image! align=center valign=center | (required: ![alt](url))',
    'r 1 7.9 14 0.6 #caption text=caption color=#475569 align=center valign=top |',
  ].join('\n'),

  // Single big idea. Quote, customer voice, or a callout sentence that
  // deserves the whole slide. Lead is centered both ways so short content
  // sits visually balanced rather than top-left adrift.
  quote: [
    'grid 16 9',
    'r 2 2 12 4 #lead! text=title align=center valign=center | (required: the lead)',
    'r 2 6.5 12 0.7 #attribution text=caption color=#64748b align=center valign=top |',
  ].join('\n'),

  // One big number + a line of context. The hero metric slide.
  // `size=fit` lets the number balloon to fill its shape, so a 3-char
  // value (`87%`) lands much larger than a long one (`$4,231,889`).
  // `maxfont=300px` lifts the default 12%-of-stage cap so the number
  // can actually feel hero-sized; without it, autofit would cap at
  // ~86px on a 720-tall stage and the slide reads as "a small number
  // floating in a big box" rather than "stop the room".
  // Use sparingly - one metric slide per deck is the rule, not three.
  metric: [
    'grid 16 9',
    'r 1 1.5 14 4.8 #metric! size=fit maxfont=300px align=center valign=center | (required: the number)',
    'r 1 6.7 14 1.4 #context text=body color=#475569 align=center valign=top |',
  ].join('\n'),

  // Section divider. The one template where the slide background gets a
  // saturated fill - the contrast against content slides is the point.
  // Text shapes themselves have no fill (Consultant-2 rule preserved);
  // the grid's bg= provides the colour underneath.
  section: [
    'grid 16 9 bg=#0f172a',
    'r 1 1 14 0.7 #kicker text=caption color=#94a3b8 align=left |',
    'r 1 3 14 3 #title! text=title color=#f8fafc align=left valign=center | (required: section title)',
    'r 1 6 14 1 #subtitle text=subtitle color=#cbd5e1 align=left valign=center |',
  ].join('\n'),

  // Closing slide. Symmetric bookend with `cover`. Center-aligned and
  // minimal - one quiet message + optional contact line. Don't write
  // "Thanks for listening" here; pick something the audience will
  // remember instead.
  closing: [
    'grid 16 9',
    'r 1 3.5 14 2.0 #lead! text=subtitle align=center valign=center | (required: closing line)',
    'r 1 6 14 0.6 #contact text=caption color=#64748b align=center valign=center |',
  ].join('\n'),

};

// Per-template slot summary for `sdoc slides list` and the resolver's
// unknown-slot check. Required slots end with `!` here too, matching the
// DSL marker. Order matters - it controls how the listing reads.
var SLOT_DOCS = {
  cover:           ['eyebrow', 'title!', 'subtitle', 'meta'],
  'title-body':    ['title!', 'body!', 'footer'],
  'two-column':    ['title!', 'left-header', 'left!', 'right-header', 'right!'],
  'three-column':  ['title!', 'left-header', 'left!', 'mid-header', 'mid!', 'right-header', 'right!'],
  exhibit:         ['title!', 'chart!', 'takeaway!', 'source'],
  'image-and-text':['title', 'image!', 'body!'],
  'figure-hero':   ['image!', 'caption'],
  quote:           ['lead!', 'attribution'],
  metric:          ['metric!', 'context'],
  section:         ['kicker', 'title!', 'subtitle'],
  closing:         ['lead!', 'contact'],
};

exports.templates = TEMPLATES;
exports.slots = SLOT_DOCS;
exports.names = Object.keys(TEMPLATES);

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocSlideStdlib = {}));
