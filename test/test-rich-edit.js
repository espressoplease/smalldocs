'use strict';
const E=require('../cli/shared/sdocs-rich-edit');
const shapes=require('../public/sdocs-shapes');
const cells=require('../cli/shared/sdocs-cells');
module.exports=function({test,assert}){
 test('rich edit: flow node labels preserve the original identifiers and shape delimiters',()=>{
  for(const pair of [['[',']'],['{','}'],['(',')'],['((', '))'],['([','])'],['[[',']]'],['{{','}}'],['[/', '/]']]){
   const source='flowchart LR\nA'+pair[0]+'Draft'+pair[1]+'-->B[Review]\n';
   const updated=E.setMermaidText(source,'node:A','Ready');
   assert.strictEqual(updated,'flowchart LR\nA'+pair[0]+'"Ready"'+pair[1]+'-->B[Review]\n');
  }
 });
 test('rich edit: quoted labels may contain closing punctuation and repeated text',()=>{
  const source='flowchart LR\nA["Review ] quote"] --> B["Review ] quote"]\n';
  assert.strictEqual(E.setMermaidText(source,'node:B','Second'),'flowchart LR\nA["Review ] quote"] --> B["Second"]\n');
 });
 test('rich edit: implicit node matching skips labels and similar hyphenated identifiers',()=>{
  const source='flowchart LR\nOther-A --> B["A is mentioned here"] --> A\n';
  assert.strictEqual(E.setMermaidText(source,'node:A','Start'),'flowchart LR\nOther-A --> B["A is mentioned here"] --> A["Start"]\n');
 });
 test('rich edit: blank and Unicode diagram labels can be edited again',()=>{
  const source='flowchart LR\n開始[Draft] --> B[Review]\n';
  const blank=E.setMermaidText(source,'node:開始','');assert.strictEqual(E.mermaidFields(blank)[0].text,'');
  assert.strictEqual(E.setMermaidText(blank,'node:開始','準備完了'),'flowchart LR\n開始["準備完了"] --> B[Review]\n');
 });
 test('rich edit: numeric node identifiers retain their existing shape and label',()=>{
  const source='flowchart LR\n123[Draft] --> 456{Review}\n';assert.strictEqual(E.setMermaidText(source,'node:456','Ready'),'flowchart LR\n123[Draft] --> 456{"Ready"}\n');
 });
 test('rich edit: unsupported object syntax does not become an implicit label edit',()=>{
  const source='flowchart LR\nA@{ shape: rect, label: "Draft" } --> B\n';assert.strictEqual(E.mermaidField(source,'node:A'),null);assert.throws(()=>E.setMermaidText(source,'node:A','Changed'),/no longer at this target/);
 });
 test('rich edit: label injection is encoded inside the selected label',()=>{
  const updated=E.setMermaidText('flowchart LR\nA[Draft]-->B[Review]\n','node:B','"]\nC[New] %% <script>');
  assert.strictEqual(E.mermaidFields(updated).length,2);assert.ok(updated.includes('#93;'));assert.ok(!updated.includes('<script>'));assert.ok(!updated.includes('\nC['));
 });
 test('rich edit: style and comment declarations are not interpreted as labels',()=>{
  const source='flowchart LR\n%% Fake[No]\nA[Yes]-->B[Ready]\nstyle A fill:#fff\nclassDef c fill:#eee\n';
  assert.deepStrictEqual(E.mermaidFields(source).map(f=>f.key),['node:A','node:B']);
 });
 test('rich edit: sequence actors keep IDs while their aliases and messages change',()=>{
  const source='sequenceDiagram\nparticipant A as Alice\nparticipant B as Bob\nA->>B: Request\nB-->>A: Request\n';
  let updated=E.setMermaidText(source,'actor:A','Alice Smith');updated=E.setMermaidText(updated,'message:1','Reply');
  assert.strictEqual(updated,'sequenceDiagram\nparticipant A as Alice Smith\nparticipant B as Bob\nA->>B: Request\nB-->>A: Reply\n');
 });
 test('rich edit: implicit sequence participants gain an alias without changing message endpoints',()=>{
  const source='sequenceDiagram\nA->>B: Request\n';const updated=E.setMermaidText(source,'actor:A','Alice');
  assert.strictEqual(updated,'sequenceDiagram\nparticipant A as Alice\nA->>B: Request\n');
 });
 test('rich edit: no-op labels and slide fields retain exact original source',()=>{
  const diagram='flowchart LR\nA[Draft]\n';assert.strictEqual(E.setMermaidText(diagram,'node:A','Draft'),diagram);
  const slide='grid 100 56.25\nr 5 5 90 10 | Title\n';assert.strictEqual(E.setSlideText(slide,E.slideFields(slide,shapes)[0],'Title'),slide);
 });
 test('rich edit: text resembling slide DSL remains inside the existing shape',()=>{
  const source='grid 100 56.25 bg=#ffffff\n// Keep the comment\nr 5 5 90 10 #title | Title\nr 5 25 90 20 | Other\n';
  const field=E.slideFields(source,shapes)[0],updated=E.setSlideText(source,field,'New title\nr 0 0 100 100 | Content, not geometry');
  const parsed=shapes.parse(updated);assert.deepStrictEqual(parsed.errors,[]);assert.strictEqual(parsed.shapes.length,2);assert.strictEqual(parsed.shapes[0].x,5);assert.strictEqual(parsed.shapes[0].content,'New title\nr 0 0 100 100 | Content, not geometry');assert.ok(updated.includes('// Keep the comment'));assert.ok(updated.includes('r 5 25 90 20 | Other'));
 });
 test('rich edit: literal backslash-n and multi-paragraph text keep their meaning',()=>{
  const source='grid 100 56.25\nr 5 5 90 40 | Old\n';const text='A literal \\n remains.\n\nSecond paragraph.';
  const updated=E.setSlideText(source,E.slideFields(source,shapes)[0],text);assert.strictEqual(shapes.parse(updated).shapes[0].content,text);
 });
 test('rich edit: editing a slide slot preserves the template and other slots',()=>{
  const source='@extends cover\n#title: Original\n#body: |\n  First paragraph.\n\n  Second paragraph.\n';
  const fields=E.slideFields(source,shapes),updated=E.setSlideText(source,fields[0],'New title');
  assert.strictEqual(updated,'@extends cover\n#title: |\n  New title\n#body: |\n  First paragraph.\n\n  Second paragraph.\n');assert.strictEqual(fields[1].text,'First paragraph.\n\nSecond paragraph.');
 });
 test('rich edit: cells preserve format directives, formulas, commas, quotes and newlines',()=>{
  const source='sdoc-cells: name="Budget"\nformat: B=plain\nName,Amount\nHosting,100\nTotal,=B2\n',model=cells.parseCells(source);
  model.cells[1][0].raw='A, "quoted"\nvalue';model.cells[1][1].raw='175';const updated=E.cellsSource(source,model,cells),parsed=cells.parseCells(updated);
  assert.ok(updated.startsWith('sdoc-cells: name="Budget"\nformat: B=plain\n'));assert.strictEqual(parsed.cells[1][0].raw,'A, "quoted"\nvalue');assert.strictEqual(parsed.cells[2][1].raw,'=B2');assert.strictEqual(parsed.cells[1][1].raw,'175');
 });
};
