const SidebarData = require('../public/sdocs-sidebar-data');

module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\nSidebar Data Tests\n');

  test('sidebar data normalises tags without changing their display spelling', () => {
    assert.deepStrictEqual(SidebarData.normaliseTags(['Design', ' design ', '', 'Product']),
      ['Design', 'Product']);
  });

  test('sidebar data groups documents by exact shared tag sets', () => {
    const entries = [
      { id: 'current', tags: ['design', 'product'], mtime: '2026-08-28T12:00:00Z' },
      { id: 'both', tags: ['design', 'product'], mtime: '2026-08-27T12:00:00Z' },
      { id: 'design', tags: ['design'], mtime: '2026-08-26T12:00:00Z' },
      { id: 'none', tags: ['research'], mtime: '2026-08-29T12:00:00Z' },
    ];
    const groups = SidebarData.relatedGroups(['design', 'product'], entries, { id: 'current' });
    assert.deepStrictEqual(groups.map((group) => group.tags), [
      ['design', 'product'],
      ['design'],
    ]);
    assert.deepStrictEqual(groups.map((group) => group.entries.map((entry) => entry.id)), [
      ['both'],
      ['design'],
    ]);
    assert.strictEqual(SidebarData.sharedDocumentCount(groups), 2);
    assert.strictEqual(SidebarData.sharedTagCount(groups), 2);
  });

  test('sidebar data excludes the current local document by path', () => {
    const entries = [
      { id: 'one', path: '/notes/current.md', mtime: '2026-08-28T12:00:00Z' },
      { id: 'two', path: '/notes/other.md', mtime: '2026-08-27T12:00:00Z' },
    ];
    assert.deepStrictEqual(
      SidebarData.recentEntries(entries, { path: '/notes/current.md' }, 10).map((entry) => entry.id),
      ['two']
    );
  });

  test('sidebar data returns at most ten recent documents and excludes the current Cloud document', () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      id: 'doc-' + index,
      updated_at: new Date(Date.UTC(2026, 7, 28, 12, index)).toISOString(),
    }));
    const recent = SidebarData.recentEntries(entries, { id: 'doc-11' }, 10);
    assert.strictEqual(recent.length, 10);
    assert.deepStrictEqual(recent.map((entry) => entry.id),
      ['doc-10', 'doc-9', 'doc-8', 'doc-7', 'doc-6', 'doc-5', 'doc-4', 'doc-3', 'doc-2', 'doc-1']);
  });
};
