# Video

Use a `video` fence for a supported YouTube reference. The first line is a YouTube URL or 11-character video ID. Optional lines set the title and start time.

````md
```video
https://www.youtube.com/watch?v=dQw4w9WgXcQ
title: Product walkthrough
start: 75
```
````

Supported URL forms include ordinary watch URLs, `youtu.be` links, embed URLs, shorts URLs, live URLs, and bare IDs. The renderer uses `youtube-nocookie.com` for the embed.

Use a descriptive title for accessibility. Keep the surrounding prose sufficient to explain why the video is present because the reader may not play it. A document can contain at most 50 video blocks, and each block source is limited to 8 KB.

Video hosting outside YouTube and first-party image or media hosting are outside the current renderer contract.
