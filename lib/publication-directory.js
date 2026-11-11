'use strict';
const fs = require('fs');
const path = require('path');
const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g,
  character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const pageUrl = page => '/published' + (page > 1 ? '?page=' + page : '');

function pageNumber(value) {
  if (value == null) return 1;
  if (!/^[1-9]\d*$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && Number.isSafeInteger((number - 1) * 50000) ? number : null;
}

function renderDirectory({ origin, page, items, has_next, has_previous, views = null }) {
  let groups = '', date = '';
  const dateLabel = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' });
  for (const item of items) {
    const nextDate = new Date(item.published_at_ms).toISOString().slice(0, 10);
    if (date !== nextDate) {
      if (date) groups += '</div></section>';
      date = nextDate;
      groups += '<section class="day-group"><h2 class="day-header day-label"><time datetime="' + date + '">' +
        dateLabel.format(new Date(item.published_at_ms)) + '</time></h2><div class="results-list">';
    }
    const count = views && (views.get(item.slug) || 0);
    groups += '<a class="res" href="/p/' + escape(item.slug) + '"><div><h3 class="res-title">' + escape(item.title) +
      '</h3>' + (item.description ? '<p class="published-description">' + escape(item.description) + '</p>' : '') +
      '</div>' + (views ? '<span class="published-views">' + count.toLocaleString('en-GB') +
        (count === 1 ? ' page view' : ' page views') + '</span>' : '') + '</a>';
  }
  if (date) groups += '</div></section>';
  const navigation = '<nav class="published-pagination" aria-label="Published pages">' +
    (has_previous ? '<a href="' + pageUrl(page - 1) + '" rel="prev">Previous</a>' : '<span></span>') +
    '<span>Page ' + page + '</span>' + (has_next ? '<a href="' + pageUrl(page + 1) + '" rel="next">Next</a>' : '<span></span>') + '</nav>';
  return fs.readFileSync(path.join(__dirname, '../public/published.html'), 'utf8')
    .replace('__TITLE__', 'Published pages' + (page > 1 ? ', page ' + page : ''))
    .replace('__CANONICAL__', escape(origin + pageUrl(page)))
    .replace('__ENTRIES__', () => groups || '<p>No published pages yet.</p>')
    .replace('__PAGINATION__', () => items.length ? navigation : '');
}

module.exports = { pageNumber, renderDirectory };
