---
file: sdoc.md
---

# Meet `sdoc`: Markdown without the frustrations


(**TLDR:** `sdoc path/to/README.md` opens your file at https://sdoc.dev with pleasant default styles which can be altered. Share the url to share your file + custom styling. **Your file never hits the SDocs server:** Encoded file content lives in the URL fragment (`#...` part) which browsers don't send to servers. CLI: `npm i -g sdocs-dev`. SDocs is [open-source](https://github.com/espressoplease/SDocs). You're reading markdown right now.)

---

Markdown is great for agents, but a bit annoying for humans. Quickly and elegantly reading a `.md` file requires you to open your code editor and enter "preview" mode. Sharing a markdown file requires you to actually send the file to someone. They then have to download it and find the least annoying way to read it.

SmallDocs is an [open-source](https://github.com/espressoplease/SDocs) attempt at something different. It lets you (or your agent) easily, elegantly and <ins>100% privately</ins> **read**, **format**, **share** and **export** `.md` files.

Reading a `.md` file in SmallDocs feels just like this (you're reading markdown right now). And by playing with the styles, you can create things like:

![Examples](https://sdocs.dev/public/images/examples.png)

(Check out: [Letters](https://sdocs.dev/#md=G9UHAJwHti1qt_BRaYTFBQs3-TXn19NUb7iQEFNor7Ipl6T-ADeyl6BqR34H8vcT5yslkYVNDaIgMzMVQNrgPxxjVFIzK4la391HRbchSa1Rkoakr9Hq8jOwMBAHA3ekKAoB3bfQOmhqSY_gVilCPLwEmPQEAPzydJIU4AtErBBGWr7IKMBBiWqsjp56Aanjlbx4NiGZBBlQKu6RCqox3FsrKJdQyHzpXunM8a9sfD31TuIHe227e-Vx6wG6YHb12GU2R7GobIsvavp_Vn_dEt7piW4-ievY0recacZxlEp67l4owbpDIJ7HKGV_jRysH0Mr_W0xa6kX0x6p9Z_Ae7ztpnmW6n8u8HO3oVwpNbX11LVJ-Dec96GWwj2ro9q15R46cw6GzNmZvEEySjpXoqGK6il8nAnGBv-PKPGEMLMzTa6zXPGftKAC4HTNhyIwfs_rxsYMx0G9wJOoLtWGKjTd4X6qwOBJmUWzoG10XbK5IEjVxaCvwzspMvBLGXlXtNbZjQk6PWaSFO9AiYOiUzQhAhZuzkHLihGbGPV0j_yAHaEu3fYjbsJ09mHErIonlovSzigolaTyQnfNwVo0GK9ZXxyMPxZXO8Ev5fjC2mYjrqP_SHGDNY0NgiiZyMVqut1TdNhO3VUubSA2uoKCx5EVtgqaO1HnQMW_MWHVKzd0-WCyREndvadf1ipcLS62SC_G_TF75tsRNwyxtNKMHvhFkINe264APrECX1a_cm_SjqFlBckHWaLJgjQeoJtTYhJ9tF8I2yoPYlDjNPWH8tkrrPbQTFHtLpqG99LpFV5-_B6C8Lb6koxWUAilMUaUJa5DMMezttiJYHB_b11_3bVrjBlmWjgwHpVT9xhXqsn1ZMFfcB4iYyis1bcSB6X2v58dFRyY14h62yA2_CHoSYkXYKPEKtpwAuDOar_gT-yUZwZxmBU-ZVgtcown5nZBuV7fSWHRXNMRDHlcckHfy-mPklaFpLjNWA7VBvg73Oh723W83BETi0bU_DPvhk8dVqhqGPc5ylewUzRLMNBvswSDOc5H1QE&theme=light) | [Investor Update](https://sdocs.dev/#md=GyYLAJwHtpuVQYhvYSgo1IWbrqlZT1Pt4JAEwwLKlWP1OaEDnbkELzg7F13jBjSUnNQgCixES2HP73-_ds4mS5TmiZIWato7M_-tOiQxn4eoJQ6JqElKIxYeQ7X_eR5iKITUbK2MMWK7p0Pfa74ZYMkZKZwVBmUpSXlLF0COMiCM7FAaQEwgZgWBpJEdLAkIVMQ1ysirjxlCnkqdR1-yk7Ui_DFBcF0Wxtr4ju6MwzBKTT3v43jj8Foll8VHsa_LS40QzuusE7puQD6BXJVb_9oOeku1zIjSMBw3S6Yg2poDDnBUvr6hazlUdGA9YARg5pBQKNhbUP81dAdRttrS2FGpE2TjzgW-9XmgbMbCQKfURSh11lWNse2_JQa0qqLBdqKTrhkFjdCuUzLYHS8JreCcNjOMo1M5cqJZuZy-MEUb7Ab1DKC4dPSqSxQ4rjA2_cKgUWFbGbga2yieldtD7Q8sRyQbZok1GjPYf83XlpIqdtIdqFwtxPGxyF6weynd-w6nj9Nh2rBsT_yURwtzyPlhm0P5NTAU3o_q06v-HwLifyN-wdVEyeBFOCqvlWmn_2cbQTV78D685_DpNhAb6eixsenIFoRYI7Z5IhkmNaFLsEX7E9w6-C1IUN3aGdnZ0WYhVJvSsj_Pp2sHa3_HzBBUR_pelf6DkbcmATZ7gf_t9MMH8Bt4jz2fDxJswi1o3OPIv3__AGsESQCobsfA9gcbtvPrzTbTwqTJ59WW84KjgOzLvteWCNmG0vbATxqHFlqg0pl4DbHNCGtf8ImjwTLy2wfG2K5hGguyeXbraG2Bm2OXBndTZfG2nqmbYTTjlLaqbb22p6PuucvSvZia6Us4kpwwJO2OGfKcFZT9IiBIIxs-cyvwiZGeIYRxW1gObMhY9WIhu42MAmrIQNOOyN5NXKlB300kl2DaMlM4xWf0xyjgbv_CUGZTv8yYHxIPfB3FC5diCEFk7oX6D99qwuPW7WZ-My_7qwYzFTsl-yV4Mdh2FIb7WrM0JEBqXcOAhgwpILSqTcllF4Q5Yo9-hGn76lM4K_jwoBeD8iC7wMaAwDXwPL8a1W5dodC_sVsLjmfP_emdTys1u0KWhi4bgLJ-AhWp81Z951lGQDwZh86LHw5yRI_YMeMVXLmBE5onmk3MKxFem4lYHeidVKcv74BGQb00dBSG1dGhCRpRk8ZLB31jDWpFE-ohvl42bI6_GGsmAjmcsnSIWnJ6agFU4kbBMu9zeBMy3LtMd0FbhXTOcsAdTA50TT9IcsAOMsE5djY3rXyMzoLm16iB0Na3sww9uuG5NBD5qocSCE7Y5-Vo7n-0hsgaY0LOVJ7CFoG6ubJPQZV1c4qzpUzfMnhIGjWb2oS58-3K5DDdQz-SEHbu4rJI8OWWpnQc8RnO8NDppkwwDT9UIE8kyKFIlT7wTKzRMQVgaGeazN8IA3EKKSDG98ibloPVCvjx9P2CUoYOcG0ymyUhJ6kw4j26w3DgjvGPboFtEM6t1s2WsLeULi4kEQ&theme=light) | [Lisbon](https://sdocs.dev/#md=G0MNIJwH2SnzJNPvVHCBYHHTpur7O5cJJ6fy9OhW0tqvZYZEyEYsAToCSvo-vUptbRAFlbahAP_9T_8nFL57NF1YrGTPPRlWLjV5tNCH0lryKKU5FAuhnv6lqyYFjyNpjGGXXAmd33zzkIPjOKleLFM8E0kGFviFrVGpQobjFEBBJvjP6qT6a2r4WgWABo3eqrgy0tUny30AEUpV47plOgSAHH-wk68Byaj24ToW-BvFqlop4-3AsobSlj7IxUXa1jCOY6hqRtsjtV0F30PPy4A9EQdWafenjdeEm7fP5XjViYA_59UNkOPR4xq06Pa7HVU17GxOKvRL8VOM3HfmqRs4yxvCvKjSvMay2-IaDU6Gi3hOINr2yu0DO2yWh31V_ymp73zdpo5k8Wq3WbTpOl-52q122w8C3N68XtFqf6jS8w4sFyvWuALTQYq-sa2yyEtcrtv3q7QHWreLLiq4kwuHXXs4hl1A1P--Hu5z02zedOW5P_wubIkwvz5Nyct135Jeb7ldHZat56cbLM_PymvdcXW7yrK2dtO81Df93dn0XIUK-bswg7o4VPjnowJKBuQgWOBfal_QECo5v5R4I-yipJkA1ZAMMjE4wZJsXFY2I0fZtKDjhdls9XcZ3V3_Ev0sHH6YhoaKK7ym_oxZGYr20CVjK5IhNtlMGQ7HT8zCXfOi73BAvqn0Nm3rZ3lmzV1YacP6tQqyDkNwFKKeZmUYosGzJf-jXc6zCj1Py8fFGbxTmI6JkIcduGDWqWh4mi6ILrySF_iLsARppgMCbCk3Kq6GCkpuNJwdIrpYiPHX0AMy2lryw6JBVvhb-7Q4-cKQCJGHkQpjH3vtDJBwv9EQFWve-PvQV1a7Jn-zg4rJqmT1J3aw0XfTXTk8REF3WP4OzUG8SzvYbqn_G1AXXqvc9zG7VdYe44QFhdZuKk1p45G6hbyk_tYQ_kDzW2yQ6df_A-hwOK0XONR4YZZJgMaM_5e8Ii1gbCf0jYcDDRZA0hvujHxCCr1PE-OvKmhO5XOMaU6WBgXmG8JZtL3yXXt0Nm38Bwa2ThsDYJ2R8DvtnlCq14msZChmmrjHRFVKZtZ_lNvS8kjwF2EffpmkvQA62M87WosPhZVOd50L9z1lGP3QNMq_umdUR1ey9KX4054FX9VSxgJnc7F_uV0w-WARARnvdZVzoZxmKhH6VA2lyw4qphZCvwB7KiwTxPhiUp7WcMYexjSHKY7hOqUJS638PPRmaJA_YXa7HYVeF0bssbWjLkHc5s6uWvsf5ZWWK9yDV5pum4_Yr1-fP2Jmo5NzL9TDpplcOQJ0FQRQena0DORSaMsQruE1i1Cx4-Yfx9N6ASs1a202M75-LjH-U_ADmSFkhD8n4iFHOUmnWpwS8cyores4Wa29EBnVta_RAW8y059jLAR2LXK5__10Lj_jir0D1w7OVOH2THIHjGFtZQL7FkVfLa9NHkgeNH_GjWhOPWQCQcdIPDKqKeXPxceRI0UKk99zxSJnPLV7VKVLlyhs48dlmapSJlJThR9Gi3F1iAM2wE5wHJyHsZCbrhQNAcqcuMl1-CUTJuvchginmltpZ8Gv0zznCkw8Vk2jKSAbvCMH7ToAGS-aF-rvusarRM8tptGGu1SiJ8LxNwuw5w2e24gN64SU3WNWmApenXEDY_wFR4xxmL-Z7dHuyctel50dkAKEs-2OCwdViGRG8sKlhNZdT6I0ijv96_ELF2Wym8IqDoJEMSogi1p1-goPiDqtPxBuyD-SypwrjZJxHA7jgCbATv3fcEugC0jkAaCTcHM3CbdTT74LR968TGpE8DeLFwQ0QLgTrHvvtCWLjwpyeY2BFsjePzxr8mtX2S-LmlS_F9sBdW_a5hDPLO9ZLhhruUxyBeMI1eKYoUqnVABn7XLGCTlNf-1W8MGbUcmmG9OJ7li1YXemygA&theme=light) | [On Foot](https://sdocs.dev/#md=G8sPAJwFdptLwd1GjPOwYNhcSCGN8evUmTvLdHJKpdUtytTmZGoHPh4LbCPOwBeD1pX6bD1QDyDSL2foYxRXzTIgEGiV35OH7rOzbQWQtr0Q3y9rBziWR4jDFAiZgvArkRgXhLnt99_Oxr_pQlKEFOfPXVZXqBDtOXA5aYwTLIe6fzQliDgjdAd9_6VAH2iC30S4bU0Pyj2iWPZAA8ARnd9_uQm1dVI8iAKgtVXKuISvXgIy6J5vN31HQIH7WQ2PK7iqhtA040sgnHlvfMBfHx9rQQ2nOU1CbdAbRjHTlSep8hqjVv_GbEQl2uZNqzytMu8C7JjcIdvjkZwT418lWc3cj2cg1sIkqNGhpF6gZMaszvX9qwZbZOQjyUConbYZej7O6LBk4TA84rbOhH9FeafZiQL7iO-kbwgEcPysGV-SPdVbGhJJJotSwzTr7h3BPbRpzwm7miiclFzdHiqHKjLx24qFO1P6uNWuMlt9SB0JzCW-ZX1OzfH7EGC7UWY1q9E85JI7n3XIfTzOv893FCNde-GMRyzbZbWqc4zRVXfhEWfsiV1ZwwYKqt-7StuxL0lbf9iNByZFCXAPKQTC2sWeHBY0WQWqChGDWToCZSoQWKq3cZ3EIkQ18vxRm0komPJsV0h8WPXwVvz7Bzs7pRUrcwA0Mk9AWkUlkB5WyFWv8rANzYb8yzp7wlWvEzq10XR6Li8X_cTjI2MWAqP-RmLUKlgXxyr2l0_FrTXgLHyRUVYoO7AD0tz9577opTgdaXAmD2YpUkt2mmzPYxwoyxeVUX_iHoCQ6XjzBVgthAJV4XVcUxYZhlFjjJM7QGWyZd5_cSIKNAIBCbUf4xouK_w5ruFpXbGahVPsr4e4Q3Pc6Fxct9vJiDrxZgrcd5jJHZXY6heTQU9LeNuj3jq2D-i5lSDwPT5EgmkkKkVSi0g2ihSXSD2prfN1kIKua0XjQg15Q4AITSumqGN4hnDimvA7h13YTXvliApYqHLSgUVdxMELUrFUaA2d1xwqsZJLewzF9Ld_wRZ5IImLiq9MM8gH4Y86mmMmaxLP713jgm6wRldnwXZ56ENJmwJ5__ZrPKHvUk_dOtgnWoHBGWeD8rIWAtkIAw5bgIDdpgXK_oVhfJeSh6veADXgyBDqfurV5h4bwT5sjcuOHzfua0_QxQohP_uxombj7krxgGTcHdY4WVTcQTfcWQ0lBgRWiWnruCBI_Cw8KvzzlCEICn3m_fJSjM7YKAP7-0-08JKiw1ccGSWk62gU4XfVudICLvWsi5mZJFk4iwORK7OtERHKQVmGpSMdEzvQxI4ahltGz4bWXle38r4ZO3mSeOjPiiuj11EHBafKGC3lpkcMeS4gmipW3rA0Gh1wY5ouXlqPD5Ku0hlL-oi2ElZtsVxxVTPGRhmktbKugTUgEc1N_vfvtTLhqB_YGZ6QwcrOKWp3hE_LLZarLW-0XGQ50wqKrQVBrqetiMjJveiNjXndBfTqHIMd3wEekaupLMPjo9RK1JxmFtAcAwvQdHlDRorKNhgucAVG9k2WG0FfwEDOY_PbzrUj2qynNhrAfKWrJP7sbOzhbgb_squPQPy915s7mCcEZDEuT6OZxTwF5PbXC17iUhRvcfVqD6qJiUoTly5NTExUuriIdFExaRIP8vPG9C3p-nD4o91orDOz3ed6wwzLeT6bZsiFMOLCEkJiYuIzCfL7vWt36jTgyN55dhUhz6bL2Ses6A1Mel_Y3otOiaqna4gkmZL1VSZTfwLVHqQaxRBkldH7maQuJ5ydXLBJEYLOhwmZ6E2QkzZkQ8RP5eaNCmYVQbTA1BZZ9Q5AB1pJv02cK7vQcIMgDLSgMNwWa7Rhal5yvDw2GPVTkFJYhs6KGw57-Drmkr51jn-0cBCp_COkjoOkoq697alcue46SFfp-z0as2B5XOwXvo7q48Qh5LEC6InpFCg_6rPYbofbEZeJVXkEMUMdormwjv5BWRU&theme=light))

Creating a SmallDoc for a `.md` file (+ automatically opening your browser to read it) is as simple as:

```
# npm i -g sdocs-dev
sdoc README.md                # open styled in browser
sdoc share README.md          # copy shareable link to clipboard
```
Or telling your agent to *"sdoc it"*.

From personal experience, SDocs is great for sharing agent debugging reports across teams, doing in-depth reading on a topic and presenting agent output in a copyable format (e.g. a series of bash commands that need to be ran).

#### Claude Code + SDocs

Teach [Claude Code](https://docs.anthropic.com/en/docs/claude-code) about `sdoc` so it can read, style, and share `.md` files across all your projects:

```bash
npm i -g sdocs-dev
cat >> ~/.claude/CLAUDE.md << 'SDOC'

## SDocs

SDocs (sdocs.dev) renders markdown with clean styling you can adjust.
Content lives in the URL hash — nothing hits a server.

Use it (or offer it) when the user wants to read, share, or export a `.md` file.
Also handy for copying specific code - SDocs code blocks have copy buttons.

The `sdoc` CLI is installed globally:
- `sdoc file.md` — open styled in browser (great for easy reading).
- `sdoc share file.md` — copy shareable URL to clipboard.
- `sdoc schema` — how to adjust all stylable properties (fonts, colors, spacing).
- `sdoc charts` — chart types, JSON format, and styling. Charts render via Chart.js from ```chart code blocks.
- `sdoc --help` — full usage.

Source: https://github.com/espressoplease/SDocs
SDOC
```

Or run `sdoc setup` once installed to do this automatically.

#### Codex + SDocs

Teach [Codex](https://developers.openai.com/codex) about `sdoc`:

```bash
npm i -g sdocs-dev
cat >> ~/.codex/AGENTS.md << 'SDOC'

## SDocs

SDocs (sdocs.dev) renders markdown with clean styling you can adjust.
Content lives in the URL hash — nothing hits a server.

Use it (or offer it) when the user wants to read, share, or export a `.md` file.
Also handy for copying specific code - SDocs code blocks have copy buttons.

The `sdoc` CLI is installed globally:
- `sdoc file.md` — open styled in browser (great for easy reading).
- `sdoc share file.md` — copy shareable URL to clipboard.
- `sdoc schema` — how to adjust all stylable properties (fonts, colors, spacing).
- `sdoc charts` — chart types, JSON format, and styling. Charts render via Chart.js from ```chart code blocks.
- `sdoc --help` — full usage.

Source: https://github.com/espressoplease/SDocs
SDOC
```

Or run `sdoc setup` once installed to do this automatically.

#### Gemini CLI + SDocs

Teach [Gemini CLI](https://github.com/google-gemini/gemini-cli) about `sdoc`:

```bash
npm i -g sdocs-dev
cat >> ~/.gemini/GEMINI.md << 'SDOC'

## SDocs

SDocs (sdocs.dev) renders markdown with clean styling you can adjust.
Content lives in the URL hash — nothing hits a server.

Use it (or offer it) when the user wants to read, share, or export a `.md` file.
Also handy for copying specific code - SDocs code blocks have copy buttons.

The `sdoc` CLI is installed globally:
- `sdoc file.md` — open styled in browser (great for easy reading).
- `sdoc share file.md` — copy shareable URL to clipboard.
- `sdoc schema` — how to adjust all stylable properties (fonts, colors, spacing).
- `sdoc charts` — chart types, JSON format, and styling. Charts render via Chart.js from ```chart code blocks.
- `sdoc --help` — full usage.

Source: https://github.com/espressoplease/SDocs
SDOC
```

Or run `sdoc setup` once installed to do this automatically.

#### opencode + SDocs

Teach [opencode](https://opencode.ai) about `sdoc`:

```bash
npm i -g sdocs-dev
mkdir -p ~/.config/opencode
cat >> ~/.config/opencode/AGENTS.md << 'SDOC'

## SDocs

SDocs (sdocs.dev) renders markdown with clean styling you can adjust.
Content lives in the URL hash — nothing hits a server.

Use it (or offer it) when the user wants to read, share, or export a `.md` file.
Also handy for copying specific code - SDocs code blocks have copy buttons.

The `sdoc` CLI is installed globally:
- `sdoc file.md` — open styled in browser (great for easy reading).
- `sdoc share file.md` — copy shareable URL to clipboard.
- `sdoc schema` — how to adjust all stylable properties (fonts, colors, spacing).
- `sdoc charts` — chart types, JSON format, and styling. Charts render via Chart.js from ```chart code blocks.
- `sdoc --help` — full usage.

Source: https://github.com/espressoplease/SDocs
SDOC
```

Or run `sdoc setup` once installed to do this automatically.

## How SmallDocs work

### URLs

The URL format for SmallDocs is:

```
https://sdocs.dev/#md={compressed & encoded .md}
```

Your entire document (content and styles) lives in the URL hash.

To keep URLs as short as possible, SmallDocs compresses your markdown using [Brotli](https://en.wikipedia.org/wiki/Brotli) (a compression algorithm developed by Google, loaded via a small WebAssembly module) and then encodes the result with [base64url](https://en.wikipedia.org/wiki/Base64#URL_applications) (a URL-safe variant of base64 that avoids characters like `+`, `/`, and `=` which would otherwise need percent-encoding). Style properties that match built-in defaults (e.g. `fontFamily: Inter`, `baseFontSize: 16`) are omitted from the URL — only values that differ from defaults are included.

The `mode` parameter controls which view opens. Valid values are `read` (clean reading view, style panel hidden), `style` (style panel visible), and `raw` (raw markdown editor). When sharing a link for someone to read, use `mode=read`:

```
https://sdocs.dev/#md=...&mode=read
```

You can also link directly to a section using the `sec` parameter. Click any heading's link icon to copy its section URL:

```
https://sdocs.dev/#md=...&sec=url-formatting
```

The `sec` value is the heading text slugified (lowercased, spaces become hyphens, special characters stripped). The page will scroll to that section on load.

The `theme` parameter forces a specific theme: `theme=light` or `theme=dark`. This is useful when sharing a link where the document looks best in a particular theme. The override is view-only — it applies for that view but won't change the reader's saved theme preference.

### Privacy

Because the SmallDocs url format is:

```
https://sdocs.dev/#md={compressed & encoded .md}
```

Your document never hits the SDocs server.

This layer of privacy is built into how HTTP works. The hash fragment (everything after the `#` in a URL) is never sent to the server by the browser. It always stays entirely client-side:

> "The fragment is not sent to the server when the URI is requested; it is processed by the client" - [MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment)

The [sdocs.dev](https://sdocs.dev) site is purely a rendering space. JavaScript reads `window.location.hash`, decompresses and decodes the content, and renders your `.md` locally.

### Short links

Short links are an optional feature that produces a much shorter URL for sharing. When implementing them we've tried to balance our focus on privacy with the need to store some aspect of your document on our server (which is what enables the URL to be short). We feel we found a clever solution, but you can be the judge.

To maximize privacy the document is encrypted in your browser before upload. The SDocs server only receives (and stores) ciphertext, not the original (human readable) text. The decryption key required to convert the ciphertext into readable text stays with you.

Clicking **Generate** creates a short link of the form:

```
  https://sdocs.dev/s/{short id}#k={encryption key}
                      └────┬───┘   └───────┬──────┘
                           │               │
                      sent to           never leaves
                       server           your browser
```

The `{short id}` is what allows the server to find the relevant encrypted copy of the document. The `{encryption key}` is what's required to turn the encrypted copy back into readable text.

The `{encryption key}` lives in the URL's **hash fragment** (everything after the `#`) and, as the [Privacy](#privacy) section explains, browsers never send hash fragments to a server the request is being made to. So even though the URL is shareable, **the encryption key only ever exists in the URL itself**, on the screens and clipboards of whoever holds the link. Our server only ever sees the `{short id}` part.

The rest of this section walks through exactly what the server receives and what it doesn't.

Before you click Generate, here's what each side has:

```
  Your browser                       SDocs server
  ────────────                       ────────────
  • the document                     (nothing)
```

**Step 1: your browser generates a random 256-bit encryption key** just for this document. That's 32 random bytes, encoded as [base64url](https://en.wikipedia.org/wiki/Base64#URL_applications) so it's safe to drop into a URL:

```
// pseudocode
key = randomBytes(32)
// → "k8Xq-7mYp_NrT4vBjH2sRwDcE9LaQoV5Zi6MxF3ueKt"
```

Updated picture:

```
  Your browser                       SDocs server
  ────────────                       ────────────
  • the document                     (nothing)
  • the encryption key
```

**Step 2: your browser encrypts the document** with that key using [AES-GCM](https://en.wikipedia.org/wiki/Galois/Counter_Mode), the same algorithm HTTPS uses to protect your traffic to sites like your bank:

```
// pseudocode
ciphertext = AES_GCM.encrypt("The cat sat on the mat", key)
// → "nQ7xK_2pVmZ8rL4cBjH1sRwDcE5LaQoV9Zi3MxF7ueKt..."
```

The ciphertext is a blob of random-looking bytes that cannot be read without the key. Anyone who doesn't have the key sees only noise.

Updated picture:

```
  Your browser                       SDocs server
  ────────────                       ────────────
  • the document                     (nothing)
  • the encryption key
  • the encrypted blob
```

**Step 3: your browser uploads only the encrypted blob** to the SDocs server. **The key stays in your browser.** The server stores the blob under a short random ID and sends the ID back:

```
  Your browser                       SDocs server
  ────────────                       ────────────
  • the document                     • the encrypted blob
  • the encryption key               • the short id
  • the encrypted blob
  • the short id
```

**Step 4: your browser assembles the short link** by joining the short ID (from the server) with the encryption key (which never left your browser). The finished link has the same two-part shape shown at the top of this section: the short ID goes in the URL path, and the encryption key goes in the URL hash.

When someone opens the link, their browser sends the short ID to the server, receives the encrypted blob back, reads the key from the URL hash, and decrypts the blob locally. The server never sees the plain document or the key, only ciphertext. This pattern is called [end-to-end encryption](https://en.wikipedia.org/wiki/End-to-end_encryption): the two "ends" are your browser and the recipient's browser, and everything in between (our server included) handles ciphertext only.

To confirm this, open your browser's developer tools, switch to the Network tab, click **Generate**, and inspect the request body. You will see a base64-encoded blob of random bytes, not your document. The source is at [SDocs on GitHub](https://github.com/espressoplease/SDocs) if you want to read the exact code that runs before the upload.

Short links are opt-in. The default `#md=...` URL format still works exactly as before and never reaches a server.

### Formatting

SDocs adds basic styling to markdown files. You write your content in regular markdown and the styles live in a metadata block at the top of the file.

That metadata block is called [YAML front matter](https://jekyllrb.com/docs/front-matter/). It's a convention that started with [Jekyll](https://jekyllrb.com/) (the static site generator) back in 2008 and has since been adopted by [Hugo](https://gohugo.io/), [Gatsby](https://www.gatsbyjs.com/), [Obsidian](https://obsidian.md/), and most of the markdown ecosystem. It looks like a block of key-value pairs between two `---` lines at the top of your file:

```yaml
---
title: My Document
author: Someone
---
```

SDocs uses a `styles:` key with CSS properties written beneath it in YAML:

```yaml
---
styles:
  fontFamily: Lora
  baseFontSize: 17
  h1: { fontSize: 2.3, fontWeight: 700 }
  p: { lineHeight: 1.9, marginBottom: 1.2 }
  ...
---
```

(Click "**Raw**" — top left — to see the front matter for this file. See all available properties [here](https://sdocs.dev) or by running `npm i sdocs-dev; sdoc schema`.)

When a `Styled .md` file is rendered in the SmallDocs interface the specified styles are applied. If a plain `.md` file is rendered the default styles are applied. The fastest way to preview a styled `.md` file is with the CLI: `sdoc file.md`.

#### Light & dark modes

Colors set at the top level are light-mode colors. Dark mode is **auto-generated** by inverting lightness — light backgrounds become dark, dark text becomes light, same hue and warmth. You only need to set colors once:

```
  background: "#fffaf5"
  color: "#1a1a2e"
  h1: { color: "#c0392b" }
  blocks:
    background: "#faf0eb"
```

To override specific dark-mode colors, add a `dark:` block:

```
  dark:
    background: "#1a1520"
    h1: { color: "#ef6f5e" }
```

Colors cascade from general to specific — set `color` once and it flows to headings, paragraphs, and lists. Set `blocks.background` once and it flows to code blocks, blockquotes, and charts.

### Charts

Render charts in markdown using ` ```chart ` code blocks with JSON data. Charts are powered by Chart.js, loaded lazily from CDN only when a chart block is present.

```chart
{"type":"bar","title":"Quarterly Revenue ($M)","labels":["Q1","Q2","Q3","Q4"],"datasets":[{"label":"2024","values":[12,18,15,22]},{"label":"2025","values":[15,24,20,28]}],"format":"currency"}
```

```chart
{"type":"pie","title":"Market Share","labels":["Chrome","Safari","Firefox","Edge","Other"],"values":[65,19,4,4,8]}
```

The JSON for the bar chart above:

````
```chart
{
  "type": "bar",
  "title": "Quarterly Revenue ($M)",
  "labels": ["Q1", "Q2", "Q3", "Q4"],
  "datasets": [
    { "label": "2024", "values": [12, 18, 15, 22] },
    { "label": "2025", "values": [15, 24, 20, 28] }
  ],
  "format": "currency"
}
```
````

Supports 13 chart types: pie, doughnut, bar, horizontal bar, stacked bar, line, area, stacked area, radar, polar area, scatter, bubble, and mixed (combo). See the [full chart gallery](https://sdocs.dev/#md=G8UnAKyOt00DlHxWwjviQk58bNCHEZLMXjp1Z5n-3q1jp40U95IpNFHcxOkFh_Y1qbAHS6AbpMeoS_XEWiiA0suU-rzqL37KktMl6bZ160MSNPnhJPlKXrJ09TWLjkJX_7-1L8-6qsGeYTkr162RG2AVGeFzfLpeve6p1_V_D3CAqW91fVzCH2JFLAlUpGKrV8oguDEUlwaE3m6ZiM4W9xBWoM20RmRHHvB9eAlum_tUt5sls6pxXJDETdoI1mtn4ygyK3NKOiDQfOMfNkoleCUMqvDDsyh-Z1LjOM5yd7Tw-HQs0oShCG-aYfWyjiZSkatREH4PYX_RHNIDUBzd8FwnLPMdFKXBrkbxt5O4-oJeM-eDt5AHa9257284ROtNm9q3phEcD9cNugOB6wddF5TQBQ0o4fpBJ-BY1U9XTT9Qx61GwMkqy2zZlA3jqRh4qm4L16Agw_5OhebMz1aw6TN4qNpsU3OpeF_5RiZSediQfbXhw3sojD3QhC4QCLNQD5PkcjjqbKgnFbzm2xXK7SiVytxe6WEtm8_0XMFhbubs2qeChsZ2XUeZN8nK5DeReXVO8FuXcuFQFDfsB5fNkD40lBGzzRZo7Ffa_Wf6HSyW2X0JYjXztCBU9pr2nNpbqEZR-UsShVEkREQ6G2pohRhrMtIra6wwWs7EHBRxmEH0We0PAlAfLKMKKMDDmYPuuf41-AA3GthWgoDD4VikdsZzk1KSPZHUTpsNAfOzBBozpoABOV-7IFfIVMUBG6ODFRPd5-9eTVxku32Vwqaoc1AP7WFip2SskyZCysbQZGldmfKtfzAjCfUWrnG-9BAtrNQqKq8brS1ARlhxWiQFNSNATgm90IACPARNhf5JbL3J8iYJiAMpM4F-yGzGS_Mf7OBpkpC8WC1MXGnTHp2wCJzWxE5R5RUbOVnyCab_6MbBxp2WX-1rIHlH2HtiYqH7ZyveX6iX1w2DgaxBHQiz5-ywBTnDsNfUqfoyY6rcK8HxDS0MeEZgJVzUUJXqHhmRMQV8bdVmmGZbIAajEu--k9yjKWr10qT2qgppMopso5SBb5MVJHlpuPfKhAl4SZyQQTHDrpkwLxWR7hIjNb9rdfUie3_q50syskidaYWBu_BofhiS9mSl9sRUshL010gZF0MHmn8bpR-LPnwlOohd1GgqYg-qnL26UvyJWIkKDOwMx3fxLMUzs9WDBw8ePHgQaHUzYEaX4KGAAgoooIACBOrVnThfQgECAgICAgICtRsBiwK1n8UBhtfkX5Lu156d-0VVx6-2dud2lUz-5tV6f9SRQD3-nj6_fnmJfv08OiNnZpCjGvGkHn1KlNHhW7ZwEm2s9Blo2-XciLHPJP5IZOFnJGmoTzl5TWhCE5rQhCaUcMwhFcUHN9NtyonuY2fKlYjGz5zwuuiUJBx9Cd24iLy99hL8OnFDSdqdKwt-n4izqyci2c8p5L8De1smbtsaOrW2sRSVG21R_LRNaJBsg8PQ6dI1XaErSR8jd26qVvXiwn3aM1VJhs43eMS1ZFTt5-Ap9q3TqjAzUZuYoR48ePDgQaBlk8Qcxp5uAgICAgICtYaIOY79kD6Usxkq2TSdQOzScglE2TVdExFD4U47ABs0KxGIs1_CnxskFUWMrOq1Kd4hR5_xAVi7jVSza4W9z6ailv3tYTbLtykdjBtolzrxTj2W7YlT-iXjOXoY_uzDQeNi4ynq60zuoQ9lNx7u_MGJPjK5eIsiGS9AdheUUEIX9ELLmslswGvxk-DTomTfeR7iCn6pT3UKd24D91WdeOjtu1Iy8Z5p6q0eTQPKYXNLb84Jrr8dCMrSVMLk8TTu9woslwiFHT4_A4c1fqfNMU2NxveIZ19OrQePHxV5sQl7hWJKGu-pYf9e6Rin5H26H4M1NTXY-3g3mFuvrfuvhoejcR2TPKJoTc25j7ewBGI0in7qoh8sEh5FM2Uz0ImIEeQJCDHlI0a1r2dNpeCiZkYXG435Yidn1teun0Px__MJfBFDsm35NiPtq5nhjIQhVgwvasz75NieY0brWNqvsK8G1QPNNqgI2O75F3_GpU0knaKPcTeufGqW9DpPQY3bgK96jQfWOftbC4nhnrU8dB2KKsJXo6gFnLas9m7IG5ufPmUkkewhyHCJCzZa4krQu6EPdEMTSqjz0oKHNi3CZzCWeUYM59nZRCMVYby2BfeeVos-W1vvtOposK-AENj5vdV4PuHtll17PtotJgllorG_EgWKNerXxHs8XhGFczlL6moURVh5WhTkUjb1_tfOYObbJRtHf3hvtT08QO0I86GEftAfUCeIHQ6HQEd8qraUs5mdmsk1GvN2wzApnCPV4rCUs2jq6Ld_FwNl_XCjAnl88mpuLxRljis2iknh_Vks_rdQvJI3lnxJ3CKZMpmZppL_K4m1v6Kewo6n-3NyBRwOh8MhgHJFyq8fdAJ2MPWOawad48xBd4LkUbf5kfwKRe1zr3OhtkorGPjF6dHHgbGbo5TqIJznaXAslG-G3cXSJ1fHgHtd8rSwhXXxyazphlr3ASvFq5ak7z1MJ-pDiNY-0AV9oQvqXO8q9SajpHWMYoSd0x7lRaiqxECQKkAF-MlVRKbLVO9Y_e0YBKkrRdFyk-63Acr8r_Par-fk4zNv4ysQdeyYrqg2y-86yGx7NLhBDSJud3i-4QG2KcD25wCEvfAY6eU6tdI87bnE05Bantv9KIVJdqbLVQbaQ_RtrUxarCQPLGtRVx9lrSt9MPCsLiajyQ_VxCHG8sFLjIzC0VuH5HRWZEWEJBeKtEu9gMMh0AWOut3QqiiD5j_owFsrWmMj0S4QiM2d8DimqQP4HRUn82wHPvH_VZq1oWRGXoCamq9pMXXHjctQyQCjCvY1rdqYW4HWWK2RFrtze25Mbdf0VurlZUOtS5cm2m7tfm2JbS4PIL08339eUWLhaNR9XcIukvT25yqELbQejcnb2dvPETgwJF4PkC_51mHY42hCCU0oIeRGSa388pcqKFYEt5q0oypb1DpSwIbf-_EZuKoO4yuVisSjHOlUGzB2q8OD04m0oi7lwRNva_wC2-10pqQjqbPcWXX3lt_XEGMsSow2Usgsfxr41vupbNiKIVvJ4uFtTD8iG8NmNszKdvuTWzWmzN0SChAQEBCoNZfM6xIKEBAQEKizicD5WLVHAXgwo7AvoKFhsbN8qzYO2RscCrgP6jxADvydlUyh_bwFIecm-d18mXV6CBAXTz2DpPojQax0AQ) for live examples of every type.

Style chart colors via `chart.accent` and `chart.palette` in front matter. Run `sdoc charts` for the full reference of types, options, and styling.

### Math

Write LaTeX between `$...$` (inline) or `$$...$$` (display). Rendered by KaTeX, loaded lazily from CDN only when a math delimiter is present.

Inline example: the mass-energy equivalence is $E = mc^2$, and a subscripted term like $U_{env}$ stays readable mid-sentence.

Display:

$$
U(\mathbf{x}; \lambda_1, \lambda_2) = U_{env}(\mathbf{x}_{env}) + \lambda_1 U_1(\mathbf{x}_1, \mathbf{x}_{env}) + \lambda_2 U_2(\mathbf{x}_2, \mathbf{x}_{env})
$$

A closing `$` immediately followed by a digit isn't treated as a delimiter, so `$5` and `$10` stay as currency. For the full list of supported commands, see [katex.org/docs/supported](https://katex.org/docs/supported.html).

### Drag & drop

Drag any `.md` file onto the editor to SmallDoc it instantly. Or from the terminal: `sdoc file.md`.

### Exports

#### Raw .md

Your markdown content with all front matter stripped. Plain markdown, compatible with anything.

#### PDF

A styled PDF with selectable text, generated client-side.

#### Word (.docx)

A styled Word document generated from the rendered HTML.

#### Styled .md

Your markdown with the `styles:` front matter block included. This is the format SmallDocs reads back in, so your formatting is preserved.

### Collapsed headers

All sections (H2, H3, H4) load collapsed. This gives you an overview of the document structure before reading.

Clicking a heading expands its section and all of its children. Clicking again collapses everything back.

When a section has both direct content (paragraphs, code blocks) and child sub-sections, the collapsed state shows `...` to indicate there is content above the first child heading. For example, the Formatting section in this document shows `...` when collapsed because it has introductory paragraphs before the Light & dark modes sub-section.

If you expand a child section while its parent is still collapsed, the parent's direct content becomes visible but is shown indented and subdued (reduced opacity) — so you can see the context without it competing visually with the section you opened.

### Copy & paste

Every header has its own copy and paste button. This copies its content and all of its children's content. At the moment this is the fastest way to get SmallDoc content into your agent's context, but we're looking for novel ideas to make this better.

### Works offline

SDocs uses a [service worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) to cache all assets (HTML, CSS, JS, fonts) in the browser. After your first visit, the site loads entirely from this cache — no network required. You can open SDocs URLs and edit documents while offline.

On each visit, the service worker sends a single request to `/version-check` in the background. This compares the cached app version against the server's current version. If they differ, the cache is purged and fresh assets are fetched — the update takes effect on your next page load. If the request fails (e.g. you're offline), nothing happens and the cached version continues to work.

### Analytics

We don't use any third-party analytics provider.

The `/version-check` request described in the works offline section above is the only request SDocs makes to the server. Like any HTTP request, it includes your IP address, browser user-agent, referring URL, and the timestamp — this is standard to how the web works and is not something we add. The server logs the user-agent, referer, and accept-language to stdout, but does not record your IP address anywhere.

In addition to these standard fields, the version-check request includes your cohort week — the week you first visited SDocs. This is stored in your browser's localStorage under the key `sdocs_cohort`. For example, if you first visit on 2026-04-10, the value `2026-W15` is stored and sent with each subsequent version-check.

This is not a unique identifier. It groups you with every other person who first visited that same week. Alongside the cohort, each visit also records a coarse device label (desktop / mobile / tablet), browser family (Chrome, Safari, etc.), and referrer category parsed from the standard HTTP headers — none of which identifies you individually. Every 15 minutes, buffered visits are written to a local SQLite database. The dashboard at [sdocs.dev/analytics](https://sdocs.dev/analytics) shows visit counts per cohort per week.

To opt out, visit [sdocs.dev/analytics](https://sdocs.dev/analytics). Subsequent visits are sent with an empty cohort and counted under "Unattributed".

### Auto-save

Because the URL includes your full document and dynamically updates via JavaScript, every change you make is instantly preserved in the URL. This works when you're offline.

### File info card

When you run `sdoc <file>` the browser shows a small info card at the top of the rendered document. It can carry three fields:

- **file** — the filename. Lives in the YAML front matter and travels in the share URL.
- **path** — the relative path from the directory you ran `sdoc` in. *Local only.*
- **fullPath** — the absolute path on your machine. *Local only.*

The two "local" fields are passed to the browser via a separate URL parameter (`&local=...`) that JavaScript reads into memory on load and immediately strips from the address bar using `history.replaceState`. So by the time you could copy the URL, the local data is no longer in it. `sdoc share <file>` never generates that parameter to begin with — so links produced by `share` are inherently path-free. If a recipient opens your shared URL, only `file` is visible.

## The CLI

### Installation

SmallDocs has a command-line tool that lets you open, share, and style markdown files from the terminal. Install it once:

```
npm i -g sdocs-dev
```

This gives you the `sdoc` command. The first time you run it, you'll see a one-time prompt offering to wire SDocs into any coding agents you have installed (see Setup below). You can accept, skip, or opt out - and re-run it any time with `sdoc setup`.

### Setup

```
sdoc setup
```

Detects which coding agents you have installed (Claude Code, Codex, Gemini CLI, opencode) and offers to append a short SDocs section to each of their global config files. This is what lets your agents know `sdoc` exists and what it does, so they can read, style, and share `.md` files on your behalf.

`sdoc setup` also auto-prompts once the first time you use the CLI. If you decline or skip it then, you can always come back and run it manually. It's safe to run any time - it detects existing sections and skips files that already have them.

### Open a file

```
sdoc README.md
```

Your browser opens with the document styled and readable. That's it — one command to go from `.md` file to formatted document.

### Share a link

```
sdoc share README.md
```

This copies a shareable link to your clipboard.

You can also combine it with options:

```
sdoc share report.md --section "Results" # deep-link to a heading
sdoc share notes.md --write             # link opens in write mode
sdoc share notes.md --dark              # link opens in dark theme
```

### Start a new document

```
sdoc new
```

Opens a blank document in write mode, ready to type a `h1`.

### Style schema

```
sdoc schema
```

Prints every available style property with its type, default value, and description. This is designed to be readable by both humans and LLMs — so your agent can write YAML front matter for you.

### Chart options

```
sdoc charts
```

Prints the full chart reference: all 13 chart types, JSON data formats, axis options, number formatting, annotations, dual y-axis, palette modes, and styling via front matter. Everything an agent needs to generate charts.

### Modes

By default, files open in read mode. You can open in any mode:

```
sdoc README.md              # read mode (default)
sdoc README.md --write      # write mode (contentEditable editor)
sdoc README.md --style      # style mode (styling panel visible)
sdoc README.md --raw        # raw mode (plain markdown source)
```

### Pipe from stdin

Any command that outputs markdown can be piped directly into SmallDocs:

```
cat notes.md | sdoc                     # open in browser
cat notes.md | sdoc share               # pipe to clipboard link
your-agent --output md | sdoc           # pipe agent output to browser
```

### Default styles

If you find a style you like, use the "Save as Default" panel in the Style view to generate a command that saves your preferences to `~/.sdocs/styles.yaml`. The CLI automatically applies these defaults to every file you open — unless the file has its own styles, which always take priority.

```
sdoc defaults               # view your current defaults
sdoc defaults --reset       # remove them
```

### For agents

The CLI is designed to work well in automated workflows. A few patterns:

- **Generate a styled doc**: have your agent write a `.md` file with YAML front matter, then `sdoc share file.md` to copy a shareable link
- **Learn the format**: `sdoc schema` gives your agent everything it needs to know about available style properties
- **Learn charts**: `sdoc charts` gives the full reference of chart types, options, data formats, and styling
- **Deep-link to context**: `sdoc share file.md --section "Heading"` creates a URL that scrolls straight to the relevant section
- **No auth, no API keys**: everything is client-side — the URL *is* the document

Agents can get detailed help on any topic via the CLI:

```
sdoc help              # general usage
sdoc schema            # all style properties, color cascade, theme format
sdoc charts            # chart types, JSON format, styling, annotations
```

### Set up your agent

The easy way: run `sdoc setup`. It detects which coding agents you have installed and appends the snippets below for you. You're prompted automatically the first time you run any `sdoc` command, and you can re-run `sdoc setup` any time.

The manual way: copy and paste the one-line commands below into your terminal. Each appends SDocs instructions to the tool's global config file.

#### Claude Code → `~/.claude/CLAUDE.md`

```bash
cat >> ~/.claude/CLAUDE.md << 'SDOC'

## SDocs

SDocs (sdocs.dev) renders markdown with clean styling you can adjust.
Content lives in the URL hash — nothing hits a server.

Use it (or offer it) when the user wants to read, share, or export a `.md` file.
Also handy for copying specific code - SDocs code blocks have copy buttons.

The `sdoc` CLI is installed globally:
- `sdoc file.md` — open styled in browser (great for easy reading).
- `sdoc share file.md` — copy shareable URL to clipboard.
- `sdoc schema` — how to adjust all stylable properties (fonts, colors, spacing).
- `sdoc charts` — chart types, JSON format, and styling. Charts render via Chart.js from ```chart code blocks.
- `sdoc --help` — full usage.

Source: https://github.com/espressoplease/SDocs
SDOC
```

#### Codex → `~/.codex/AGENTS.md`

```bash
cat >> ~/.codex/AGENTS.md << 'SDOC'

## SDocs

SDocs (sdocs.dev) renders markdown with clean styling you can adjust.
Content lives in the URL hash — nothing hits a server.

Use it (or offer it) when the user wants to read, share, or export a `.md` file.
Also handy for copying specific code - SDocs code blocks have copy buttons.

The `sdoc` CLI is installed globally:
- `sdoc file.md` — open styled in browser (great for easy reading).
- `sdoc share file.md` — copy shareable URL to clipboard.
- `sdoc schema` — how to adjust all stylable properties (fonts, colors, spacing).
- `sdoc charts` — chart types, JSON format, and styling. Charts render via Chart.js from ```chart code blocks.
- `sdoc --help` — full usage.

Source: https://github.com/espressoplease/SDocs
SDOC
```

#### Gemini CLI → `~/.gemini/GEMINI.md`

```bash
cat >> ~/.gemini/GEMINI.md << 'SDOC'

## SDocs

SDocs (sdocs.dev) renders markdown with clean styling you can adjust.
Content lives in the URL hash — nothing hits a server.

Use it (or offer it) when the user wants to read, share, or export a `.md` file.
Also handy for copying specific code - SDocs code blocks have copy buttons.

The `sdoc` CLI is installed globally:
- `sdoc file.md` — open styled in browser (great for easy reading).
- `sdoc share file.md` — copy shareable URL to clipboard.
- `sdoc schema` — how to adjust all stylable properties (fonts, colors, spacing).
- `sdoc charts` — chart types, JSON format, and styling. Charts render via Chart.js from ```chart code blocks.
- `sdoc --help` — full usage.

Source: https://github.com/espressoplease/SDocs
SDOC
```

#### opencode → `~/.config/opencode/AGENTS.md`

```bash
mkdir -p ~/.config/opencode
cat >> ~/.config/opencode/AGENTS.md << 'SDOC'

## SDocs

SDocs (sdocs.dev) renders markdown with clean styling you can adjust.
Content lives in the URL hash — nothing hits a server.

Use it (or offer it) when the user wants to read, share, or export a `.md` file.
Also handy for copying specific code - SDocs code blocks have copy buttons.

The `sdoc` CLI is installed globally:
- `sdoc file.md` — open styled in browser (great for easy reading).
- `sdoc share file.md` — copy shareable URL to clipboard.
- `sdoc schema` — how to adjust all stylable properties (fonts, colors, spacing).
- `sdoc charts` — chart types, JSON format, and styling. Charts render via Chart.js from ```chart code blocks.
- `sdoc --help` — full usage.

Source: https://github.com/espressoplease/SDocs
SDOC
```

## Contact

### Email

You can get in touch at:
```
hi@sdocs.dev
```
