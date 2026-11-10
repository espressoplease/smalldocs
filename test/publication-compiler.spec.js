const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { startFixture } = require('./cloud-onboarding-fixture');
const { createCompiler } = require('../lib/publication-compiler');
const { renderPublicationShell } = require('../lib/publication-shell');

test.setTimeout(60000);
let fixture, compiler;
test.beforeEach(async () => {
  fixture = await startFixture({ singlePlan: true });
  compiler = createCompiler({ origin: fixture.origin, browserType: chromium, rendererVersion: 'compiler-test-release',
    shell: source => renderPublicationShell({ source, compile: true }) });
});
test.afterEach(async () => { if (compiler) await compiler.close(); if (fixture) await fixture.close(); });

function snapshot(markdown) {
  return { markdown, title: 'Published document', description: 'Public article.', url: fixture.origin + '/p/public-test' };
}

test('compiler captures the normal reader with expanded sections and validated root styles, without application chrome', async ({ browser }) => {
  const result = await compiler.compile(snapshot('---\nstyles:\n  color: "#123456"\n  baseFontSize: 19\n---\n# Public article\n\n## Detailed section\n\nA complete readable answer.\n'));
  expect(result.rendererVersion).toBe('compiler-test-release');
  expect(result.html).toMatch(/^<div[^>]*id="_sd_rendered"/);
  expect(result.html).toContain('--md-color: #123456');
  expect(result.html).toContain('--md-base-size: 19px');
  expect(result.html).not.toContain('data-sdocs-sidebar-shell');
  expect(result.html).not.toContain('sdocs-publication-data');
  expect(result.html).not.toContain('_sd_sdocs-file-info');
  expect(result.html).not.toContain('<script');
  const guest = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await guest.newPage(); await page.setContent(result.html);
    await expect(page.getByRole('heading', { name: 'Detailed section' })).toBeVisible();
    await expect(page.locator('.md-section-body')).toHaveClass(/open/);
    await expect(page.locator('#_sd_rendered')).toContainText('A complete readable answer.');
  } finally { await guest.close(); }
});

test('compiler preserves slide and sheet text, includes chart data, and does not execute apps or fetch publisher images', async ({ browser }) => {
  let externalRequests = 0;
  const external = http.createServer((req, res) => { externalRequests++; res.writeHead(200); res.end('private endpoint'); });
  await new Promise(resolve => external.listen(0, '127.0.0.1', resolve));
  const externalUrl = 'http://127.0.0.1:' + external.address().port + '/not-an-approved-renderer-asset';
  try {
    const slide = fs.readFileSync(path.join(__dirname, 'fixtures/publication-slide.md'), 'utf8');
    const markdown = '# Rich article\n\n' + slide + '\n\n$$x^2+y^2$$\n\n```cells\nItem,Cost\nBooks,12\n```\n\n```chart\n{"type":"bar","title":"Reading budget","labels":["Books"],"values":[12]}\n```\n\n```mermaid\nflowchart LR\n A[Compiler client] --> B[Public reader]\n```\n\n![A readable image description](' + externalUrl + ')\n\n![Public image](https://publisher.example/image.png)\n\n```sdoc-app\n<!doctype html><html><body><script>fetch("' + externalUrl + '")</script></body></html>\n```\n\n<img src=x onerror="window.attack=true">';
    const result = await compiler.compile(snapshot(markdown));
    expect(externalRequests).toBe(0);
    expect(result.html).toContain('Email encryption protects different parts of a message');
    expect(result.html).toContain('sdoc-slide');
    expect(result.styles.shape).toContain('.sd-slide-wrap');
    expect(result.styles.math).toBe(true);
    expect(result.html).toContain('sdoc-cells');
    expect(result.html).toContain('Reading budget');
    expect(result.html).toContain('<caption>Reading budget</caption>');
    expect(result.html).toContain('<td>Books</td>');
    expect(result.html).toContain('<td>12</td>');
    expect(result.html).toContain('data:image/png;base64,');
    expect(result.html).toContain('A readable image description');
    expect(result.html).toContain('src="https://publisher.example/image.png"');
    expect(result.html).not.toMatch(/<(?:script|iframe|object|embed)\b|\sonerror=/i);
    const guest = await browser.newContext({ javaScriptEnabled: false });
    try {
      const page = await guest.newPage(); await page.setContent(result.html);
      await expect(page.locator('.sdoc-slide')).toContainText('Device to provider');
      expect(await page.locator('.sdoc-slide').textContent()).toContain('Email encryption protects different parts of a message');
      await expect(page.locator('.sdoc-mermaid-stage > svg')).toContainText('Compiler client');
      await expect(page.getByRole('table')).toContainText('Books');
      const chartImage=page.getByRole('img',{name:'Reading budget',exact:true});
      await expect.poll(()=>chartImage.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
      const coloredFraction=await chartImage.evaluate(image=>{
        const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        const context=canvas.getContext('2d');context.drawImage(image,0,0);
        const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;let colored=0;
        for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>128&&Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2])>60)colored++;
        return colored/(canvas.width*canvas.height);
      });
      expect(coloredFraction).toBeGreaterThan(0.05);
    } finally { await guest.close(); }
  } finally { await new Promise(resolve => external.close(resolve)); }
});

test('compiler preserves truncated tail cells, formatted formulas and inactive workbook tabs without JavaScript', async ({ browser }) => {
  const cellApi = require('../public/sdocs-cells');
  const columns = Array.from({length:201},(_,i)=>i===200?'Tail column':'Column '+(i+1));
  const values = Array.from({length:201},(_,i)=>i===0?'1':i===1?'2':i===200?'=SUM(A2:B2)':'');
  const markdown='---\ncells-tabs: tabbed\n---\n# Workbook\n\n```cells Big/First\nformat: '+cellApi.colName(200)+'=$\n'+columns.join(',')+'\n'+values.join(',')+'\n```\n\n```cells Big/Second\nLabel\nInactive sheet content\n```';
  const result=await compiler.compile(snapshot(markdown));
  const guest=await browser.newContext({javaScriptEnabled:false});
  try {
    const page=await guest.newPage();await page.setContent(result.html);
    await expect(page.locator('.sdocs-publication-complete-sheet')).toContainText('Tail column');
    await expect(page.locator('.sdocs-publication-complete-sheet tr').last().locator('td').last()).toHaveText('$3.00');
    await expect(page.locator('.sdoc-cells').last()).toBeVisible();
    await expect(page.locator('.sdoc-cells').last()).toContainText('Inactive sheet content');
  } finally {await guest.close();}
});
