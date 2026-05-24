---
title: Slides in SDocs
---

# Slides in SDocs

SmallDocs now render slides. Wrap a slide in a `~~~slide` fenced block and it
shows up inline in the document as a thumbnail, goes fullscreen when you click
the present icon, and exports to PDF one page per slide.

The deck is just a `.md` file - so you can write it, or hand the job to your
coding agent. Nothing hits a server; the whole thing lives in the URL like
every other SmallDoc.

~~~slide
grid 100 56.25 bg=#0b1220
r 6 8 82 4 text=caption color=#38bdf8 align=left | NEW IN SDOCS
r 6 17 84 17 text=title color=#f1f5f9 align=left | Build a deck without leaving markdown
r 6 38 78 6 text=subtitle color=#94a3b8 align=left | Slides render from ~~~slide blocks - inline, fullscreen, and as PDF
l 6 48 24 48 stroke=#38bdf8 strokeWidth=0.2
~~~

## Start from a template

You rarely place anything by hand. `@extends` starts a slide from a built-in
layout - cover, metric, two-column, exhibit, section divider - and you fill
its named slots. No coordinates, no geometry. The slide picks up your
document's fonts, colors and theme automatically, so a deck looks like the
rest of your SmallDoc. `sdoc slides list` shows every template and the slots
it exposes.

~~~slide
@extends two-column
#title: What shipped this quarter, and what is next
#left-header: SHIPPED
#left:
- Cohort retention dashboard
- Auto-routing for support tickets
- Salesforce two-way sync
#right-header: NEXT
#right:
- Anomaly alerts on key metrics
- Embedded dashboards for customers
- SOC 2 Type II
~~~

## Charts and diagrams drop right in

A `chart` or `mermaid` fenced block inside a slide renders the same way it
does anywhere else in a SmallDoc - a live chart, a real diagram, no
screenshot round-trip. `@extends exhibit` gives the chart a takeaway column;
`@extends title-body` holds a diagram in its body.

~~~slide
@extends exhibit
#title: Revenue grew every quarter, with Q1 the steepest step
#chart:
  ```chart
  {"type":"bar","title":"ARR by quarter ($M)","labels":["Q2","Q3","Q4","Q1"],"values":[1.70,1.88,2.04,2.36],"color":"#2563eb"}
  ```
#takeaway:
  **+39%** across four quarters.

  Q1 alone added **$0.32M** - more than the previous two quarters combined.
#source: Finance, May 2026. Figures in $M ARR.
~~~

~~~slide
@extends title-body
#title: How a customer query becomes a dashboard
#body:
  ```mermaid
  flowchart LR
    Q[SQL query] --> P[Planner]
    P --> C[(Column store)]
    C --> A[Aggregator]
    A --> D[Dashboard]
    A --> X[Export / API]
  ```
#footer: Northwind query pipeline, simplified
~~~

## Present it, export it

Click the present icon in a slide's corner to go fullscreen - arrow keys
navigate, `Esc` exits, and a rail down the side jumps between slides. Or skip
the click: `sdoc present file.md` opens a file straight into the deck.

The same deck exports to PDF from the export menu, one page per slide, with
real selectable text - not a screenshot. Charts, diagrams and math come along
as crisp images.

## Hand it to your agent

Slides are built to be written by an agent. Prompts that work:

- "Turn this README into a 6-slide overview deck."
- "Make a slide with our Q3 numbers as a bar chart and a one-line takeaway."
- "Draw our service architecture as a flowchart slide."
- "Build a results slide: this benchmark as a line chart, with the finding called out."

Agents that have run `sdoc setup` already know slides exist - they can read
`sdoc slides` for the DSL and `sdoc slides list` for the templates before
writing a block. Set an agent up on an older version? Re-run `sdoc setup` to
refresh its SDocs instructions.

## Putting it together

Templates cover the layouts you reach for most. When you want something they
do not have - a process flow, a funnel, a market map - you compose the slide
yourself from raw shapes placed on the grid. Each of these is one `~~~slide`
block:

