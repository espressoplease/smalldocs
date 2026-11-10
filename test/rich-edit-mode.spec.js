const {test,expect}=require('@playwright/test');
test.beforeEach(async({page})=>{page.__richErrors=[];page.on('pageerror',error=>page.__richErrors.push(error.message));});
test.afterEach(async({page})=>{expect(page.__richErrors).toEqual([]);});
const BASE=process.env.SDOCS_TEST_BASE_URL||'http://localhost:3000';
const source=require('fs').readFileSync(require('path').join(__dirname,'fixtures/rich-edit-mode.md'),'utf8');
async function textInto(locator,text){await locator.click();await locator.press('ControlOrMeta+a');await locator.press('Backspace');if(text)await locator.pressSequentially(text);}
async function clickSvgText(page,locator){
 // WebKit's automation content quad for SVG text omits its x/y offset.
 // Exercise a real pointer click at the browser's actual text rectangle.
 await locator.scrollIntoViewIfNeeded();const point=await locator.evaluate(node=>{const r=node.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});await page.mouse.click(point.x,point.y);
}
async function load(page,md=source){await page.goto(BASE+'/docs');await page.waitForFunction(()=>SDocs._appReady);await page.evaluate(md=>{SDocs._isDefaultState=false;SDocs.loadText(md);SDocs.setAllSectionsOpen(true);SDocs.setMode('write');},md);await page.evaluate(()=>SDocs.richWrite.ready);}
async function read(page){await page.locator('#_sd_btn-read').click();}
function cell(page,sheet,r,c){return page.locator('#_sd_write .sdoc-cells').nth(sheet).locator(`.sdoc-cells-cell[data-r="${r}"][data-c="${c}"]`);}

