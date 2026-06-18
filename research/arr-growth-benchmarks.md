---
title: SaaS ARR Growth Benchmarks for an Investor Pitch
subtitle: Grounded numbers for a developer-facing, product-led document tool
date: 2026-06-18
tags: [research, fundraising, benchmarks]
---

# SaaS ARR Growth Benchmarks

Research pack for an ARR growth model headed into a Series A conversation. Comp set is a developer-facing, product-led (PLG) markdown / document tool.

**How to read the flags:**

- **[HARD]** - published benchmark dataset, S-1 / SEC filing, official press release, or a named executive on record.
- **[REPORTED]** - stated publicly by the company / founder but unaudited (often a founder social post).
- **[EST]** - third-party analyst model (Sacra, getLatka) or a leaked / press estimate.

**The single most important caveat for the whole pack:** almost every 2024-2026 AI-company ARR figure is self-reported run-rate, not audited GAAP recurring revenue. TechCrunch (May 22, 2026) documented that AI startups routinely report *contracted* ARR (CARR, including signed-but-not-live deals) as ARR, and that some firms' contracted figure runs ~70% above real ARR. AI usage / outcomes-based revenue also churns harder than seat-based SaaS, so a $100M run-rate today is less durable than the same number was for a Slack-era company. Do not model your curve off the AI rocket ships as if they were apples-to-apples with a docs tool.

---

## (a) Year-by-year ARR trajectory tables

### T2D3 - Triple, Triple, Double, Double, Double

**[HARD framework / rule-of-thumb]** Origin: Neeraj Agrawal (General Partner, Battery Ventures), "A Mantra for SaaS Success" / "The SaaS Travel Adventure," **TechCrunch, Feb 2015**. Modeled on real top-decile public-company trajectories (Marketo, Omniture, Guidewire, ServiceNow, Workday, Zendesk, Salesforce). It is an aspirational path, not a measured median.

The canonical example starts at **$2M ARR**:

| Year | Move | ARR | YoY |
|---|---|---|---|
| 0 | start | $2M | - |
| 1 | triple | $6M | 3.0x |
| 2 | triple | $18M | 3.0x |
| 3 | double | $36M | 2.0x |
| 4 | double | $72M | 2.0x |
| 5 | double | $144M | 2.0x |

Scaled to a **$1M ARR** start (the version most people quote), the same multipliers give:

| Year | Move | ARR | YoY |
|---|---|---|---|
| 0 | start | $1M | - |
| 1 | triple | $3M | 3.0x |
| 2 | triple | $9M | 3.0x |
| 3 | double | $18M | 2.0x |
| 4 | double | $36M | 2.0x |
| 5 | double | $72M | 2.0x |

> Source: Battery Ventures, https://www.battery.com/blog/helping-entrepreneurs-triple-triple-double-double-double-to-a-billion-dollar-company/

### "Top-decile" path (two credible versions)

**Version 1 - AI-era "Shooting Star" / Q2T3** **[HARD-ish, small sample]** Bessemer, *State of AI 2025*, models AI "Shooting Stars" on a **quadruple, quadruple, triple, triple, triple** path: ~$3M Year 1 to ~$103M Year 4 (~4 years to $100M). Cohort is ~10 surveyed startups, so treat as directional.

| Year | Move | ARR |
|---|---|---|
| 1 | start | $3M |
| 2 | quadruple | $12M |
| 3 | quadruple | $48M |
| 4 | triple* | ~$100M |

\* Bessemer's own rounding; the literal sequence lands a touch above $100M.

**Version 2 - Bessemer "Best" growth-endurance path** **[HARD framework]** Starting from tripling into $1M ARR and retaining 80% of the prior year's growth rate each year ("Best" endurance), a company reaches **$100M ARR in ~6 years**. "Better" (75% retention) is ~7 years; "Good" (70%) is ~12 years. Source: Bessemer, *Scaling to $100 Million* (Sept 21, 2021), https://www.bvp.com/atlas/scaling-to-100-million

**Practical read for your model:** T2D3 (or a slightly gentler version of it) is the credible "ambitious" spine: roughly triple at small ARR, then double. A genuine top-decile / AI-native path front-loads even harder (4x early) but is rarer and, for a free-first docs tool, not the honest comparable - see Notion / Figma / Mintlify below.

---

## (b) Named-company comps: ARR milestones + time taken

### Fastest-to-$100M-ARR ladder (the record has fallen repeatedly)