~~~slide
grid 100 56.25
r 6 7 88 5 text=subtitle align=left | Four stages, and the one the customer actually feels
r 7 23 18 13 #s1 stroke=#cbd5e1 strokeWidth=0.12 radius=2 align=center valign=center | **Capture**
r 29 23 18 13 #s2 stroke=#cbd5e1 strokeWidth=0.12 radius=2 align=center valign=center | **Model**
r 51 23 18 13 #s3 fill=#1e40af color=#ffffff radius=2 align=center valign=center | **Activate**
r 73 23 18 13 #s4 stroke=#cbd5e1 strokeWidth=0.12 radius=2 align=center valign=center | **Measure**
a @s1.right @s2.left stroke=#94a3b8 strokeWidth=0.1
a @s2.right @s3.left stroke=#94a3b8 strokeWidth=0.1
a @s3.right @s4.left stroke=#94a3b8 strokeWidth=0.1
r 7 41 84 6 text=caption color=#475569 align=center | Activate is the step the customer experiences - so it gets the one bit of colour on the slide.
~~~

~~~slide
grid 100 56.25
r 6 5 88 5 text=subtitle align=left | Sales funnel: where deals fall out
p 6,13 62,13 50.8,20.5 17.2,20.5 fill=#e2e8f0
p 17.2,21 50.8,21 44.1,28.5 23.9,28.5 fill=#e2e8f0
p 23.9,29 44.1,29 38.9,36.5 29.1,36.5 fill=#e2e8f0
p 29.1,37 38.9,37 37,44.5 31,44.5 fill=#1e40af
r 66 13.75 30 6 align=left valign=center | **1,200**  Leads
r 66 21.75 30 6 align=left valign=center | **720**  Qualified
r 66 29.75 30 6 align=left valign=center | **430**  Demo booked
r 66 37.75 30 6 color=#1e40af align=left valign=center | **210**  Closed won
~~~

Under that composition is a raw-shape DSL: rectangles, circles, arrows,
polygons with curved edges, opacity, layering. It is the power-user tier -
most decks never touch it - but it is there when a layout needs it.
`sdoc slides` has the full reference.

## More