test('rich objects remain rendered, and a no-op edit session keeps the complete Markdown',async({page})=>{
 await load(page);await expect(page.locator('#_sd_write .sdoc-cells-grid')).toHaveCount(2);await expect(page.locator('#_sd_write .sdoc-slide')).toHaveCount(1);await expect(page.locator('#_sd_write .sdoc-mermaid svg')).toHaveCount(2);
 await read(page);expect(await page.evaluate(()=>SDocs.currentBody)).toBe(source);
});
test('inline cell editing saves the value, recalculates both sheets and retains formulas and formats',async({page})=>{
 await load(page);await cell(page,0,1,1).dblclick();await page.locator('.sdoc-cells-editor').fill('150');await page.locator('.sdoc-cells-editor').press('Enter');
 await expect(cell(page,0,3,1)).toHaveText('350');await expect(cell(page,1,1,1)).toHaveText('350');await read(page);
 const md=await page.evaluate(()=>SDocs.currentBody);expect(md).toContain('Hosting,150');expect(md).toContain('format: B=plain');expect(md).toContain('=SUM(B2:B3)');expect(md).toContain('=Costs!B4');expect(md).toContain('7. Keep this item.');
});
test('cell Escape cancels and leaving edit mode commits a still-open cell editor',async({page})=>{
 await load(page);await cell(page,0,1,1).dblclick();await page.locator('.sdoc-cells-editor').fill('999');await page.locator('.sdoc-cells-editor').press('Escape');await expect(cell(page,0,1,1)).toHaveText('100');
 await cell(page,0,1,1).dblclick();await page.locator('.sdoc-cells-editor').fill('175');await page.evaluate(()=>SDocs.setMode('read'));expect(await page.evaluate(()=>SDocs.currentBody)).toContain('Hosting,175');
});
test('slide text is editable in its rendered box without changing geometry or adjacent text',async({page})=>{
 await load(page);const text=page.locator('#_sd_write .sdoc-slide [data-shape-idx="0"] .inner');await text.click();await text.press('ControlOrMeta+a');await text.press('Backspace');await text.pressSequentially('Ready for launch');await read(page);
 const md=await page.evaluate(()=>SDocs.currentBody);expect(md).toContain('r 5 5 90 12 text=title |');expect(md).toContain('Ready for launch');expect(md).toContain('r 55 23 40 20 fill=#eef6ef | ## Review');
 await expect(page.locator('#_sd_rendered .sdoc-slide').getByText('Ready for launch')).toBeVisible();
});
test('editing two different slide boxes preserves both edits',async({page})=>{
 await load(page);const slide=page.locator('#_sd_write .sdoc-slide');await textInto(slide.locator('[data-shape-idx="0"] .inner'),'New title');await textInto(slide.locator('[data-shape-idx="2"] .inner'),'New reviewer');await read(page);
 const md=await page.evaluate(()=>SDocs.currentBody);expect(md).toContain('New title');expect(md).toContain('New reviewer');expect(md).toContain('Keep the **allocation** intact.');
});
test('flowchart labels edit independently while preserving node IDs, shapes and edges',async({page})=>{
 await load(page);await page.getByRole('button',{name:'Edit diagram text: Review',exact:true}).click();await page.getByRole('textbox',{name:'Diagram text',exact:true}).fill('Approval');await page.getByRole('textbox',{name:'Diagram text',exact:true}).press('Enter');
 await expect(page.locator('#_sd_write .sdoc-mermaid').first()).toContainText('Approval');await read(page);expect(await page.evaluate(()=>SDocs.currentBody)).toContain('A[Draft] --> B{"Approval"}');
});
test('sequence participants and messages can change without changing their identifiers or arrow',async({page})=>{
 await load(page);await page.getByRole('button',{name:'Edit diagram text: Alice',exact:true}).first().click();await page.getByRole('textbox',{name:'Diagram text',exact:true}).fill('Alice Smith');await page.getByRole('textbox',{name:'Diagram text',exact:true}).press('Enter');
 await clickSvgText(page,page.getByRole('button',{name:'Edit diagram text: Submit request',exact:true}));await page.getByRole('textbox',{name:'Diagram text',exact:true}).fill('Send the request');await read(page);
 const md=await page.evaluate(()=>SDocs.currentBody);expect(md).toContain('participant A as Alice Smith');expect(md).toContain('A->>B: Send the request');expect(md).toContain('B-->>A: Confirm date');
});
test('diagram Escape cancels and a second identical diagram has its own editable source',async({page})=>{
 const md='```mermaid\nflowchart LR\nA[Draft] --> B[Review]\n```\n\n```mermaid\nflowchart LR\nA[Draft] --> B[Review]\n```\n';await load(page,md);
 await page.getByRole('button',{name:'Edit diagram text: Review',exact:true}).nth(1).click();await page.getByRole('textbox',{name:'Diagram text',exact:true}).fill('Cancelled');await page.getByRole('textbox',{name:'Diagram text',exact:true}).press('Escape');
 await page.getByRole('button',{name:'Edit diagram text: Review',exact:true}).nth(1).click();await page.getByRole('textbox',{name:'Diagram text',exact:true}).fill('Approved');await read(page);
 expect(await page.evaluate(()=>SDocs.currentBody)).toBe(md.replace(/B\[Review\](?![\s\S]*B\[Review\])/, 'B["Approved"]'));
});

