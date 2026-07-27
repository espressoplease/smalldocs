/**
 * Generic embed source protocol tests.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n-- Embed source tests -------------------------\n');

  function fixture() {
    const sent = [];
    const listeners = {};
    const parent = { postMessage: message => sent.push(message) };
    const documentListeners = {};
    const document = {
      addEventListener: (type, fn) => { documentListeners[type] = fn; },
      removeEventListener: type => { delete documentListeners[type]; },
      dispatchEvent: () => {},
      querySelectorAll: () => [],
    };
    const SDocs = {
      currentBody: '',
      currentMeta: {},
      Sources: null,
      loadText(content, file) {
        this.currentBody = content;
        this.currentMeta = { file };
      },
      setMode() {},
      setStatus() {},
      renderFileInfoCard() {},
      serializeCurrentDocument() { return this.currentBody; },
    };
    const window = {
      parent,
      SDocs,
      addEventListener: (type, fn) => { listeners[type] = fn; },
      removeEventListener: type => { delete listeners[type]; },
      SDocForms: { collectAll: () => ({ ok: true, forms: [] }) },
    };
    window.window = window;
    const context = vm.createContext({
      window,
      document,
      URLSearchParams,
      CustomEvent: function CustomEvent(type, options) {
        this.type = type;
        this.detail = options && options.detail;
      },
      setTimeout,
      clearTimeout,
      console,
    });
    const registry = fs.readFileSync(path.join(__dirname, '..', 'public', 'sdocs-source.js'), 'utf8');
    vm.runInContext(registry, context);
    SDocs.Sources = window.SDocs.Sources;
    const sourceCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'sdocs-embed-source.js'), 'utf8');
    vm.runInContext(sourceCode, context);
    return { window, parent, SDocs, sent, listeners };
  }

  test('embed source only matches a valid channel', () => {
    const f = fixture();
    assert.strictEqual(f.SDocs.Sources.select({ hash: '#embed=1&channel=short' }), null);
    const source = f.SDocs.Sources.select({ hash: '#embed=1&channel=abcdefghijklmnop' });
    assert.strictEqual(source.name, 'embed');
  });

  test('embed source validates host messages and emits versioned changes', () => {
    const f = fixture();
    const channel = 'abcdefghijklmnop';
    const source = f.SDocs.Sources.select({ hash: '#embed=1&channel=' + channel });
    source.load();
    assert.strictEqual(f.sent[0].type, 'ready');
    assert.strictEqual(f.sent[0].version, 1);

    f.listeners.message({
      source: {},
      data: { scope: 'sdocs-embed', version: 1, channel, type: 'init', payload: { content: 'wrong' } },
    });
    assert.strictEqual(source._initialized, false);

    f.listeners.message({
      source: f.parent,
      data: {
        scope: 'sdocs-embed',
        version: 1,
        channel,
        type: 'init',
        payload: {
          content: '# Report',
          file: 'report.md',
          capabilities: { canSave: true, canWatch: true, canSubmit: true },
          message: 'Review this report',
          submitLabel: 'Send review',
        },
      },
    });
    assert.strictEqual(source._initialized, true);
    assert.strictEqual(f.SDocs.currentBody, '# Report');
    assert.strictEqual(source.submitLabel, 'Send review');

    source.save('# Updated');
    const dirty = f.sent[f.sent.length - 1];
    assert.strictEqual(dirty.type, 'dirty-state');
    assert.strictEqual(dirty.payload.dirty, true);
    const sequence = source._sendQueuedSave();
    const changed = f.sent[f.sent.length - 1];
    assert.strictEqual(changed.type, 'document-changed');
    assert.strictEqual(changed.payload.sequence, sequence);
    assert.strictEqual(changed.payload.content, '# Updated');

    f.listeners.message({
      source: f.parent,
      data: {
        scope: 'sdocs-embed',
        version: 1,
        channel,
        type: 'save-result',
        payload: { sequence, content: '# Updated' },
      },
    });
    const clean = f.sent[f.sent.length - 1];
    assert.strictEqual(clean.type, 'dirty-state');
    assert.strictEqual(clean.payload.dirty, false);

    source.submit();
    const submitted = f.sent[f.sent.length - 1];
    assert.strictEqual(submitted.type, 'submit-review');
    assert.strictEqual(submitted.payload.sequence, sequence);
  });
};
