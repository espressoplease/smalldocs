```slide
grid 100 56.25 bg=#ffffff
r 6 4 88 7 text=subtitle align=left valign=center | Email encryption protects different parts of a message

r 6 20 20.5 20 fill=#f3f6fa radius=1.2 align=left valign=top |
  ## 1. Device to provider
  TLS encrypts the connection. PKI certificates help confirm the server's identity.
r 28.5 20 20.5 20 fill=#f3f6fa radius=1.2 align=left valign=top |
  ## 2. Provider to provider
  Opportunistic TLS can fall back to plaintext. MTA-STS and DANE can require authenticated TLS.
r 51 20 20.5 20 fill=#f3f6fa radius=1.2 align=left valign=top |
  ## 3. Stored on disk
  At-rest encryption protects stolen disks. Providers usually hold the keys.
r 73.5 20 20.5 20 fill=#f3f6fa radius=1.2 align=left valign=top |
  ## 4. Message content
  S/MIME or OpenPGP can restrict reading to endpoints. Email headers stay visible.
a 26.7 30 28.1 30 stroke=#64748b strokeWidth=0.08
a 49.2 30 50.6 30 stroke=#64748b strokeWidth=0.08
a 71.7 30 73.1 30 stroke=#64748b strokeWidth=0.08

r 6 42 88 7 fill=#eaf0f7 radius=1 align=left valign=center |
  **Key question:** Who holds the key, and at which stage can they read the message?
r 6 53 88 1.7 text=caption align=left valign=center |
  Source: [Fastmail, "Understanding email encryption" (Neil Jenkins, 17 Dec 2025)](https://www.fastmail.com/blog/email-encryption/)
```