| Company | $1M -> $100M ARR | Hit $100M | Flag | Source |
|---|---|---|---|---|
| **Lovable** | **~8 months** (current record) | ~Jul 2025 | [REPORTED] CEO on record | TechCrunch, Jul 23 2025; Anton Osika (CEO) |
| **Cursor** (Anysphere) | ~12 months | ~Jan 2025 | [REPORTED] / [EST] | TechCrunch Jun 5 2025; Sacra |
| **Mercor** | ~11 months ($0->$100M) | ~mid-2025 | [REPORTED] | TechCrunch Sep 9 2025 |
| **Wiz** | ~18 months | Aug 2022 | [HARD] | wiz.io blog; TechCrunch Aug 10 2022 |
| **Deel** | ~20 months | Q1 2022 | [HARD-ish] co-founder on record | SaaStr / Shuo Wang |

Wiz is the cleanest **enterprise B2B** hard-data case and the fastest with audited-quality backing. Lovable's ~8 months is self-reported run-rate from a consumer vibe-coding product with open churn questions.

### AI code / app builders (closest "AI-native" comps)

| Company | Launch | ARR ramp | Flag | Source |
|---|---|---|---|---|
| **Cursor** (Anysphere) | Mar 2023 | $100M (Jan 2025) -> $300M (Apr 2025) -> $500M (Jun 2025) -> $1B (Nov 2025) -> $2B (Feb 2026). Doubling ~every 2 months through H1 2025. | [REPORTED]/[EST] | TechCrunch Jun 5 2025; Sacra; Contrary |
| **Lovable** | Jun 2023 (relaunch late 2024) | $5.3M (5 wks) -> $10M (Jan 2025) -> $50M (May 2025) -> $100M (Jul 2025) -> $200M (Nov 2025) -> ~$500M annualized (May 2026) | [REPORTED]/[EST] | Sacra; Lovable blog; TechCrunch Dec 18 2025 |
| **Bolt.new** (StackBlitz) | Oct 3, 2024 | $4M (~1 mo) -> $20M (~2 mo) -> $40M (~Mar 2025). $100M was a projection, not confirmed. | [REPORTED] | Sacra; Growth Unhinged |
| **Replit** | Agent launch Sep 2024 | ~$10M (end 2024) -> $100M (Jun 2025) -> $150M (Aug 2025) -> ~$253M (Oct 2025). $10M->$100M in ~5.5 mo. | [REPORTED]/[EST] | SaaStr; Sacra |
| **v0 / Vercel** | v0 ~early 2024 | Vercel total: $144M (end 2024) -> $200M (May 2025) -> ~$340M run-rate (Mar 2026). v0 ~$42M (Feb 2025). | [EST-Sacra] | Sacra; SaaStr |

### Other AI apps (speed context)

| Company | Founded | ARR ramp | Flag | Source |
|---|---|---|---|---|
| **ElevenLabs** | 2022 | ~$100M (Apr 2025, ~2.5 yrs from $0) -> $200M (Sep 2025) -> $330M (end 2025) | [REPORTED]/[EST] | SaaStr; TechCrunch Jan 13 2026; Sacra |
| **Glean** | - | $100M (early 2025, <3 yrs from launch) -> $200M (Dec 2025) -> $300M (May 2026) | [HARD] press releases | Glean press; Fortune Dec 8 2025; TechCrunch May 28 2026 |
| **Clay** | 2017 | $500K (2022) -> ~$5M (2023) -> $30M (2024) -> $100M (Nov 2025). $1M->$100M in ~2 yrs after 6 yrs of groundwork. | [REPORTED]/[EST] | Clay blog; Sacra |
| **Harvey** | 2022 | $50M (end 2024) -> $100M (Aug 2025, ~3 yrs) -> ~$195M (end 2025) | [HARD] CNBC | CNBC Aug 4 2025; Sacra |
| **Sierra** (Bret Taylor) | ~early 2024 | $100M ARR in ~21 months / 7 quarters (Nov 2025) | [HARD] | sierra.ai blog; TechCrunch Nov 21 2025 |
| **Decagon** | Aug 2023 | "eight figures" in ~1 yr -> ~$35M (Oct 2025, 4x YoY). No $100M yet. | [EST] | Sacra |
| **Granola** (AI notes) | - | No public ARR. Quarterly revenue +250% before Series C; $1.5B valuation (Mar 2026). | [HARD] valuation only | TechCrunch Mar 25 2026 |
| **Retool** | - | ~$90M (2023/24) -> ~$120M (Oct 2025, Sacra). Slower, mature grower. | [EST] | Sacra; getLatka |

