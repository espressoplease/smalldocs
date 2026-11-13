module.exports = function ({ test, assert }) {
  const interactions = require('../cli/shared/sdocs-interactions');
  const forms = require('../cli/shared/sdocs-form-block');
  const merge = require('../cli/shared/sdocs-merge').mergeTargetRevision;
  function document(language, source) { return '# Review\n\n```' + language + '\n' + source + '\n```\n\nKeep the footer.\n'; }
  const definition = { id:'review', fields:[{ name:'notes', type:'textarea', label:'Notes' }, { name:'budget', type:'number', label:'Budget' }],
    buttons:[{ name:'submit', label:'Submit' }], answers:{}, submissions:[] };
  function formDocument(answers, submissions) { return document('form', forms.serializeFormBlock({ ...definition, answers, submissions:submissions || [] })); }

  test('reader source edits preserve CRLF, surrounding content and named fences', () => {
    const source = 'Before\r\n\r\n~~~cells Costs\r\nA,B\r\nx,1\r\n~~~\r\n\r\nAfter';
    const next = interactions.replaceFence(source, 'cells', 0, 'A,B\nx,1\n', 'A,B\nx,2\n');
    assert.strictEqual(next, source.replace('x,1', 'x,2'));
    assert.strictEqual(interactions.replaceFence(next, 'cells', 0, 'old source', 'bad'), null);
  });
  test('reader source edits skip fenced examples and keep repeated components distinct', () => {
    const source = '````md\n```form\nexample\n```\n````\n\n' + document('sdoc-app', '<button>Same</button>') + document('sdoc-app', '<button>Same</button>');
    assert.strictEqual(interactions.fences(source, 'form').length, 0);
    const next = interactions.replaceFence(source, 'sdoc-app', 1, '<button>Same</button>', '<button>Changed</button>');
    assert.strictEqual(interactions.fences(next, 'sdoc-app')[0].content.trim(), '<button>Same</button>');
    assert.strictEqual(interactions.fences(next, 'sdoc-app')[1].content.trim(), '<button>Changed</button>');
  });
  test('reader source edits grow fences when saved data contains a closing fence', () => {
    const next = interactions.replaceFence(document('cells', 'A'), 'cells', 0, 'A', 'A\n```\nB');
    assert.ok(next.includes('````cells\nA\n```\nB\n````'));
    assert.ok(next.endsWith('Keep the footer.\n'));
  });
  test('app state is JSON, escapes script endings and retains the document doctype', () => {
    const source = '<!doctype html><html><head><title>Plan</title></head><body>Content</body></html>';
    const state = { text:'</script><script>bad()</script>', inputs:{hours:'8'}, items:[1, false] };
    const next = interactions.setAppState(source, state);
    assert.ok(next.startsWith('<!doctype html>'));
    assert.ok(next.includes('\\u003c/script>'));
    assert.deepStrictEqual(interactions.appState(next), state);
    assert.strictEqual(interactions.appDefinition(next), source);
  });
  test('form serialization preserves exact multiline answers with and without a trailing newline', () => {
    for (const notes of ['one\ntwo', 'one\ntwo\n']) {
      const text = forms.serializeFormBlock({ ...definition, answers:{notes} });
      assert.strictEqual(forms.parseFormBlock(text).value.answers.notes, notes);
    }
  });
  test('concurrent form answers merge independent fields without duplicate YAML sections', () => {
    const result = merge(formDocument({}), formDocument({notes:'First'}), formDocument({budget:73}));
    const parsed = forms.findFormBlocks(result.markdown)[0].parsed;
    assert.deepStrictEqual(parsed.answers, {notes:'First', budget:73});
    assert.strictEqual((result.markdown.match(/^answers:/gm) || []).length, 1);
    assert.ok(result.markdown.endsWith('Keep the footer.\n'));
  });
  test('concurrent submissions retain both records while the later save sets a shared answer', () => {
    const first = {by:'submit', at:'2026-11-13T12:00:00Z', scope:['notes'], values:{notes:'First'}};
    const second = {by:'submit', at:'2026-11-13T12:00:01Z', scope:['notes'], values:{notes:'Second'}};
    const result = merge(formDocument({}), formDocument({notes:'First'}, [first]), formDocument({notes:'Second'}, [second]));
    const parsed = forms.findFormBlocks(result.markdown)[0].parsed;
    assert.strictEqual(parsed.answers.notes, 'Second');
    assert.strictEqual(parsed.submissions.length, 2);
    assert.ok(result.conflicts.some(conflict => conflict.source === 'form:0.notes'));
  });
  test('app native inputs and custom state merge without duplicating scripts or losing agent prose', () => {
    const source = '<head><title>Planner</title></head><body><input id="hours"></body>';
    const base = document('sdoc-app', source);
    const current = document('sdoc-app', interactions.setAppState(source, {inputs:{hours:'8'}}));
    const proposed = document('sdoc-app', interactions.setAppState(source, {count:2})).replace('Keep the footer.', 'Agent updated the footer.');
    const result = merge(base, current, proposed);
    assert.deepStrictEqual(interactions.appState(interactions.fences(result.markdown, 'sdoc-app')[0].content), {inputs:{hours:'8'}, count:2});
    assert.strictEqual((result.markdown.match(/id="sdoc-state"/g) || []).length, 1);
    assert.ok(result.markdown.includes('Agent updated the footer.'));
  });
  test('state field names cannot mutate object prototypes during merges', () => {
    const state = interactions.mergeState({}, JSON.parse('{"__proto__":{"saved":true}}'), {count:1});
    assert.strictEqual(Object.getPrototypeOf(state), Object.prototype);
    assert.strictEqual({}.saved, undefined);
    assert.ok(Object.prototype.hasOwnProperty.call(state, '__proto__'));
  });
};
