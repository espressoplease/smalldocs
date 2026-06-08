---
title: Privacy & security
description: How data flows when you use SmallDocs, and what reaches our server.
---

# Privacy and security

This page describes what reaches our server when you use SmallDocs, and what does not. The summary: by default, nothing.

## The default url format never reaches our server

When you run `sdoc some-file.md`, the CLI does two things:

1. Reads the file from your disk.
2. Compresses the file content and encodes it into a single string, then opens a URL of this shape in your browser:

```
https://smalldocs.org/#md={compressed file content}
```

That `{compressed file content}` sits in the URL's **hash fragment** (everything after the `#`). The styled rendering happens entirely in your browser, using JavaScript loaded from smalldocs.org.

Browsers never send hash fragments to the server. This is part of how HTTP works:

> The fragment is not sent to the server when the URI is requested; it is processed by the client.
> - [MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment)

So when you open a SmallDocs URL, our server receives a request for the page HTML and JavaScript. It does not receive the `#md=...` part. That stays in your browser.

You can verify this. Open DevTools, switch to the Network tab, and load a SmallDocs URL. The hash fragment is not in the request.

## Bridge mode

Some CLI commands (for example `sdoc edit`) need two-way communication between the browser page and your machine. For those, the CLI spawns a small local "bridge" process. The bridge:

- Binds to a loopback address (`127.0.0.1`), not the public internet.
- Accepts WebSocket connections only from pages served by `smalldocs.org`.
- Requires a per-session token the CLI minted.
- Refuses requests whose Host header doesn't match the loopback it bound to.

That stops other websites and other processes on your machine from talking to the bridge.

It does not protect you from the smalldocs.org page itself. The bridge trusts whatever JavaScript that page is currently running. If the page were ever compromised, that JavaScript could ask the bridge to modify a file you opened with `sdoc edit`. The bridge would oblige.

The mitigations that exist:

- The bridge can only touch files you explicitly passed on the CLI command line. Files outside that list are unreachable.
- The bridge holds files by inode at session start; replacing a file underneath the session is refused.
- The session token in the URL fragment never reaches our server.

Treat the bridge as having the same trust level as smalldocs.org itself.

## Shared short links

Generating a short link (either manually on the site or via `sdoc share file.md`) is the one feature that uploads something to our server. We made it end-to-end encrypted.

The flow:

1. Your browser generates a random 256-bit encryption key.
2. Your browser encrypts the document with that key using AES-GCM, the same algorithm HTTPS uses.
3. Your browser uploads only the encrypted blob to our server.
4. The server stores the blob under a short random ID and sends the ID back.
5. Your browser assembles the final link:

```
  https://smalldocs.org/s/{short id}#k={encryption key}
                      └────┬───┘   └───────┬──────┘
                           │               │
                      sent to           never leaves
                       server           your browser
```

The short ID lives in the URL path, so our server sees it. The encryption key lives in the URL hash fragment, so our server never sees it (see the section above).

When someone opens the link, their browser fetches the encrypted blob from our server using the short ID, reads the key from the URL hash, and decrypts the blob locally. Our server only ever handles ciphertext.

To verify: open DevTools, go to the Network tab, click **Generate** on a sdoc, and inspect the request body. You will see a base64 blob of random bytes, not your document.

## The install script

`curl -fsSL https://smalldocs.org/install | sh` downloads a shell script from us and runs it. Reading what a script does before running it is a reasonable habit. The sources:

- The install script itself: [smalldocs.org/install](https://smalldocs.org/install)
- The CLI it installs: [npmjs.com/package/sdocs-dev](https://www.npmjs.com/package/sdocs-dev)
- The full source: [github.com/espressoplease/SDocs](https://github.com/espressoplease/SDocs)

The installer puts everything in `~/.sdocs/`, a folder you own. It does not ask for `sudo`, does not touch system directories, and does not run anything as root.

## Supply-chain trust

The privacy story above relies on smalldocs.org running the JavaScript we publicly published. We back that up with a public per-deploy manifest of file hashes, checked against the live site on a schedule. The mechanism, and how to verify it yourself, is documented at [smalldocs.org/trust](/trust).

## Source and reporting

Everything is open source. If something here does not match what the code does, that is a bug. Please report it.

- Code: [github.com/espressoplease/SDocs](https://github.com/espressoplease/SDocs)
- Issues: [github.com/espressoplease/SDocs/issues](https://github.com/espressoplease/SDocs/issues)
