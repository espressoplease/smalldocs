// file-wrap.js - turn a file's contents into a renderable document.
//
// Some file types don't open as themselves: a .csv opens as a sheet, a .mmd as
// a diagram, a .rb as a highlighted listing. For those, the document SDocs
// renders is DERIVED from the file (its contents inside a fenced block) rather
// than the file itself. This module is the one dispatcher that decides which
// wrapping applies. Markdown and plain text are not wrapped - they open as-is.
//
// Both open paths go through here: readContent (the URL-snapshot path, in
// io.js) and the bridge (the live-sync path). The bridge also reads
// isWrappedFile to refuse saving a derived view back over the source file -
// that would overwrite the .csv / .mmd / .rb with fence markup.

const { wrapCsvFile } = require('./cells-transclude');
const codeLangs = require('./code-langs');

// A "wrapped" file is one whose renderable document is derived from a fence
// around its contents, not the raw file.
function isWrappedFile(filePath) {
  var name = String(filePath || '');
  return /\.(csv|mmd|mermaid)$/i.test(name) || codeLangs.isCodeFile(name);
}

// File contents -> renderable document. Wrapped types get their fence;
// everything else (markdown) passes through untouched.
function wrapForDisplay(raw, filePath) {
  var name = String(filePath || '');
  if (/\.(mmd|mermaid)$/i.test(name)) {
    return '```mermaid\n' + String(raw).replace(/\s+$/, '') + '\n```\n';
  }
  if (/\.csv$/i.test(name)) return wrapCsvFile(raw, name);
  if (codeLangs.isCodeFile(name)) return codeLangs.wrapCodeFile(raw, name);
  return String(raw);
}

module.exports = {
  isWrappedFile: isWrappedFile,
  wrapForDisplay: wrapForDisplay,
};