test('document undo and redo restore a rich edit without serializing its rendered HTML',async({page})=>{
 await load(page);await page.getByRole('button',{name:'Edit diagram text: Review',exact:true}).click();await page.getByRole('textbox',{name:'Diagram text',exact:true}).fill('Approved');await page.getByRole('textbox',{name:'Diagram text',exact:true}).press('Enter');
 await page.locator('#_sd_write').focus();await page.keyboard.press('ControlOrMeta+z');await page.evaluate(()=>SDocs.richWrite.ready);
 await expect(page.locator('#_sd_write .sdoc-mermaid').first()).toContainText('Review');await page.keyboard.press('ControlOrMeta+Shift+z');await page.evaluate(()=>SDocs.richWrite.ready);await read(page);expect(await page.evaluate(()=>SDocs.currentBody)).toContain('B{"Approved"}');
});
test('slide Escape restores its text without reverting an earlier edit in another box',async({page})=>{
 await load(page);const slide=page.locator('#_sd_write .sdoc-slide');await textInto(slide.locator('[data-shape-idx="0"] .inner'),'Saved title');const body=slide.locator('[data-shape-idx="2"] .inner');await textInto(body,'Discard this');await body.press('Escape');await read(page);
 const md=await page.evaluate(()=>SDocs.currentBody);expect(md).toContain('Saved title');expect(md).toContain('Confirm the reviewer.');expect(md).not.toContain('Discard this');
});
test('slide-template instances edit their own slot and keep the shared template',async({page})=>{
 const md='~~~slide\n@template hero\ngrid 100 56.25\nr 5 5 90 40 #title | Default title\n~~~\n\n~~~slide\n@extends hero\n#title: First\n~~~\n\n~~~slide\n@extends hero\n#title: Second\n~~~\n';await load(page,md);
 await textInto(page.locator('#_sd_write .sdoc-slide').first().locator('.inner'),'Changed first');await read(page);
 const body=await page.evaluate(()=>SDocs.currentBody);expect(body).toContain('r 5 5 90 40 #title | Default title');expect(body).toContain('#title: |\n  Changed first');expect(body).toContain('#title: Second');await expect(page.locator('#_sd_rendered .sdoc-slide').last()).toContainText('Second');
});
test('fullscreen spreadsheet edits persist into the same document',async({page})=>{
 await load(page);await page.locator('#_sd_write .sdoc-cells').first().getByRole('button',{name:'Open fullscreen',exact:true}).click();
 const modal=page.locator('.sdoc-cells-focus');await expect(modal).toBeVisible();await modal.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').dblclick();await page.locator('.sdoc-cells-editor').fill('180');await page.locator('.sdoc-cells-editor').press('Enter');await page.keyboard.press('Escape');await read(page);expect(await page.evaluate(()=>SDocs.currentBody)).toContain('Hosting,180');
});
test('diagram punctuation cannot add nodes, edges or executable markup',async({page})=>{
 await load(page);const value='Approval "] --> Inject[bad] <img onerror=alert(1)> & quotes "';await page.getByRole('button',{name:'Edit diagram text: Review',exact:true}).click();await page.getByRole('textbox',{name:'Diagram text',exact:true}).fill(value);await page.getByRole('textbox',{name:'Diagram text',exact:true}).press('Enter');
 await expect(page.locator('#_sd_write .sdoc-mermaid').first().locator('g.node')).toHaveCount(2);await expect(page.locator('#_sd_write .sdoc-mermaid').first().locator('img')).toHaveCount(0);await read(page);await expect(page.locator('#_sd_rendered .sdoc-mermaid').first().locator('g.node')).toHaveCount(2);
});
test('rich edits in a nested list preserve the list and surrounding prose',async({page})=>{
 const md='4. First item\n\n   ```mermaid\n   flowchart LR\n   A[Draft] --> B[Review]\n   ```\n\n5. Last item\n';await load(page,md);await page.getByRole('button',{name:'Edit diagram text: Review',exact:true}).click();await page.getByRole('textbox',{name:'Diagram text',exact:true}).fill('Ready');await read(page);
 await expect(page.locator('#_sd_rendered ol')).toHaveAttribute('start','4');await expect(page.locator('#_sd_rendered ol > li')).toHaveCount(2);await expect(page.locator('#_sd_rendered ol > li:first-child .sdoc-mermaid-stage > svg')).toBeVisible();await expect(page.locator('#_sd_rendered ol > li:last-child')).toContainText('Last item');
});

