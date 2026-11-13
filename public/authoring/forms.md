# Forms in Cloud documents

Use a `form` block when a reader should answer structured questions inside a document. Text fields, radio buttons, checkboxes, dropdowns, numbers and dates work directly in read mode.

````md
# Release review

```form
id: release-review
fields:
  - name: decision
    type: radio
    label: Decision
    options: [Ready, Revise]
    required: true
  - name: notes
    type: textarea
    label: Review notes
    rows: 4
  - name: target_date
    type: date
    label: Target date
buttons:
  - name: submit
    label: Submit review
```
````

Save the Markdown with `sdoc review.md --cloud --json +release +review` and give the reader the returned Cloud URL. The reader signs in and uses their existing document editing access. Everyone with document access can read the saved answers.

## Saved answers

Each changed field autosaves into `answers:` inside its form block. A submit button validates its required fields and appends a record to `submissions:` with the button name, time, scope and submitted values. Wait for the Cloud save to finish before closing the page. Failed saves leave the answers open and show an error.

Read the result with `sdoc cloud read DOCUMENT_ID --section 'Release review' --json`. The returned Markdown contains the form definition, current answers and submission records. A draft answer is separate from a submitted response. Form IDs and field names identify the controls; preserve them when changing surrounding prose.

Answers are shared document state. Independent field edits combine. When two people change the same field, the later save supplies its current value; prior values remain in document revision history. Concurrent submissions are retained. For separate private responses from several people, give each person their own document.

Button `scope: [decision]` submits selected fields, and `after: decision` places a button below that field. Draft changes outside that scope still autosave. A Cloud form stays open after submission, including when its button has `final: true` for compatibility with local feedback sessions.

## Agent workflow

Run `sdoc feedback` with no file for the complete field and button reference. Write the form, save a tagged Cloud document, and link its returned URL. Read the current Cloud document when the reader has answered, then use those answers for the requested work. Read the latest revision before updating the document so newer answers can merge with agent edits.

For local live feedback, `sdoc feedback review.md` writes answers to the file and emits a JSON line on stdout. That command needs to stay running while the reader answers. Cloud forms use the saved document and do not need a local feedback process.
