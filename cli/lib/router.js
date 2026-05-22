// Central command dispatch for the `sdoc` CLI.
//
// register(verb, { handler, help }) stores a verb. The default handler
// (for "no subcommand, just a file or empty argv") is registered with
// verb = null. dispatch(opts) finds the matching handler and runs it.
//
// Later chunks add a new verb in one place: router.register('verb',
// { handler }). No file other than this one and the entrypoint that
// builds the router needs to know about the new command's existence.

class CommandRouter {
  constructor() {
    this.handlers = new Map(); // verb -> { handler, help }
    this.defaultHandler = null;
  }

  register(verb, def) {
    if (!def || typeof def.handler !== 'function') {
      throw new Error('router.register: handler is required');
    }
    if (verb === null || verb === undefined) {
      this.defaultHandler = def;
      return;
    }
    if (typeof verb !== 'string' || verb.length === 0) {
      throw new Error('router.register: verb must be a non-empty string or null');
    }
    if (this.handlers.has(verb)) {
      throw new Error('router.register: verb "' + verb + '" already registered');
    }
    this.handlers.set(verb, def);
  }

  has(verb) {
    return this.handlers.has(verb);
  }

  verbs() {
    return [...this.handlers.keys()];
  }

  // Run the handler for opts.subcommand, or the default if no subcommand.
  // Returns whatever the handler returns (typically a Promise).
  async dispatch(opts) {
    const verb = opts && opts.subcommand;
    const def = (verb && this.handlers.get(verb)) || this.defaultHandler;
    if (!def) throw new Error('router.dispatch: no handler for "' + verb + '" and no default');
    return def.handler(opts);
  }
}

module.exports = { CommandRouter };