test('implicit flowchart node labels gain text without renaming endpoints',async({page})=>{
 await load(page,'```mermaid\nflowchart LR\nA-->B[Review]\n```\n');await page.getByRole('button',{name:'Edit diagram text: A',exact:true}).click();await page.getByRole('textbox',{name:'Diagram text',exact:true}).fill('Initial request');await read(page);expect(await page.evaluate(()=>SDocs.currentBody)).toContain('A["Initial request"]-->B[Review]');
});
test('an inherited default slide text can be overridden for one instance',async({page})=>{
 const md='~~~slide\n@template hero\ngrid 100 56.25\nr 5 5 90 15 #title | Default title\nr 5 25 90 15 #body | Default body\n~~~\n\n~~~slide\n@extends hero\n#title: Instance title\n~~~\n';await load(page,md);await textInto(page.locator('#_sd_write .sdoc-slide [data-shape-idx="1"] .inner'),'Instance body');await read(page);const body=await page.evaluate(()=>SDocs.currentBody);expect(body).toContain('r 5 25 90 15 #body | Default body');expect(body).toContain('#body: |\n  Instance body');
});
test('slide text keeps bold and heading formatting while editing a word',async({page})=>{
 await load(page);await page.locator('#_sd_write .sdoc-slide [data-shape-idx="1"] .inner strong').dblclick();await page.keyboard.insertText('budget');await read(page);const md=await page.evaluate(()=>SDocs.currentBody);expect(md).toContain('## Budget');expect(md).toContain('Keep the **budget** intact.');
});
test('pasting into slide text inserts literal text once',async({page})=>{
 await load(page);const inner=page.locator('#_sd_write .sdoc-slide [data-shape-idx="0"] .inner');await textInto(inner,'');await inner.evaluate(el=>{el.focus();const event=new ClipboardEvent('paste',{bubbles:true,composed:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{getData:()=> 'Literal <b>text</b>'}});el.dispatchEvent(event);});await read(page);const md=await page.evaluate(()=>SDocs.currentBody);expect(md.match(/Literal/g)).toHaveLength(1);await expect(page.locator('#_sd_rendered .sdoc-slide').getByText('Literal <b>text</b>',{exact:true})).toBeVisible();
});
test('a quoted cell value round-trips through CSV without changing its neighbours',async({page})=>{
 await load(page);await cell(page,0,1,0).dblclick();await page.locator('.sdoc-cells-editor').fill('Hosting, "Europe"');await page.locator('.sdoc-cells-editor').press('Tab');await read(page);const md=await page.evaluate(()=>SDocs.currentBody);expect(md).toContain('"Hosting, ""Europe""",100');expect(md).toContain('Research,200');
});
test('switching documents discards stale rendered editing callbacks',async({page})=>{
 await load(page);await page.getByRole('button',{name:'Edit diagram text: Review',exact:true}).click();await page.getByRole('textbox',{name:'Diagram text',exact:true}).fill('Old draft');await page.evaluate(()=>SDocs.loadText('# New document\n\nKeep this clean.\n'));await page.waitForTimeout(600);await read(page);expect(await page.evaluate(()=>SDocs.currentBody)).toBe('# New document\n\nKeep this clean.\n');await expect(page.locator('.sdoc-write-label-editor')).toHaveCount(0);
});
test('mobile rich editing keeps cell inputs readable and saves label changes',async({page})=>{
 await page.setViewportSize({width:390,height:844});await load(page);await cell(page,0,1,1).dblclick();await expect(page.locator('.sdoc-cells-editor')).toHaveCSS('font-size','16px');await page.locator('.sdoc-cells-editor').fill('190');await page.locator('.sdoc-cells-editor').press('Enter');await page.getByRole('button',{name:'Edit diagram text: Review',exact:true}).click();await page.getByRole('textbox',{name:'Diagram text',exact:true}).fill('Ready');await read(page);const md=await page.evaluate(()=>SDocs.currentBody);expect(md).toContain('Hosting,190');expect(md).toContain('B{"Ready"}');
});

test('theme changes keep rendered labels editable and do not replace pending text',async({page})=>{
 await load(page);await page.evaluate(()=>SDocs.switchThemeAndUpdate('dark'));await page.getByRole('button',{name:'Edit diagram text: Review',exact:true}).click();const input=page.getByRole('textbox',{name:'Diagram text',exact:true});await input.fill('Dark review');await page.evaluate(()=>SDocs.switchThemeAndUpdate('light'));await expect(input).toHaveValue('Dark review');await input.press('Enter');await expect(page.getByRole('button',{name:'Edit diagram text: Dark review',exact:true})).toBeVisible();await read(page);expect(await page.evaluate(()=>SDocs.currentBody)).toContain('Dark review');
});
test('rich source fences remain intact through repeated edits',async({page})=>{
 await load(page);for(let i=0;i<3;i++){await page.getByRole('button',{name:'Edit diagram text: '+(i?'Review '+(i-1):'Review'),exact:true}).click();await page.getByRole('textbox',{name:'Diagram text',exact:true}).fill('Review '+i);await read(page);await page.locator('#_sd_btn-write').click();await page.evaluate(()=>SDocs.richWrite.ready);}
 await read(page);const body=await page.evaluate(()=>SDocs.currentBody);expect(body).toContain('Review 2');expect(body).toContain('~~~slide\ngrid 100 56.25 bg=#ffffff');expect(body).toContain('format: B=plain');expect(body).toContain('A->>B: Submit request');
});