### Early-ramp PLG comps - the honest analogues for a free-first docs tool

These matter more than the AI rocket ships for a markdown / document tool that grows organically.

| Company | Launch | Early ARR ramp | Flag | Source |
|---|---|---|---|---|
| **Notion** | Mar 2016 (public); 2.0 Mar 2018 | ~$3M (2019, ~3 yrs post-launch) -> $13M (2020) -> $31M (2021) -> $67M (2022) -> ~$600M (2025) | [REPORTED]/[EST] | Jason Lemkin / SaaStr; getLatka |
| **Figma** | Sep 2016 (public); monetize 2017 | ~$700K (2017) -> $4M (2018) -> $25M (2019) -> $75M (2020) -> $200M (2021) -> ~$820M rev / $1B run-rate (2025 S-1) | [REPORTED] early; [HARD] 2025 S-1 | Growth Case Studies; Figma S-1 |
| **Mintlify** (docs-as-code, direct comp) | - | $1M (end 2024) -> $10M (end 2025, 10x). 150% NRR, 10,000+ companies. | [EST]/[REPORTED] | Sacra; Mintlify 2025 review |
| **Linear** (issue tracking, dev PLG) | - | $8.4M (2023) -> ~$20M+ profitable (mid-2025). ($100M is a shakier getLatka estimate.) | [EST]/[REPORTED] | TechCrunch Jun 10 2025; Sacra |

**The Notion shape is the key reference:** ~3 years from public launch to only ~$3M ARR (slow, free-distribution-led burn), then ~10x over the next two years once monetization kicked in. **Mintlify's $1M -> $10M in a year** is the closest direct-category data point you have. **Obsidian, Typora, Coda, GitBook, HashNode**: no public ARR data exists - don't cite numbers for these.

### Historical hard-data comparators (pre-AI baseline)

| Company | Time to ~$100M ARR | Flag | Source |
|---|---|---|---|
| **Slack** | ~2.5 yrs (summer 2016) | [REPORTED] | Medium / SaaStr lore |
| **Snowflake** | ~4-5 yrs from public launch | [HARD] S-1 | Snowflake S-1 |
| **Datadog** | ~7 yrs | [HARD] filings | SaaStr; SEC 8-Ks |
| **Twilio** | ~8 yrs to ~$330M | [REPORTED] | SaaStr |

---

## (c) Growth-rate-by-stage benchmarks

### Time-to-milestone distributions [HARD DATA]

**ChartMogul** *SaaS Growth Report* (2023, restated 2025), aggregated across thousands of tracked SaaS companies. Survivorship-biased (measures companies that reached the milestone):

| Milestone | Best-in-class | Top quartile | Median |
|---|---|---|---|
| first revenue -> **$1M ARR** | ~9 months | - | ~2 yrs 9 mo |
| first revenue -> **$10M ARR** | ~2 yrs 9 mo | ~4 yrs | ~5 yrs |

Survival context (same source): ~half of SaaS startups reach $1M ARR within 10 years; only ~1 in 10 reach $10M; ~1 in 50 reach $25M.

**Bessemer** *State of the Cloud 2024* (Cloud 100 cohort) [HARD]:

- Average Cloud 100 company reached **$100M ARR ("Centaur") in ~7.5 years**, down from ~10 years for the 2016 cohort.
- AI-native companies averaged **~5.7 years to $100M**.
- "Shooting Star" archetype: $3M -> $100M over ~4 years.

### YoY growth by ARR stage [HARD DATA]

**Emergence Capital** *Beyond Benchmarks 2024* (via SaaStr / Jason Lemkin, May 2024), 664-800 VC-backed B2B startups:

| ARR stage | Top quartile YoY | Median YoY |
|---|---|---|
| $1M-$5M | 100% | 53% |
| $5M-$20M | 58% | 29% |
| $20M-$50M | 38% | -7% (median shrinking) |

Lemkin's gloss: VCs typically want **top-decile (~100%+ at $10M ARR)** to fund the next round; ~80% of VC-backed startups aren't growing fast enough to raise.

**Bessemer** *Scaling to $100M* average growth by ARR band [HARD]:

