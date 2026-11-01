'use strict';

const { renderPublicationPage } = require('../lib/publication-render');

module.exports = function (harness) {
  const { test, assert } = harness;
  const render = options => renderPublicationPage(Object.assign({
    title: 'Public guide', description: 'A complete public article.', url: 'https://example.com/p/public-guide',
    publishedAt: '2026-11-02T10:00:00Z',
  }, options));

  test('publication includes readable initial headings, prose, lists, tables, and code', () => {
    const html = render({ markdown: '# Public guide\n\nHello **reader**.\n\n## Examples\n\n- One\n- Two\n\n| Name | Count |\n| --- | --- |\n| Books | 3 |\n\n```js\nconsole.log("hello");\n```' });
    assert.ok(html.includes('<h1 id="public-guide">Public guide</h1>'));
    assert.ok(html.includes('<h2 id="examples">Examples</h2>'));
    assert.ok(html.includes('<p>Hello <strong>reader</strong>.</p>'));
    assert.ok(html.includes('<li>One</li>'));
    assert.ok(html.includes('<table>') && html.includes('<td>Books</td>'));
    assert.ok(html.includes('class="language-js">console.log(&quot;hello&quot;);'));
    const source = JSON.parse(/<script id="publication-source" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
    assert.ok(source.markdown.includes('# Public guide'));
  });

  test('publication supplies title, description, canonical, Open Graph, and dates', () => {
    const html = render({ markdown: 'Body.', updatedAt: '2026-11-03T09:00:00Z' });
    assert.ok(html.includes('<title>Public guide | SmallDocs</title>'));
    assert.ok(html.includes('<meta name="description" content="A complete public article.">'));
    assert.ok(html.includes('<link rel="canonical" href="https://example.com/p/public-guide">'));
    assert.ok(html.includes('<meta property="og:type" content="article">'));
    assert.ok(html.includes('<meta property="og:title" content="Public guide">'));
    assert.ok(html.includes('datetime="2026-11-03T09:00:00.000Z"'));
  });

  test('publication escapes raw HTML and executable fence content', () => {
    const html = render({ markdown: '<script>window.pwned=1</script>\n\n<img src=x onerror="alert(1)">\n\n<iframe srcdoc="attack"></iframe>\n\n```html\n<script>alert(1)</script>\n```' });
    assert.ok(html.includes('&lt;script&gt;window.pwned=1&lt;/script&gt;'));
    assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
    assert.ok(!/<script[^>]*>window.pwned|<img src=x|<iframe/.test(html));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  });

  test('publication rejects unsafe and encoded URL schemes while keeping labels', () => {
    const html = render({ markdown: '[Bad](javascript:alert%281%29) [Encoded](jav&#x61;script:alert%281%29) [Data](data:text/html,attack) [Relative](/api/cloud/documents) ![Unsafe](data:image/svg+xml,attack) [Good](https://example.org/a?x=1&y=2) [Jump](#section)' });
    assert.ok(!/(?:href|src)="(?:javascript|jav&|data:|\/api)/i.test(html));
    assert.ok(html.includes('Bad') && html.includes('Encoded') && html.includes('Unsafe'));
    assert.ok(html.includes('href="https://example.org/a?x=1&amp;y=2"'));
    assert.ok(html.includes('href="#section"'));
  });

  test('publication escapes metadata without injecting tags, attributes, or JSON-LD', () => {
    const attack = '"><script>alert(1)</script><img src=x onerror=attack>';
    const html = render({ markdown: 'Safe body', title: attack, description: attack, authorName: attack, url: 'javascript:alert(1)', publishedAt: attack });
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!html.includes('<script>alert(1)'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes('rel="canonical"'));
    assert.ok(!html.includes('datetime="'));
  });

  test('publication preserves escaped link queries and image attribute text', () => {
    const html = render({ markdown: '[Query](https://example.org/?a=1&amp;b=2 "A & B") ![A & B](https://example.org/image.png)' });
    assert.ok(html.includes('href="https://example.org/?a=1&amp;b=2"'));
    assert.ok(html.includes('title="A &amp; B"'));
    assert.ok(html.includes('alt="A &amp; B"'));
    assert.ok(!html.includes('&amp;amp;'));
  });

  test('publication whitelists rendered style values and never embeds frontmatter metadata', () => {
    const html = render({ markdown: '---\ncomments: secret-comment\ntags: private-tag\nsource: /Users/secret/file.md\nauthor: private-identity\nstyles:\n  color: "#123456"\n  baseFontSize: 18\n  background: "url(https://attacker.example/exfil)"\n  fontFamily: "</style><script>attack</script>"\n---\n\n# Public\n\nBody.' });
    assert.ok(html.includes('--md-color:#123456'));
    assert.ok(html.includes('--md-base-size:18px'));
    ['secret-comment', 'private-tag', '/Users/secret', 'private-identity', 'attacker.example', '<script>attack'].forEach(secret => assert.ok(!html.includes(secret), secret));
    assert.ok(html.includes('<h1 id="public">Public</h1>'));
  });

  test('publication retains rich sources and readable chart data before enhancement', () => {
    const html = render({ markdown: '```mermaid\nflowchart LR\n A[Start] --> B[Finish]\n```\n\n```chart\n{"type":"bar","title":"Books","labels":["April"],"values":[12]}\n```' });
    assert.ok(html.includes('A[Start] --&gt; B[Finish]'));
    assert.ok(html.includes('<caption>Books</caption>'));
    assert.ok(html.includes('<th scope="row">April</th><td>12</td>'));
    assert.ok(html.includes('/public/publication-reader.js'));
    assert.ok(!html.includes('/public/sdocs-app.js'));
    assert.ok(!html.includes('/api/cloud'));
  });

  test('publication loads no rich feature modules for ordinary prose', () => {
    const html = render({ markdown: 'Ordinary prose.' });
    assert.ok(!html.includes('sdocs-mermaid.js') && !html.includes('sdocs-charts.js') && !html.includes('purify.min.js'));
  });

  test('publication deduplicates heading IDs and preserves approximate quantities', () => {
    const html = render({ markdown: '## Example\n\n~$15 for ~17 years.\n\n## Example\n\n~~Old~~' });
    assert.ok(html.includes('id="example"') && html.includes('id="example-1"'));
    assert.ok(html.includes('~$15 for ~17 years.'));
    assert.ok(html.includes('<del>Old</del>'));
  });

  test('publication retains complete rich fence source for the shared renderer without inventing a heading', () => {
    const markdown = '```slide\ngrid 16 9\nr 1 1 14 7 | A real slide\n```\n\n```cells Budget/Plan\nItem,Cost\nBooks,12\n```';
    const html = render({ markdown, title: 'Untitled document' });
    const source = JSON.parse(/<script id="publication-source" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
    assert.strictEqual(source.markdown, markdown);
    assert.ok(!html.includes('<h1>Untitled document</h1>'));
  });

  test('publication source payload cannot terminate its script element', () => {
    const markdown = '```html\n</script><script>window.pwned=1</script>\n```';
    const html = render({ markdown });
    const source = /<script id="publication-source" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1];
    assert.ok(!source.includes('<'));
    assert.strictEqual(JSON.parse(source).markdown, markdown);
    assert.ok(!html.includes('<script>window.pwned=1</script>'));
  });
};
