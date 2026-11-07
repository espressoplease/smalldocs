'use strict';

// Finish each SELECT before callers update rows or await a key service.
// Queries supply a stable rowid as batch_rowid and use @after and @limit.
function* databaseBatches(db, sql, parameters) {
  const query = db.prepare(sql);
  let after = 0;
  for (;;) {
    const rows = query.all({ ...parameters, after, limit: 8 });
    if (!rows.length) return;
    after = rows[rows.length - 1].batch_rowid;
    for (const row of rows) yield row;
  }
}

module.exports = { databaseBatches };
