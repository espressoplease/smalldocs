// Shared constants used across the CLI lib.
//
// VERSION resolves to the CLI's own package version (cli/package.json),
// not the server's root package.json.

const path = require('path');
const os   = require('os');

exports.DEFAULT_URL       = 'https://sdocs.dev';
exports.VERSION           = require('../package.json').version;
exports.UPDATE_CACHE      = path.join(os.homedir(), '.sdocs', 'update-check.json');
exports.SETUP_CACHE       = path.join(os.homedir(), '.sdocs', 'setup.json');
exports.ONE_DAY           = 86400000;
exports.AGENT_CHANGES_URL = 'https://sdocs.dev/agent-changes';
exports.GITHUB_REPO_URL   = 'https://github.com/espressoplease/SDocs';

// Printed by `sdoc feedback` with no args. Goal: an agent can read this
// once and write valid form blocks afterwards. Short, dense, and every
// supported field type appears in the example.
exports.FORM_DSL_REFERENCE = `\
sdoc feedback — interactive form DSL
====================================

Ask the user something structured. Write a fenced \`\`\`form block into a
markdown file, then run:

  sdoc feedback file.md                # opens the file, exits on first submit

That is the simplest, recommended shape: ONE submit button, single
process invocation. The user clicks, the file gets the answers, the
process prints one JSON line on stdout, and exits. You just spawn the
command, wait for it to finish, and read its stdout.

You only need the other modes when you genuinely want multiple submits
in one session:

  sdoc feedback file.md --keep-open    # bridge stays alive across many
                                       # submits; you tail stdout to
                                       # react per click
  sdoc feedback file.md --keep-open \\
       --log-file /tmp/sdoc.jsonl      # also mirror events to a file
                                       # (fallback for harnesses that
                                       #  can't tail a background process)
  sdoc feedback file.md --message "Q"  # show "Q" above the document

Strong default: write forms with ONE button. Reach for --keep-open + a
multi-button form only when "the user submits several things during one
session" is the actual goal.

A form block has four sections: id, fields, buttons, and (added by the
bridge on submit) answers + submissions. You author id, fields, buttons.

Full example
------------

\`\`\`form
id: q3-review
fields:
  - name: ready
    type: radio
    label: "Are you ready to ship?"
    options: [Yes, "Needs more time", Push out]
    required: true
    default: Yes
    help: "All teams have signed off."

  - name: notes
    type: textarea
    label: "Detailed thoughts"
    rows: 5
    placeholder: "Anything else?"
    default: |
      Pre-filled text the user can edit.
      Spans multiple lines via the | scalar.

  - name: name_field
    type: text
    label: "Your name"
    default: "Jane"          # pre-fills the input; user can edit to "Jane!"

  - name: tags
    type: checkbox
    label: "Which areas?"
    options: [api, web, docs, infra]
    default: [api, docs]

  - name: tier
    type: select
    label: "Pricing tier"
    options: [free, pro, team, enterprise]
    default: pro

  - name: head_count
    type: number
    label: "How many people?"
    min: 1
    max: 500
    default: 5

  - name: target_date
    type: date
    label: "Target ship date"
    default: "2026-06-01"

buttons:
  - name: send_decision
    label: "Send decision"
    scope: [ready]            # this button only submits the 'ready' field
    after: ready              # render this button inline, right under the
                              # 'ready' field, instead of in the footer row

  - name: send_all
    label: "Submit everything"
    final: true               # this button always ends the session
\`\`\`

Field types
-----------

  text       single-line input. default, placeholder, required, maxlength
  textarea   multi-line. default (block-scalar OK), rows, placeholder, required, maxlength
  radio      one of N choices. options[] required. default selects one.
  checkbox   multi-select. options[] required. default is an array.
  select     dropdown. options[] required. default selects one.
  number     numeric input. min, max, step. default is a number.
  date       date picker (YYYY-MM-DD). min, max. default is the ISO date string.

Per-field keys
--------------

  name        required, [a-z0-9_-]{1,64}, unique per form
  label       shown above the control
  help        small grey description under the control
  required    true/false
  default     pre-fill value the user can edit (array for checkbox, number
              for number, ISO date for date, string otherwise)
  options     radio / checkbox / select; array of strings
  placeholder text / textarea / number; greyed-out hint that vanishes on type
  rows        textarea only
  min/max     number, date
  step        number only

Buttons
-------

  name       required, unique per form
  label      button text
  scope      optional list of field names. Defaults to all fields.
  final      optional bool. true means this submit ends the session even
             when --keep-open was passed.
  after      optional field name. Renders the button inline right under
             that field instead of in the bottom row. Combine with scope
             for a "submit just this section" pattern.
  help       optional one-line override for the auto-generated hint
             (see "Button hints" below). Only set this when your own
             one-liner is clearly better than the default.

Button hints (automatic, you do not author these)
-------------------------------------------------

Every button gets a small grey line under it explaining what happens
when the user clicks. You do not write the hint; it is derived from the
button's shape:

  final: true            -> "Submitting hands off to the agent and ends
                             this session."
  scope: [a, b]          -> "Sends just these answers (a, b). You can
                             keep editing."
  no scope (non-final)   -> "Sends all answers. You can keep editing."

After a successful submit, a green italic line also appears under that
same button: "Saved to <filename> at HH:MM:SS". It updates in place on
each subsequent click of that button. You do not author this either.

Set the per-button \`help: "..."\` key only when your own copy is
genuinely more useful than the default (e.g. when the field semantics
are non-obvious and the auto hint would mislead).

Multi-round flow (with --keep-open)
-----------------------------------

  1. Write a file with a form block, run \`sdoc feedback file.md --keep-open\`.
  2. User edits, clicks a non-final submit. Bridge writes the file with
     answers + a submission entry. The bridge stays alive.
  3. Read the file. \`submissions[-1]\` has the user's latest answer.
  4. Rewrite the file with the next question (keep the form id stable to
     preserve answers + history; change fields or labels as needed).
  5. The browser refreshes automatically. The user answers the new form.
  6. Repeat until the user clicks a button with \`final: true\`, or closes
     the tab.

How to know a submit happened (events)
--------------------------------------

Every successful submit emits one JSON line to stdout, e.g.

  {"event":"submit","form_id":"q1","by":"send_decision",
   "at":"2026-05-24T10:01:32.123Z","scope":["ready"],
   "values":{"ready":"Yes"},"final":false}

Startup chatter is on stderr, so stdout is a clean event channel.

Two reading patterns:

  Single-shot   sdoc feedback file.md
                User clicks once, bridge writes the file, prints one
                JSON line to stdout, exits 0. Agent runs the command,
                waits for it to finish, reads stdout. No tailing. Works
                in every harness that can run a child process.

  Multi-click   sdoc feedback file.md --keep-open
                Bridge stays alive. Each click prints another JSON
                line. Agent runs the command in the background and
                reads new lines as they arrive (Claude Code, Codex,
                opencode all support this).

  Log fallback  --log-file PATH
                The same JSON lines, also appended to a file. Use this
                when your harness can run a backgrounded process but
                can't stream its stdout (Aider, older Cursor modes).
                Agent reads the file periodically.

On submit, the form block grows two new sections:

\`\`\`yaml
answers:
  ready: Yes
  notes: |
    Multi-line answer text the user kept or edited.
  tags: [api, docs]
  head_count: 5
  target_date: "2026-06-01"
submissions:
  - by: send_decision
    at: "2026-05-23T10:01:32Z"
    scope: [ready]
    values:
      ready: Yes
\`\`\`

Constraints
-----------

  - 64KB max per form block source.
  - Field and button names: [a-z0-9_-]{1,64}.
  - Strings containing triple-backticks are rejected on submit.
  - Markdown around the form block is preserved byte-for-byte.

End.
`;

