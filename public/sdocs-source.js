// Document-source registry.
//
// One place that knows which source handles which URL shape. Later
// chunks register a new source (Bridge, Library, WorkspaceLink, ...)
// instead of editing the dispatch in sdocs-app.js.
//
// A source definition is { name, matches(location), create(location) }.
// `matches` decides whether this source claims the URL. `create` returns
// the source instance:
//
//   {
//     name,
//     capabilities: { canSave, canWatch, canSubmit },
//     load(),                  // async; populates S.currentBody / S.currentMeta
//     save?(body, meta),       // optional; the source writes the document back
//     onExternalChange?(cb),   // optional; subscribe to "document changed under us"
//     submit?(body, meta),     // optional; agent-handoff "approved" action
//   }
//
// Sources NOT supporting an optional method should omit it AND set the
// matching capability flag to false. Capability flags are how the editor
// knows what UI to show (e.g. hide a "submit" button on a source that
// doesn't support it); the absent method is the implementation detail.
//
// Order matters: register() pushes onto the registry, and select() picks
// the FIRST matching source. Register the most specific source first.

(function () {
  if (typeof window === 'undefined') return;
  var S = window.SDocs = window.SDocs || {};

  var registry = [];

  function register(def) {
    if (!def || typeof def !== 'object') {
      throw new Error('Sources.register: definition required');
    }
    if (typeof def.matches !== 'function') {
      throw new Error('Sources.register: matches(location) is required');
    }
    if (typeof def.create !== 'function') {
      throw new Error('Sources.register: create(location) is required');
    }
    if (!def.name) {
      throw new Error('Sources.register: name is required');
    }
    registry.push(def);
  }

  // Returns the first source whose matches(location) is truthy, or null.
  // `location` defaults to window.location so callers don't need to pass it,
  // but tests inject a stand-in.
  function select(location) {
    var loc = location || window.location;
    for (var i = 0; i < registry.length; i++) {
      try {
        if (registry[i].matches(loc)) return registry[i].create(loc);
      } catch (_) { /* a buggy source can't break the others */ }
    }
    return null;
  }

  function names() {
    return registry.map(function (d) { return d.name; });
  }

  function reset() {
    registry.length = 0;
  }

  S.Sources = {
    register: register,
    select: select,
    names: names,
    _reset: reset, // for tests
  };
}());
