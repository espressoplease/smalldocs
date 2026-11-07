'use strict';
const {renderPublicationShell,publicationSource,documentRoot}=require('../lib/publication-shell');
module.exports=function(h){const {test,assert}=h;
 const source={title:'A published guide',description:'A readable guide',url:'https://example.test/p/guide',markdown:'# A published guide\n\nBody.'};
 test('public publications reuse the full app template, navigation and controls',()=>{
  const html=renderPublicationShell({source,rootHtml:'<div id="_sd_rendered" class="sdoc-reader"><h1>A published guide</h1><p>Body.</p></div>'});
  for(const name of ['_sd_sidebar','_sd_btn-copy-file','_sd_btn-fold','sdocs-publication-source.js','sdocs-app.js','sdocs-slide-reader.js'])assert(html.includes(name),name);
  assert(html.includes('<h1>A published guide</h1>'));
  assert(!html.includes('/sdk/')&&!html.includes('publication-reader.js'));
  assert(!html.includes('__CSP_NONCE__'));
 });
 test('public shell includes canonical title and description without homepage metadata',()=>{
  const html=renderPublicationShell({source});
  assert(html.includes('<title>A published guide | SmallDocs</title>'));
  assert(html.includes('<meta property="og:type" content="article">'));
  assert(html.includes('<link rel="canonical" href="https://example.test/p/guide">'));
  assert(!html.includes('og-preview.png'));
 });
 test('public source JSON cannot terminate the script element or alter template replacement',()=>{
  const markdown='</script><script>window.attack=1</script>\n$& $` $\'';
  const html=renderPublicationShell({source:{...source,markdown,title:'Title $& <script>'}});
  const value=/<script id="sdocs-publication-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1];
  assert(!value.includes('<'));assert.strictEqual(JSON.parse(value).markdown,markdown);
  assert(html.includes('<title>Title $&amp; &lt;script&gt; | SmallDocs</title>'));
 });
 test('public shell stores only supplied public source and independent current navigation',()=>{
  const a=renderPublicationShell({source,substitutions:{'__DOCUMENT_CLOUD_AUTHENTICATED__':'true'}});
  const b=renderPublicationShell({source});
  const payload=html=>JSON.parse(/<script id="sdocs-publication-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.deepStrictEqual(payload(a),payload(b));assert(!b.includes('data-cloud-authenticated="true"'));
 });
 test('legacy public sources are recovered from their saved public HTML without a Cloud read',()=>{
  const legacy='<html><head><title>Legacy | SmallDocs</title><meta name="description" content="A &amp; B"></head><body><article id="_sd_rendered"><pre><code class="language-slide">grid 16 9</code></pre></article></body></html>';
  const row={slug:'legacy-id',rendered_html:legacy};
  const recovered=publicationSource(row,'https://example.test');
  assert.strictEqual(recovered.title,'Legacy');assert.strictEqual(recovered.description,'A & B');
  assert.strictEqual(recovered.legacyHtml,legacy);assert(documentRoot(row).includes('grid 16 9'));
  assert(!documentRoot(row).includes('<html>'));
 });
};
