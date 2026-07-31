---
title: Titles & link previews - plan
---

# Titles & link previews

Two things you flagged: shared docs never retitle the tab, and they have no link preview. They're different problems because the server never sees document content (it's in the URL fragment, or stored encrypted). The tab title is a pure browser-side fix. Previews are not, and that's where I need a call from you.

## 1. Tab title - done, awaiting your OK to commit

Set `document.title` on every render, so it works for both `#md=` links and short links. Priority: front-matter `title:`, then the first heading, then bare `SmallDocs`.

| Document | Tab title |
| --- | --- |
| front matter `title: Quarterly Plan` | `Quarterly Plan - SmallDocs` |
| starts with `# My Great Doc` | `My Great Doc - SmallDocs` |
| only an `## H2` | `Only an H2 here - SmallDocs` |
| empty | `SmallDocs` |

This also fixes browser history and bookmarks, not just the visible tab. It's a 21-line, single-file change; tests green; currently uncommitted.

## 2. Link previews - a real fork

No crawler runs JS or reads the URL fragment, so the client can't help here. For a per-document preview card the *server* has to know something about the doc, which leaks it out of the zero-knowledge model. The options are a spectrum of how much leaks:

**A. Better generic card (zero leak).** Give shared docs a distinct "A document shared via SmallDocs" card instead of the current homepage marketing card. Today a shared doc previews as *"SmallDocs - an office suite for coding agents"*, so it looks like you're pushing the product, not sharing a document. Cheap, honest, but every link looks identical.

**B. Opt-in metadata (real previews, short links only).** At share time, optionally attach a plaintext title + description stored beside the ciphertext. The server serves those as the preview. This is the only path to a genuine per-doc card. Cost, stated plainly: that title/description become visible to the server and to anyone with the link. Off by default, explicit each time. Can't work for `#md=` links.

I lean: ship the title now, do **A** as the baseline, and build **B** only if you want real previews and accept the leak. Your call below.

## Give me feedback

```form
id: title-previews
fields:
  - name: commit_title
    type: radio
    label: Commit the tab-title change as-is?
    required: true
    default: Yes commit it
    options: [Yes commit it, Tweak it first, Hold off]
  - name: title_format
    type: radio
    label: Title format - keep 'Doc - SmallDocs'?
    help: How the tab / bookmark reads.
    default: Keep 'Doc - SmallDocs'
    options: [Keep 'Doc - SmallDocs', Just 'Doc', "'Doc · SmallDocs'"]
  - name: preview_direction
    type: radio
    label: Link previews - which direction?
    required: true
    default: A only (generic card, zero leak)
    options:
      - A only (generic card, zero leak)
      - A now, then build B
      - B only (opt-in real previews)
      - Neither for now
  - name: notes
    type: textarea
    label: Anything else
    placeholder: Concerns, edge cases, or a different idea...
    rows: 4
buttons:
  - name: send
    label: Send feedback
    final: true
answers:
  commit_title: Yes commit it
  title_format: Keep 'Doc - SmallDocs'
  preview_direction: A only (generic card, zero leak)
  notes: |
    how are link previews received -> someone pasting into whatsapp

    whatsapp makes a request to the url to see if there is an image - does that include the fragment? could we generate something on request? or not possible with a short link?

    go for it re title changes
submissions:
  - by: send
    at: "2026-07-01T15:09:20.844Z"
    scope: [commit_title, title_format, preview_direction, notes]
    values:
      commit_title: Yes commit it
      title_format: Keep 'Doc - SmallDocs'
      preview_direction: A only (generic card, zero leak)
      notes: |
        how are link previews received -> someone pasting into whatsapp

        whatsapp makes a request to the url to see if there is an image - does that include the fragment? could we generate something on request? or not possible with a short link?

        go for it re title changes
```