| ARR band | Average YoY growth |
|---|---|
| $1-10M | ~200% |
| $10-25M | ~115% |
| $50-100M | ~60% |
| $100M+ | ~60% |

### Growth decay: the Mendoza Line + growth endurance

**Correction worth noting:** the **Mendoza Line is a Scale Venture Partners concept (Rory O'Driscoll), not Bessemer.** Bessemer owns the parallel "growth endurance" framing. Both describe the same phenomenon - growth rate decays as you scale - measured on different cohorts.

**Mendoza Line [HARD framework on HARD data]** - Scale VP, "Understanding the Mendoza Line for SaaS Growth" (May 2018; updated 2024):

- Definition: the minimum growth trajectory that keeps you credibly on an IPO path - originally **reach $100M ARR while still growing >=25% the next year** (2024 update raised the bar to ~$250M ARR at 25% growth with a path to profitability).
- Growth-persistence input: each year's growth is **80-85% of the prior year's**; the model uses **82%**, derived from 44 public SaaS comps over 5 years (R^2 ~0.75).
- Text-confirmed anchor: at **$10M ARR you need ~77% forward growth** to stay on the line.

**Growth Endurance [HARD framework]** - Bessemer, *Scaling to $100M*:

- The rate you *retain* of last year's growth rate. Growth decays ~30%/yr, so ~70% retained.
- **Good / Better / Best = 70% / 75% / 80%** endurance (~70% private cloud, ~80% public best-in-class).
- Implication: tripling into $1M then holding "Best" (80%) -> $100M in ~6 years; "Better" -> ~7; "Good" -> ~12.

### Series A bar + efficiency metrics (2024-2026)

**ARR to raise a Series A [HARD - Carta]** (Peter Walker, Carta, Q2 2025, covering 2024 data):

- Median ARR to raise Series A: **~$3M** (up from ~$1M in 2021). "The new Series A bar is $3M ARR."
- Only **~20% of seed companies reach Series A**; median seed -> A takes **~2.1 years**.
- AI Series A median pre-money ~$84M (~2x non-AI); overall median hit an all-time-high ~$49M in Q3 2025.

**Point Nine "SaaS Funding Napkin" 2023 [ESTIMATE / VC rule-of-thumb]:**

- Seed band: ARR $0-$1M, round $1M-$4M, pre-money $5M-$15M.
- Series A band: ARR $0.5M-$2.5M, growth 2-3x YoY, round $6M-$18M, pre-money $25M-$75M.
- Caveat: this Series A ARR band now reads **low** against Carta's ~$3M real-world median. The AI-first napkin (Point Nine, 2024) drops the MRR requirement entirely and notes AI rounds run 20-50% larger.

**Efficiency expectations at Series A [HARD survey data, Benchmarkit / Pavilion 2025]:**

- **NRR / NDR:** <100% is a problem to fix before Series A; >100% baseline; **110%+ is "premium."** Best-in-class PLG land-and-expand reaches **130-150% NDR** (OpenView).
- **Burn multiple** (net burn / net new ARR): **1.0-1.5 healthy, <1.0 strong** (achievable in high-NRR PLG); median struggles >1.6x.
- **CAC payback:** 12-18 mo healthy, <12 mo strong, >18 mo a near-hard-stop; 2024-25 median worsened to ~20 mo.
- **LTV:CAC:** >3:1 expected with proven unit economics by ~$1M+ ARR.
- Bessemer CAC-payback bands: 12-18 mo good, 6-12 mo better, 0-6 mo best.

**PLG-specific signals at Series A [OpenView, Aug 2022 + Bessemer]:**

- Self-serve must work - sign up and reach value "within a couple of minutes"; investors want a **flattening cohort-retention ("smile") curve**.
- Growth bar framed as **">3x" in users and/or revenue**; ARR itself is not mandatory if willingness-to-pay and the monetization story are clear.
- Activation rate 20-40% "normal"; free-to-paid conversion ~5% average; PLG/freemium >2x more likely to grow 100%+ YoY than sales-led.
- **Developer tools show the highest net retention** across Bessemer's portfolio (bottoms-up seat/usage expansion) - a structural tailwind for your category. Caveat: bottoms-up gets you to PMF; $100M+ usually needs an enterprise sales layer on top.

---

## What "ambitious but suitable" looks like for your raise

For a seed / pre-seed PLG developer-facing docs tool going into a Series A conversation:

- **Target ~$2-3M ARR at Series A** (Carta median is ~$3M; the older Point Nine $0.5-2.5M band is now stale on the high end). If you are below that, you compensate with growth rate and PLG signals.
- **Growth spine:** roughly **triple at small ARR** (the T2D3 front half), i.e. ~$1M -> ~$3M -> ~$9M over the first couple of years, then settle toward doubling. Top-quartile at $1-5M ARR is ~100% YoY (Emergence); triple is the ambitious-but-defensible edge of that.
- **PLG proof over raw ARR:** flattening cohort curve, activation 20-40%, NDR trending to 110%+ (130%+ is the dream for a dev tool), burn multiple under ~1.5, CAC payback under ~18 months.
- **Honest comparable curve:** model off **Notion / Mintlify**, not Cursor / Lovable. A free-first markdown tool realistically spends 1-3 years building organic distribution before ARR inflects (Notion was ~$3M ARR three years post-launch), then can 5-10x once monetization lands. Pitching a Lovable-style 8-month-to-$100M curve for a docs tool reads as not credible.

---

## Source index

- Battery Ventures - T2D3 (Neeraj Agrawal, 2015): https://www.battery.com/blog/helping-entrepreneurs-triple-triple-double-double-double-to-a-billion-dollar-company/
- Paul Graham - "Startup = Growth" (Sep 2012): http://www.paulgraham.com/growth.html
- Bessemer - Scaling to $100 Million (Sep 2021): https://www.bvp.com/atlas/scaling-to-100-million
- Bessemer - State of the Cloud 2024: https://www.bvp.com/atlas/state-of-the-cloud-2024
- Bessemer - State of AI 2025: https://www.bvp.com/atlas/the-state-of-ai-2025
- Scale VP - Understanding the Mendoza Line (2018): https://www.scalevp.com/insights/understanding-the-mendoza-line-for-saas-growth/
- Scale VP - Revisiting the Mendoza Line in 2024: https://www.scalevp.com/insights/the-path-from-zero-to-ipo-revisiting-the-mendoza-line-in-2024/
- Emergence Capital Beyond Benchmarks 2024 via SaaStr: https://www.saastr.com/emergence-top-quartile-startups-are-still-growing/
- ChartMogul SaaS Growth Report via SaaStr: https://www.saastr.com/chartmogul-the-best-in-saas-get-to-10m-arr-in-3-years-the-next-best-in-about-5-years/
- Carta - The new Series A bar is $3M ARR (Peter Walker, 2025): https://carta.com/data/series-a-fundraising-q2-2025/
- Point Nine - SaaS Funding Napkin 2023: https://medium.com/point-nine-news/what-does-it-take-to-raise-capital-in-saas-in-2023-56d8f617714
- OpenView - Your Guide to a PLG Series A (Kyle Poyar, Aug 2022): https://openviewpartners.com/blog/your-guide-to-a-plg-series-a/
- Wiz - $100M ARR in 18 months: https://www.wiz.io/blog/100m-arr-in-18-months-wiz-becomes-the-fastest-growing-software-company-ever
- Deel via SaaStr: https://www.saastr.com/the-early-days-how-deel-went-from-1m-to-100m-arr-in-just-20-months/
- Cursor / Anysphere - TechCrunch Jun 2025: https://techcrunch.com/2025/06/05/cursors-anysphere-nabs-9-9b-valuation-soars-past-500m-arr/
- Lovable - TechCrunch Jul 2025: https://techcrunch.com/2025/07/23/eight-months-in-swedish-unicorn-lovable-crosses-the-100m-arr-milestone/
- Bolt.new - Sacra: https://sacra.com/research/bolt-new-at-40m-arr/
- Replit - SaaStr: https://www.saastr.com/100mreplit/
- ElevenLabs - SaaStr: https://www.saastr.com/elevenlabs-from-0-to-300m-arr-in-3-years-why-the-best-ai-b2b-apps-are-exploding/
- Notion early ramp - Jason Lemkin / SaaStr: https://www.saastr.com/notion-and-growing-into-your-10b-valuation-a-masterclass-in-patience/
- Figma S-1 / early ramp: https://growthcasestudies.com/p/figma
- Mintlify - Sacra: https://sacra.com/c/mintlify/
- TechCrunch on inflated AI ARR (May 22, 2026): https://techcrunch.com/2026/05/22/how-vcs-and-founders-use-inflated-arr-to-kingmake-ai-startups/
