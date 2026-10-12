// Rebuild the homepage's document links from their readable Markdown sources.
const fs = require('fs');
const path = require('path');
const { buildUrl } = require('../cli/lib/url');

const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'public/homepage/examples');
const samples = JSON.parse(fs.readFileSync(path.join(directory, 'samples.json'), 'utf8'));
const escape = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const icon = '<svg class="learn-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="m10 14 11-11"/></svg>';

function renderSamples() {
  const headings = { Engineering: 'For engineers:', Science: 'For scientists:', Finance: 'For financiers:', Mathematics: 'For mathematicians:' };
  return ['Engineering', 'Science', 'Finance', 'Mathematics'].map(category => {
    const links = samples.filter(sample => sample.category === category).map(sample => {
      const url = sample.url || buildUrl(fs.readFileSync(path.join(directory, sample.source), 'utf8'), { url: '/docs' }).replace('/docs/#', '/docs#');
      return `            <a class="learn-item" data-sample="${escape(sample.source || sample.title)}" href="${escape(url)}" style="--sample-background: ${escape(sample.background)}" target="_blank" rel="noopener">
              <span class="learn-item-prompt">&ldquo;${escape(sample.prompt)}&rdquo;</span>
              ${icon}
            </a>`;
    }).join('\n');
    return `          <div class="sample-group" role="group" aria-labelledby="samples-${category.toLowerCase()}">
            <h3 class="sample-group-heading" id="samples-${category.toLowerCase()}">${headings[category]}</h3>
${links}
          </div>`;
  }).join('\n\n');
}

if (require.main === module) {
  const file = path.join(root, 'public/homepage-next.html');
  const html = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, html.replace(/<!-- sample-links:start -->[\s\S]*?<!-- sample-links:end -->/, `<!-- sample-links:start -->\n${renderSamples()}\n          <!-- sample-links:end -->`));
}

module.exports = { renderSamples };
