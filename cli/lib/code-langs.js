// code-langs.js - map a source file's extension to a fenced code block.
//
// `sdoc app.rb` should open as a syntax-highlighted Ruby document, the same way
// `sdoc chart.mmd` opens as a diagram. The CLI can't highlight anything itself;
// it just wraps the file in a ```<lang> fence and the browser's highlight.js
// does the colouring. So all this module decides is: which fence label?
//
// The label is the highlight.js language name (or one of its aliases), so the
// fence the CLI writes is the same one a user would type by hand.

var path = require('path');

// Extension (no dot, lowercase) -> fence label. Markdown and plain text are
// intentionally absent: those open as documents, not as code listings.
var LANG_BY_EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', pyw: 'python',
  rb: 'ruby', rake: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin', kts: 'kotlin',
  swift: 'swift',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  cs: 'csharp',
  php: 'php',
  scala: 'scala',
  ex: 'elixir', exs: 'elixir',
  erl: 'erlang',
  clj: 'clojure', cljs: 'clojure',
  hs: 'haskell',
  lua: 'lua',
  pl: 'perl', pm: 'perl',
  r: 'r',
  dart: 'dart',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  ps1: 'powershell',
  sql: 'sql',
  yml: 'yaml', yaml: 'yaml',
  toml: 'toml',
  ini: 'ini', cfg: 'ini', conf: 'ini',
  json: 'json',
  xml: 'xml', svg: 'xml',
  html: 'xml', htm: 'xml',
  css: 'css',
  scss: 'scss', sass: 'scss',
  less: 'less',
  dockerfile: 'dockerfile',
  diff: 'diff', patch: 'diff',
  graphql: 'graphql', gql: 'graphql',
  proto: 'protobuf'
};

function extOf(filePath) {
  var name = path.basename(String(filePath || '')).toLowerCase();
  // Dotfiles named exactly like a known type, e.g. "Dockerfile".
  if (name === 'dockerfile') return 'dockerfile';
  var ext = path.extname(name);
  return ext ? ext.slice(1) : '';
}

// The highlight.js language for a path, or '' if we don't wrap it as code.
function langForFile(filePath) {
  return LANG_BY_EXT[extOf(filePath)] || '';
}

function isCodeFile(filePath) {
  return !!langForFile(filePath);
}

// File contents -> a fenced code document. Trailing whitespace is trimmed so a
// file's final newline doesn't render as an empty last line in the block.
//
// `label` (optional) is appended to the fence info string after the language,
// e.g. wrapCodeFile(src, 'app.py', 'app.py') -> ```python app.py. A multi-file
// code walkthrough uses this so the browser can name each tab; a plain single
// `sdoc app.py` passes no label and the fence stays ```python.
function wrapCodeFile(raw, filePath, label) {
  var lang = langForFile(filePath);
  var info = label ? (lang + ' ' + String(label).trim()) : lang;
  return '```' + info + '\n' + String(raw).replace(/\s+$/, '') + '\n```\n';
}

module.exports = {
  LANG_BY_EXT: LANG_BY_EXT,
  langForFile: langForFile,
  isCodeFile: isCodeFile,
  wrapCodeFile: wrapCodeFile
};
