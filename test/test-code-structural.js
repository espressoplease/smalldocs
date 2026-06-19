/**
 * code structural-keyword tests - the per-language definition files under
 * public/sdocs-code-lang/. These drive the collapsed-class outline in the code
 * focus view: a line matching a `structural` pattern survives the fold, a
 * comment or stray statement does not. The files are browser globals (they
 * attach to window / globalThis), so we eval them into a fake root here.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const LANG_DIR = path.join(__dirname, '..', 'public', 'sdocs-code-lang');

function loadDefs() {
  const root = {};
  const sandbox = { window: undefined, globalThis: root };
  for (const file of fs.readdirSync(LANG_DIR)) {
    if (!file.endsWith('.js')) continue;
    vm.runInNewContext(fs.readFileSync(path.join(LANG_DIR, file), 'utf8'), sandbox);
  }
  return root.SDocsCodeLang || {};
}

// Each case: a line that MUST survive the outline (keep) and one that MUST fold
// into the ellipsis (drop) for that language.
const CASES = {
  ruby: {
    keep: ['  def price_for(symbol)', '  private', '  attr_reader :cache', '  MAX = 100', '  has_many :orders'],
    drop: ['  # fetch a fresh quote', '    @cache[symbol] = quote', '  result = compute(x)']
  },
  python: {
    keep: ['    def fetch(self):', '    @property', 'import os', 'MAX_RETRIES = 3', '    async def run(self):'],
    drop: ['    # a comment', '        self.value = 1', '    total = a + b']
  },
  javascript: {
    keep: ['  function build() {', 'export const x = 1', '  static create() {', '  constructor(opts) {'],
    drop: ['  // a comment', '    this.count += 1', '    return value;']
  },
  typescript: {
    keep: ['  interface Quote {', '  private readonly owner: string', '  type Id = string', '  @Input()'],
    drop: ['  // a comment', '    this.value = 1', '    return q;']
  },
  go: {
    keep: ['func (c *Cache) Price() {', 'type Quote struct {', 'package main', '\tconst Max = 10'],
    drop: ['\t// a comment', '\tc.store[s] = q', '\treturn q']
  },
  rust: {
    keep: ['    pub fn spread(&self) -> f64 {', 'impl Quote {', '#[derive(Debug)]', '    pub trait Source {'],
    drop: ['    // a comment', '        self.store.insert(k, v);', '    let x = 1;']
  },
  java: {
    keep: ['    public void post() {', '    private final String owner;', '    @Override', '    public enum Status {'],
    drop: ['    // a comment', '        ledger.add(e);', '        long balance = 0;']
  },
  elixir: {
    keep: ['  def parse(map) do', '  defp format(q) do', '  @spec run(list) :: binary', '  defstruct [:bid]'],
    drop: ['  @doc "documentation"', '  @moduledoc """', '    raw |> Enum.map(&parse/1)']
  },
  csharp: {
    keep: ['    public void Post() {', '    [Serializable]', 'namespace Bank {', '    private int count;'],
    drop: ['    // a comment', '        ledger.Add(e);', '        var x = 1;']
  },
  php: {
    keep: ['    public function post() {', '    class Account {', 'namespace App;', '    private $owner;'],
    drop: ['    // a comment', '        $this->ledger[] = $e;', '        $x = 1;']
  }
};

function matchesAny(res, text) {
  return res.some((re) => re.test(text));
}

module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n── Code Structural-Keyword Tests ──────────────\n');

  const defs = loadDefs();

  test('every language file registers a non-empty structural RegExp array', () => {
    Object.keys(CASES).forEach((lang) => {
      const d = defs[lang];
      assert.ok(d, lang + ': definition file did not register on SDocsCodeLang');
      assert.ok(Array.isArray(d.structural) && d.structural.length > 0,
        lang + ': structural must be a non-empty array');
      // RegExp created inside the vm sandbox is a different realm's RegExp, so
      // instanceof would fail here - duck-type on .test instead.
      d.structural.forEach((re) => assert.ok(re && typeof re.test === 'function',
        lang + ': every structural entry must be a RegExp'));
    });
  });

  Object.keys(CASES).forEach((lang) => {
    test(lang + ': keyword lines survive, comments and statements fold', () => {
      const res = defs[lang].structural;
      CASES[lang].keep.forEach((line) => assert.ok(matchesAny(res, line),
        lang + ': expected to KEEP "' + line + '"'));
      CASES[lang].drop.forEach((line) => assert.ok(!matchesAny(res, line),
        lang + ': expected to DROP "' + line + '"'));
    });
  });
};