test('empty slide text remains editable after returning to the document',async({page})=>{
 await load(page);await textInto(page.locator('#_sd_write .sdoc-slide [data-shape-idx="0"] .inner'),'');await read(page);await page.locator('#_sd_btn-write').click();await page.evaluate(()=>SDocs.richWrite.ready);await textInto(page.locator('#_sd_write .sdoc-slide [data-shape-idx="0"] .inner'),'Restored title');await read(page);expect(await page.evaluate(()=>SDocs.currentBody)).toContain('Restored title');
});
test('a diagram label can be cleared and filled again without a parse error',async({page})=>{
 await load(page);await page.getByRole('button',{name:'Edit diagram text: Review',exact:true}).click();await page.getByRole('textbox',{name:'Diagram text',exact:true}).fill('');await page.getByRole('textbox',{name:'Diagram text',exact:true}).press('Enter');await expect(page.locator('#_sd_write .sdoc-mermaid').first().locator('g.node')).toHaveCount(2);await expect(page.locator('#_sd_write .sdoc-mermaid-error')).toHaveCount(0);await page.getByRole('button',{name:'Edit diagram text: B',exact:true}).click();await page.getByRole('textbox',{name:'Diagram text',exact:true}).fill('Restored review');await read(page);expect(await page.evaluate(()=>SDocs.currentBody)).toContain('Restored review');
});
test('composition keys do not cancel slide typing or commit a diagram or cell draft',async({page})=>{
 await load(page);await cell(page,0,1,1).dblclick();const cellInput=page.locator('.sdoc-cells-editor');await cellInput.fill('185');for(const key of ['Escape','Enter']){await cellInput.dispatchEvent('keydown',{key,isComposing:true});await expect(cellInput).toBeFocused();}await cellInput.press('Enter');
 const slide=page.locator('#_sd_write .sdoc-slide [data-shape-idx="0"] .inner');await textInto(slide,'Composition title');await slide.dispatchEvent('keydown',{key:'Escape',isComposing:true});await expect(slide).toBeFocused();await expect(slide).toHaveText('Composition title');
 await page.getByRole('button',{name:'Edit diagram text: Review',exact:true}).click();const input=page.getByRole('textbox',{name:'Diagram text',exact:true});await input.fill('Composition review');for(const key of ['Escape','Enter']){await input.dispatchEvent('keydown',{key,isComposing:true});await expect(input).toBeFocused();}await input.press('Enter');await read(page);const body=await page.evaluate(()=>SDocs.currentBody);expect(body).toContain('Hosting,185');expect(body).toContain('Composition title');expect(body).toContain('Composition review');
});
test('leaving the formula bar commits to its original cell and retains the newly selected cell',async({page})=>{
 await load(page);await page.locator('#_sd_write .sdoc-cells').first().getByRole('button',{name:'Open fullscreen',exact:true}).click();const modal=page.locator('.sdoc-cells-focus');await modal.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').click();const bar=modal.getByRole('textbox',{name:'Cell value / formula',exact:true});await bar.fill('210');await modal.locator('.sdoc-cells-cell[data-r="2"][data-c="1"]').click();await expect(modal.locator('.sdoc-cells-focus-name')).toHaveText('B3');await expect(modal.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveText('210');await expect(modal.locator('.sdoc-cells-cell[data-r="2"][data-c="1"]')).toHaveText('200');await page.keyboard.press('Escape');await read(page);expect(await page.evaluate(()=>SDocs.currentBody)).toContain('Hosting,210');expect(await page.evaluate(()=>SDocs.currentBody)).toContain('Research,200');
});
test('numeric Mermaid identifiers edit their labels without changing the graph',async({page})=>{
 await load(page,'```mermaid\nflowchart LR\n123[Draft] --> 456{Review}\n```\n');await page.getByRole('button',{name:'Edit diagram text: Review',exact:true}).click();await page.getByRole('textbox',{name:'Diagram text',exact:true}).fill('Ready');await read(page);expect(await page.evaluate(()=>SDocs.currentBody)).toContain('123[Draft] --> 456{"Ready"}');await expect(page.locator('#_sd_rendered .sdoc-mermaid svg g.node')).toHaveCount(2);
});