The [full slide gallery](https://sdocs.dev/#md=G2OUIDwMb4yQHjKyJLTGPZOGwEPQvsAJNUuliu4fZEMjJJn1v_3M__o1rZB4AZV9pVcORWWTiCNsm9kGURjLG7c-2KZ_53J6M0lHKN8kSGVCdOIwGlomhNoXux8-1JZhP021aH1dkzaNYgh58IPI23p_7_dpKmZS6X3ssnCgjHyVOtZ9F3h6lykXQd92lmnnjUq7sKDOgoJUTko3SzV7NNXaWZo7fsh8h9S7qDxzELUioYQf4vgyHaxU0x5NdZ0k23iHTBetm-LxOIoOwBKzt0z-974tq9qIGaZWLOttZnwQyvl4Y-NY46I-59z3NP-12fkNPaX-mFI3UpXoQRZkgFm9_5tGDUIUI8v6kdY4z0jRWpNF1oah5Ak3C9fpUF_xrCbudHCM7f25ih-Lp5QIxzW-tRkh3sqLJqs6cTZko81Fs0y-djGLrJLTNdPc7qVs_M5Yw3Z14SefIQDS8gY6qfUpME2IFCMpmEBR-3yGAQR9uyf6GG8gafrfYRoW31ERHR3MjuNBKJOzA9geLrIiIbwGzdEoFgFCMwyOQIZyP_PNQW_YKJ8DwHtQv3xBzJ3Xy5X49u1KI-4d-Y2fBkDErC79j62KeflcyRwBnw0JWmQw0d-hd12SJUydeqVZqsewB60qG8xY75W8TG90FWfseiyqzPmocJwVdsYsgxxRLDv2967SuswaVFTEf8z5ZWhAAS3o3FsWt8FgNqtBpd5tNJXshG9R0yG3xt6Z6q7Tx-FdtnD7g4YXcU-PHt_Ocy2PJWEx25MeUqm2REJm8Z3mGBjtOCLufEsIij-LMU0BAmygcIm33bt1nOTaidoc602admKA5pnpAV7LAZVJpTZTUDld9-Qh4PmJc-uDMOg3Cin5W7INueo0sLaWGexsfJ-sCf8bVEwTxr7yQQv9GOxiuzbHwR_NMwyWRqgpU0UdN_3HFCUYCV3WKp41pM8KuqX5MnccIJ8vHt9bq5mU0Qka13kBhsbbATT-aaS_UMKfJqu8axLWSEcIUvFT7PmTvFezqK2ticKufIyJFNOv8uNet063uWedYmcctqdtFi5wR6cHtUMASU-eqM6vMj-WYNEC9cQMudsRVHSqMzNOtZ9qMSDmSiqHiUf02p7pQc6LYpF7KyL_dwTv4hBT1Xu1TBoQHZ_mm1ur7OGhwUqcYds98hq1qaC-uNy3Ovp_loJ-Im2AWSlM0JD6nTtReCN4HUus0-HLs7fFJlXYSWd75OeesN3Fe7YS6bFtBeUqGInAOugmyL9iGi93Q41Wu6XZnvS8oZtpVKYws-OotWoDYdPBBwzxZsRsqC_zbxTKX7J8csRKkgREDNoDquUWzPt745trJ4rSPCr-5fdprQcS-RtOlfI8yqx1epSqn1mwT2XpN9ygTg7H4jfcDgbYmHbdZwjARypV_86YgnhvDollHea2vy9x9eRwJheQpxEoDwnaywbyJoVbpxbhMYQ-POpsEwe9Vij7KohhbEMHTGvk-Z8xaLinxrihrpLmY9UTiMoh1WCFo30BcF5h0Q-3YJj75pyWCPRc2AQ6Je0KOL57ZbCsjYmDv9ZEA5vIQbsNcqy4Rj_SpH6XynkwKlLlEH-calPOZkT4vatMuN6ayHWaLA784EKmFG4DPh_H-yc7BEL0Z4Wd896VQSSV3c-7ww59vd23owd3qAtn2frsXS3F477Ihep_b6u1tSDlsM3L_4lpeL5vkLqDdnf3uu1a7kJpwERaSnCksIsjUoSjjZLmYuu-hP_WawQBmxt88pB0wbgTKDWKX9VI9gtS4dqZing40Q7Afr2Pj5d7rnaSb1KorKqSgUprCIxqrbFzP1sQd6nrJdjGOyfUAqDdOXl1zdkhxwg9lTLvySHzyPaEobXvAjTGxajiNjoWRqPhIvUUXCPROI5ZsiSAUBtc-b_d2whL_Kh4AEl7Dm6nXp_zVsPzZwjn720fVT34MGn6MvfApno_qBZQ0mPzJ1XKNI5HmlTqpiGZx5zIB3Dpc43UI2OtkNtiFjmBcWEgwnt9QYYNqJ4pL0oYE-YlpsCjzh7TAhcGQ_5h30CLrKB2N70wD5HYolnXgoxTFZWc-aBIBQ8hxo_ooXQV1aAkollYoqkG_OLNtJfb36tc_Xy27YDN90ejdGJkEi-hVjcJxpwqh0vEiFzUP2ErwnpSdhCD5Hb1tNtsgBdqA8PCV1MI20Gt4ugTnxzOxUA_L1w4A8zmSA68286auEUHxORtgDwKGRXFvwG0KeJyEGC6YHhxh4wGbgmpT2un8JTEUUt6z81O8C0ldAVWwJJWgFOqApQuM4Do8i-eB_3rT4bP8igybeGPRGPoJMQhOIvY_YRRAtOAM30RtRA8BJN8UfdGL17FH64XDtwKaLBIT7XZZLedxmBWLPEtDRSyPKUi_mul9MhvlCcA8lrLY9hlBQkrFddiku0j-WuVIH4-Hl9vSy8ROVp-uXgwvjK7ZuNu5KLQ4yCbTK6T9ORe2xfX6Y-Df-YSTAz_EkLSddpFP21A81LuQAiAtrQI_etbYyhNjP1usEm6e9IajeTVkO-taQja93s2QXRHiVGYEbG2EbTqLjHoVOCm8wLdwfXQ5YZv7Ez3e2Q6Lywn57FwL5Iw8ts7iIxczVleCPm8yzJMJIRd2k7C-JAayS8IuhnyN2CMWOM3bK7yd4G8g-ObBBwn386_I77agz3cE6sFK38b5dVWVCt3DTG9HZouF6OpanhqZ0eQ_o6FqPvu4DM46YygT2x8HvV4CeOqe1pbCgDbSF8pG8OT6AbGwAja5D4Gb_1Pifut-2rFYuhsmvpfVizpRNQ9NKZRA-FMg7teSTywbzF3w31VhTLRRoQFBI_kLh7GUyZi7I75tCvZGomvYg0AlRUmRYCXD4ukSHGQ6pq4KqwK2LVeKTp03F-2eGv13BZWVTUsEcWFhDSN8cvg8zTyuZ0XMeTRt0GHN-b51DJjR5IwvFv6c1LyYp7JMT5fMaiFee948qgWR2cpzVzRGTXUA7dUO5ZIzKLEmNsocxm7c1oUXaukWfQSBA5MReyhWRCMumMtXFRWcB6pl5MVgUiXOeIvfMKDtFabNs5-dQfbxQFQamt_udiVBzmRYqyPQyOTI4UJRka60QKYYd9faY7sRNITEw0GgCrzUZ_gJBs-KMQAlFgOkKzkcxqpYgUsPqk6defNWmRNd5TTqF0p5jrUUp47YkWA8zMzaSc7habeAF8UFgTpStXzKnmKmtErjF0DkR0t-Vl2AJdPKt5VjiwaEELEKnkU4HEzPUPeRkeNfPe_8-ifwwScKUKYJ1NN_p4Mn8nN1Mm55cByg1ZHx0ZAM6EJKhYO5EOE8xjJWRlsWun520Co5E_JVwSXwiRLHdkRNZZczq2MBFTFllNLSTaEwKZL4HKeLYN83BOW_9ms5benfYuVLZMTgf4rWLIX_VsnE-6CI6AgQOM3vQltEZp2KDG_f8Y2CDd6bhz1I1UNd9WSGeS_vkUz_RXMXtENTA1lKkjcuwVTtOzzasdfhVf_CpaFtmzmaKPueB7gHer6__obz-SRlSPI3j_hRdMkgWIBAIE3UvmjgcY9UHuH92oGIAmI2cd21Niln1B38KiDF8ZLJ7rA5psDRprd7XnEOvMRwY-7hDERckhRsZC5zZK-wiEKjQkbzEjJS9G5hTyJmXnbSTVxnZk7EjnEtJrkmfRRccZyvo3opUl4tqo-tJuXqbayHMHDzC1aM2aQ4vEskuYp2H-_Ucr6fs4JuwSSTJI02e-RzvT5sfwSBw0aAxnrt0j5F8U0QtsyXiIe4bDtNJrPrLt-h_gDCAeJ-bb5pHYARmjieX4WScjd1Psruoq2bkFglaok2Yspvoz8pjiQ90xwb52aVZatt_Rad64ndEO3JCBOnQSYfogZziZhtl4eKoAP9ZyCjud8AuOtMdGg5rIuiXK-yqbeEjz3LN1OiHBqks-zSsAqhSmwfb8-csnS6HjC2loez38KEdAZ1fXKu9LuS6WWHL1TKoYV60jqG_8tbx_oWslbyMx8iYmzn6kHUT1cuWNKiDVvOHFGEoNxMDciUvUzbBH9LN52bFBcr8io2iv_lxPthahuVxr-e20eg3H3Dl0BIQ9hJ33GdJ6dhAV1-3eKag7_AJYQzzZP1bPbZzgDOMZdiA45JgkbPEDVgjKpDCgdww2TODTWcI3QhU-CtRMMgDqKfk_mHZM6Fs9kI4Sy220YEAlhgKn1AzoygucnGf-V8jOkyeZ48CW0015ETHZtbnRpUuwOfh2i8Q26_O1vTbdL3_32cP3xc55duV-OsIreenGmIW3ZFKtpVixdQfuWNOD2eljji4dy78JY5uJ7tJT_hNpnUJH_wCiGIzdGuZ8I9PG3c1hXTcUDFu11nb9wfsDmVLIMRF-rXlZB2WIl75fjJjcwIoJs1KfqLrCCWC49iQWRjdaLMYkXVmk4JfUGVLXnOrAoLP8TxhuNn-y5S3KNObzqMDdkbmS9PzTW8nfwGijmlUmP6OzB_5CTokO0nPEnyc0PoKynLMgMqG-EBHZVDx9cdssza_gi6jTDdbNo2Vx5TFfK76Dy6Gv-e2KNSnLkjBuc4hU_HsZDM2u7CEq4d-uBGoMSJDehf1UHHFoqA6USk2yoqLDj3hbWRg2syhmzpJ_mimCD34wctbqqvjMmSN8Cega3LT5q2zTmlzJgCUlT1CPpQ4L8EswsTuWTky-Mk3wh5qgDZVV-NHYRxkR9esIaPmvL709lap4AyU7lGeWszKoc5VjO_1hKJNrQDI9t4lW-HbPRzCBk3Tp7rGMb5ZfkSehjadvhEBV5BPQojUURESEhKzW2LV6i-9dycPjgEfPSrUJhlOOLsxkiMb4kSgix2oHLfxXst6gzGxArFDuGITN20O5TJQZ3TPsIM-OeYH2UkF7SNvtt_vk7E-Uzo3JkCKcQph-zU8ySnQgqr7HRxManN77d2EsxpV9EYJOCst78CYS1Wru9S2aPxlUey104bqF87aWzw6pILhmCjX3UL967pGLG_YBzuTFREdO3GX2E1T27hHa518DECVkbmTCzabN2SGoslDGaoTun9TbHGpEafB3Oeec3L7m4rei99wAIp4XepcHgMEiikc069abfqHZSdTMW4tT1137Rvz4hbNj2I8WfrWqvNr6aQXnsRFsHbdco-5e2M7YJ_FNsnwrNWlHT8fNWZrW5jGZQuw1lyrIy3PzQrHA-IgyhrqN4oDuN0jphHiawgAthFq1e1sNDRZe64iWUcMd1OM05G3p2KtdcHZVWzC-83hKWPOdiBRD8QkGnrOs_g0ivXdhV3Qhle7IHPJe9ZCkz-Pc5r04znZrDf5dQSPnXfKCu3T4aLTue33B3l3ruHrMzfqo0dqB2Vw2TfoodfDufUCoH0Htr21JE7IpPi99J-eDzkfmEMdYmPzVXbsNbie-oK7g3SvWMOwSn_KVpbD1BE3bCKDMHqkZNsiKDFDWCIwh64WmNNp2QmHdAXQCpQyHLdVPvi52sV8lIHkSX5OhHn2FC1oyZKteL6YeBTRYRExqsJalVzWGvlz_8Z8vxqhH4s1ruNhnMz_aCDGdDPtVegfVzB5EmXuP37y_TMSchjrBs17fPdk_6jEEX694S9JIOFT8s4sYb6IP5KezgTdHbWpWdwbuG_X6RLGThCMKSUm7UyDfKb3HHIbPmiRHtXNpR3NTOPNanl-I2cKVwI3DB7YTDiaT4hhRj-21_UQTrrjU6n1ZDpimRgT40Zd9bLPiKdgde3tT5zcPsyIN5ksG3XMiOPcyD11ekfAe87Nt8XIO3KN2mcBXqqnnYgVc3g8JUKC3-GJq0B21_MX8AfBcup7GgCJ2oanGV1pZHv9yw-dA3H1ZfLVaoxfnl8TasPuPqIc06-vjvLn8L_YnVqLXAXC-pZK0TXgNzpB-eGobyBgAXBID8_rJvVX4znUpE3YdGqxWLCCYOjHPTXZ14FwU_62yCNRvozcTCC63VfBqYXs-JsovIHe5mz_NkFV-KeOg-7svJ9MUUNqZLUp7z9v6E5JstBYSxDBYHJB4sLboU0ytKJzCV8u37wNwtSCuw2ZqMdfFgc7xVRBEYNrKz9VSfGFxmkXI_lG2kUFEPEGmXDBqyee3mc3C53sMLdVksNHiWpbifXlzRN_brcs6JjzNYU2FxdPnlOKk9XBRmD68nHhjyUMSA53nS9HqN7b005qhamP73whpxEzHs_HaDsirPneHFmEE52m1xv3uP077JDVAxTX4M6Vsh9L5qwvlF1KgjhhSb5m6sR3Z6JHMc9cjvyRjPwKoiOSKBF63oXfcurOyKvUAab3_QBolsFJ1cd9PMJF050pdlqpvePnA8K4XawuFUaS9tIkVMUrQ2XbBwdW4QnwjvDP5IvWg2MScqLwBRhiBFmOr1h_9E34uWr9GTn3IYuhaTtyREVyIgvLnkqBKZc-dq-SfMJQKaG03xHKPgrqIKRaVqEyQqTsOj2kF2udKst9lGajko1pIaugJ1SKa9noknW3tk7xQrj3FVEM_8LjVIsiHnz5DMfjOREgm4-Esl5SL8gac0BmTFlD-6ekLP8aVxdXLwFA61cNWYMmF4ogFp9xaObN-YKFLnRgeYLLuzQ28-FvRJGgv1UVWTxR3Dl-iKfiXSJVZXRRz5utKrDjcKslBBLeaLUqiXyuSldNhMRJE9I8XzjcG1TemBa1Kn2GcMQdfrxOtqBYhOrc1fFwT5rFhjgxX6AsJB1rHjHIfGUj1TVQyxz_UXcRsGVm1ZVZxCuaQJd35Z2N-wMxoMgYMygT-C1RWgVgiLjR5oW78xzfeflW17G7FAh1-S02Ebbv9crC_4c8HvS_5c3hAH1nfs0vzozjWPtSDWK_fGnda2bEOzy2GBCE3DRLEotF3toB2wLTaREI0AU8fxulKA4PzIXSO7GNnRP86vzSch_Q1UacdkG8u3HVsWsGSvxtH2SoF8WTvPUE2Ze1v_yTteySAEZlPJiVQ8UiBAipvtEFraubpBJ0Ulmn2KQk8E7PxqvmoYTRuqleGcY4VzuA2o1USpf67j7lybTJOfyeOC0aiHdoNx7hcfgdot1iyJg2Fq1SYQvNnN_X-wXMYKyPPuBQRUR2WB4CHJaEqU01Ip-QnGExrvdiqwWENvEMj-TsFA6n3-MGCWANQO3OGIH3klFhar1_9YG1IikEqqvaFu0wQeqYsOyTRjGr5dmRBEVQK5Tu9uSqtOKfB-1mwXa39XBTR9dwC1GZZgYZ_AsYhjP_w7FsQlEkxLyd1zNAKKuLLWQMH6X7-bbDYDgN16kff8tE2GqsOPB38WsH-Gmleuqbom03jPJI9Diw0P2oWgPA-6_Ov6Hm8tLWhXCj6uRbD55PakuRRqEHQjPGDNrk4atlqeD4Oe6UZqXPmTTL8r1grUYpV5OIV3mjU8ypV6RQYMm3tTOpo6RXcwIcHvAXPe6cg-ksIySctMj9XRhLCVTTtg-2WHot6oHqizmIpgU1OP_Ak3q7Rw9LYDdYzMZUjw69JoSen7-N-RtjF1Az3XOFK6dyGtH4sXfKlFb8NSC2OtbbakzsKkEUG2ffmavOv-r71t4rGhlVD_ArgscyptvjcdF7S8qZ-7_gQCZOapP73KGipzUAQbV3V8b4mA98qQ9fUr2Wne9KTu7d7lbJd8d6MDK361CLmRnMxeC10rhyBpbs0rv26mqjBKyPNgTO6zL-bYtlC-MdUZa0h-A1sCWQOrggwKbC7Llw0nWpoHZyIh7E7rVZtsO3qTbKSADKfQTfy8TDZzYlpade1zkzbEGkDrlfuRHN4xuI4h8fgxIwGwQcZpfK4Z0mVwF7RDrNVOxWTy9ctIpfjkNdUvtZzXnSkDlTzbvBgDQeWhEbCyTHqSUKCfeVk3ac1zkd5GZJqqfteMPDpnAY2KJUa7vz5k0RgDNAj25-jIl2TWN5sa8FS_9XP6QgnmsSDJ4IfwiWZn8BsaJefjKSpUheTWM7fU0fLfyoRv6naUiVM0sUPkTWYRBQWKRGNOj9d6Tv4I2OwofuKIo8QJlqwnX0iBFkXc8xl0ZWgNBI_lfHWMrWNUGHJMx6BV3mCgl64inTF65V52R04O-WWYA28Q6PId106NTHFkfnCgO40AHcg6SC0WdC6RX7PzEUCHWezS9jQ1lgH9Vg-xhOGVbH6ZZG3wbZYKI5wPg_OytxuwV3r8XWevXzZLA2-tg2asAQY7Oe-l1qhXnIYD05VuarfGk0nLhqa1qaQd4rTlG4a-3crAz8UFyvKJ3eilAz9hSVOD2iGDLZ0itZlPbLtJBvUxAsUvvke6tKVKgiX8Rh3fQZZvdUozlwW3Nr58giTYW73NkPko3EqXVdra5zSikUa-G_EIbGS7C-WOXz7LsoqSg8j3xiZW0gpZ6eXaFItdainHFDDxMm1-JhD1N_5xQi6hbEsBnAgzHAb450fNO_bxsFh2GFvWeghwOHCax9mWlaP7uke93vjG29R_esSatHJVxQFXF1ahPfh0PwXtVj8cEBiid-fAuVrZKeTTAFHa3ZwFI9tqFSYwcG659fu2yuZWgThzm5uefjXbZbGQVo_DBzChnm39XF_TNIbZSinFfixjJ3RFpxjrg9SOnFX2D2hP986IU-bXPiOvVLnOMOvjhKvYfqkT6w_0T3CuUxjB4Pg2vje1_dn5JMq0qOBMfIb21vwojf7lJ8W-_FQ2Y9r1c3uxRDtFpRFWMpxqv7hcxEtA7S5StiA-vtOD-qxsefjxumL8yeGoR22l18UQVBovwc-fNncuvGB5mcWgudXXhyXGGt42EP4-Q4LA8SL_9QQk-yqd47O-10NdywHnH3ZLVNdESNfzGtmUH1zKjboIJqljvQgKkzQH6xvqdEIHmNNNquRPxWdtGK1YV5PoIUIqwyDk_Hwi6gyHUJNBE3In67DObrteBPb9Ug8fX67vPb42gJ4_SyODiMnMwmYLxG5P1xNO2V8W0pDWj8u9x8w0dOfcZaWPS7LT1UPXIE7nWLPDhuQtTbZ8FmlmOE52ScPButLWmR6vTkfDENsrNLlw8xYmA30sh_UJq4PXTgRFElmVNUsPqaendN_08bdw6X42pjs1Ip4XbrhEVvlpcyYklU-Z2oKJ-NkJQCgn-tQt_i8SP_vsp9TN4sxmTBSxp-ZQ-Gu5G-Mgdxry-wPoMWMwQquXoVfXrH37fywIBvTNonfbMkImpIsAxOxUHiGCXfDBkxCzOKvgNUEW-fA_yI71iaP_k9fTa3Uo4SXAHjH6HRg3l6QRGh5-cByIRFLdFkehd4M3Na7Lri9tDcYbZa2z0C3Wnt8Of3M-qEY732N_DatxKk5mBfM9Os0wi9MC8itOExrOmKKIj2OobWTmXE7XHKTLddqmyKynRgMzENCpjIah_0hdc3NShMHRwe2VhXDITh0-SHbaLBfONUrI_uXTpTSYBizniGovk7YZ7Dy0iL5Puq3NNtBMvCpnPZBBukPx-Vd37erNecKMGl6kYnmlvTyQqhBar3oa5eU-BtxSLBSucMeWcd-WNNK0SenOHlGRWv_lGkc9sMFFd3oWsHGwuXxPLyEoSYTeN3eAufJ0yUYloC98Mh3-p3hJOk_DgRsRWB_LACcdd6UGZs2o7oyL1y9RAz9JsqgqICua_BvN0ClBZ55IA1KjZDLORBEWu-clwy7kqLtVsAljlopI27r4rFULlhm2dKbGLZVarpcV9JDME1FbtOaiy4duPdhEMbDWXz98casWLXSzrJxH96X9zKaJdkUnjYiftCiwilh-Zj3yc3L0JN5oNQPH8kigDdKOp7_GYdRB6jQj3lTdPUfFcJ6pFpLmztlS5Iskr950PPu4lj7MPG5MB7uvnaYzRrccaIrI3g6KwGiB3ebHdBPAjKESPHChr9Nb5nYyfiXhObCf1afnosvBwGbF2XjhwCNUjocKTFAKG5ItrTAX6ZTi9xfd_BgdnDcr4M5twMSdZH8v5hkV052yfYG-I93OaEp-PrgeEJn4j-fuxMBQSvAZPEF2XQqEoRY192oF1lOukOoqaC-pXwO_1GTw8FhZLIQRxH68U0z3m0r3wurSHylfuVKC-kUdCDr9bpV-5RXSWLOnj2acckwEA0_qZWA5y-i93G1Mism5Wqh8-DejHtxB7hSkSJ4-ov-Rcc7LbN-xGu2lgCPp3NKvt5pbe2Cb_9154ujc1_abK_Er_nrjxzlS7eWHys8atR2hzxL8HvfoFx-NZCHuIB8MUfvXR0MvJ67-e8fLsFlyd7qCRpGtyA5y-9NvzrSvyMemcY6YGVyRN4uJrcnEP9JNtjoR9zEivzY3eT9D4CZ6UwIYZE-3Gk3s9hNH0_FPoB8g2p1_-7L3CzSuy1a0zsCo3LVX6DjHu8oI4_mL4w4iHmbcd1qjnyNGZ9-ty6uJehEPauDH5IRTibtGbgDlbO1gemA0ekhPCierg39Joi0tCKBdhEJ8XkO8XsFKiGfCGH451farY4cGPwzCjHyldX8xIPG5IWZveMvI2bb4RMBLB9Yc16u5tOGEoElYEUsp_RzsSefXXtzKD335Mu9H8KYWlxfOlhwc8mmc4MTpOZc9YiapwBiuFz4Uso8R0UXNldLCueeB4csCNx6otpcEsJrfjqhQg7d9KVRToFUb2NRC6qP07_TwPj1Sw1U9lpuebWQvs8_raqI5biVSOzUdF2mtyxcMh2wsAaovlY0D40U57vyswhg1LLYj2EOcxlGQEHI3PjJmusRW36cW0PGXm2_ovD1W2_EmEZXpNYRxVcZ_U4vK-mMTa0-_bO1KLvQROLQ-QsmNGBX9-rsAFEjh8siTYrMrnym1XE2n0ibGvuH1bp9gy27ZGLXkkVP15-zjRFeTmVtm_T1pmgZm_8Q3aJXwbOgowwLh7E7Knmbs9ZZrhuKxwH26tIMOPLazbgHiAF3vrIwXYAJONcgTRxQJneGbLZ2b80h7UxuU9eGxyE2KZTmMFBidgYaQokn6LuA7eTq3xXVccQ7l3VpKps_UvOFEoOBzrNcXUOB-0Zj2hNj515n6kPScmNVF8C5WpqnhNdzhIym-omhyEzYv8hKUstQObtabUAO0qXz7qKQFHRB4mnkiVGcP) walks through every
built-in template and the raw-shape system, each with its source. Run
`sdoc slides` for the DSL reference and `sdoc slides list` for the templates.
