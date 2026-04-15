---
title: "SDocs — Privacy & Terms"
styles:
  fontFamily: "Inter"
  baseFontSize: 15
  lineHeight: 1.65
  headers: { scale: 1.0, marginBottom: 0.45 }
  h1: { fontSize: 2.0, fontWeight: 700 }
  h2: { fontSize: 1.3, fontWeight: 600 }
  h3: { fontSize: 1.05, fontWeight: 600 }
  p: { marginBottom: 0.95 }
  link: { decoration: "underline" }
---

# Privacy Policy

**Last updated:** 15 April 2026

SDocs (sdocs.dev) is operated by **Odd Solutions Ltd**, a company registered in England & Wales (company number 16186575). References to "we", "us", or "our" in this policy mean Odd Solutions Ltd. References to "you" mean the individual using SDocs.

Contact: [hi@sdocs.dev](mailto:hi@sdocs.dev).

## Summary

- Your document content never reaches our servers. It lives in your browser and in URL hash fragments that browsers never transmit.
- We do not use any third-party analytics provider.
- We do not store anything that identifies you individually — no IP address, no cookie, no login, no device fingerprint.
- We do store a small amount of coarse, aggregate data per visit — the week you first arrived, the current week, and bucketed values for device (desktop / mobile / tablet), browser family, and referrer category. None of these single you out; millions of visitors share the same values.

## 1. What we do not collect

When you use SDocs, we do not collect, store, or transmit:

- The content of the markdown documents you open, edit, share, or export.
- Your name, email, or any other identifying information (you never create an account).
- Your IP address (it reaches our web server in transit as part of standard HTTP but is never written to disk).
- Any persistent tracking identifier (cookie, fingerprint, or advertising ID).

## 2. What we do collect

On each page load, your browser makes a single background request to our `/version-check` endpoint. This request is used to detect whether the cached version of the app is out of date and to record an anonymous visit. We store, in a local SQLite database:

- **Cohort week** — the ISO week you first visited (e.g. `2026-W15`), read from a single value stored in your browser's localStorage under the key `sdocs_cohort`. This is not a unique identifier; everyone who first arrived in the same week shares the same value.
- **Current week** — the ISO week of the visit.
- **Coarse device label** — desktop / mobile / tablet, parsed from your user-agent header.
- **Browser family** — Chrome / Safari / Firefox / Edge / Opera / other.
- **Coarse referrer** — the referring domain, collapsed into categories (search, github, npm, direct, or the referring host).

No row in this database identifies you. A power user reloading the page fifty times appears as fifty rows.

The aggregated results are published at [sdocs.dev/analytics](https://sdocs.dev/analytics).

## 3. How we use this data

We use the aggregated visit counts as a rough proxy for retention — whether people who discover SDocs keep using it in subsequent weeks. This is the only product signal we rely on. We do not profile, segment, personalise, or sell any of this data.

## 4. Third parties

SDocs loads a small number of assets from third-party content delivery networks. These third parties may receive your IP address and user-agent as part of the standard HTTP request for the asset. They do not receive your document content.

- **Google Fonts** (`fonts.googleapis.com`, `fonts.gstatic.com`) — loads the web font you select for rendering.
- **jsDelivr** (`cdn.jsdelivr.net`) — loads the Chart.js library when a document contains a chart.

If you embed images, links, or other external resources in your markdown, your browser will load them directly from the hosts you reference. We have no visibility into and no control over those requests.

## 5. Cookies and local storage

SDocs does not set cookies.

SDocs writes a single value to your browser's localStorage under the key `sdocs_cohort` (see section 2). You can clear it from your browser's developer tools, use a private browsing window to avoid it being written, or opt out via the button on [sdocs.dev/analytics](https://sdocs.dev/analytics).

## 6. Opting out

To stop being counted in cohort visits: visit [sdocs.dev/analytics](https://sdocs.dev/analytics) and click the opt-out button. Your `sdocs_cohort` value is set to `opt-out`, and all subsequent visits are counted as "Unattributed" with no cohort attribution.

## 7. Your rights under UK GDPR

Because we do not store data that identifies you, there is typically nothing to access, correct, or delete under UK GDPR data-subject rights. If you believe we hold personal data about you, contact [hi@sdocs.dev](mailto:hi@sdocs.dev) and we will respond within 30 days.

You have the right to lodge a complaint with the UK Information Commissioner's Office (ICO) at [ico.org.uk](https://ico.org.uk).

## 8. Open source

SDocs is open source. Its source code is published at [github.com/espressoplease/SDocs](https://github.com/espressoplease/SDocs). You are welcome and encouraged to audit the code to verify the claims in this policy.

## 9. Changes

We may update this policy from time to time. The "Last updated" date above reflects the most recent change. Material changes will be noted in the repository commit history, which is part of the public record.

---

# Terms of Service

**Last updated:** 15 April 2026

These Terms of Service ("Terms") govern your use of the SDocs website, CLI, and related services (together, the "Service") operated by **Odd Solutions Ltd** (company number 16186575, registered in England & Wales).

By using the Service you agree to these Terms. If you do not agree, do not use the Service.

## 1. The Service is provided "as is"

The Service is provided on an **"as is"** and **"as available"** basis, without warranties of any kind, whether express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, or non-infringement.

We do not warrant that the Service will be uninterrupted, error-free, secure, or free of harmful components.

The Service is open source (see the Privacy Policy, section 8). You are welcome to inspect, fork, or self-host the code.

## 2. Your content

You retain all rights to any markdown content you create, open, edit, share, or export using SDocs. We have no access to that content (see Privacy Policy, section 1).

You are solely responsible for:

- The content of any document you create, share, export, or distribute using the Service.
- Ensuring that your content does not violate any applicable law, any third party's rights (including copyright, trademark, privacy, or publicity rights), or any other person's reasonable expectations.
- The consequences of sharing any URL generated by the Service, including any URL containing content in its hash fragment.

## 3. Shared links and third-party content

Because document content in SDocs is embedded in the URL hash fragment, anyone you share a URL with will receive whatever content was present when you generated that URL. We have no ability to moderate, review, recall, or take down content that exists only in a URL.

Similarly, any image, link, or other external resource referenced in a document is loaded directly from a third-party host. We do not review, endorse, or accept responsibility for third-party resources, whether embedded in a document by you, by someone sharing a link with you, or by anyone else.

**If you open a shared SDocs link, you are loading content authored by the person who produced that link.** Exercise the same judgement you would with any other external URL.

## 4. Acceptable use

You agree not to use the Service:

- To upload, render, share, or export content that is unlawful, defamatory, obscene, fraudulent, or that infringes anyone's rights.
- To attempt to exploit, probe, or damage the Service or any related infrastructure.
- To distribute malware, phishing content, or any content intended to harm readers.
- To reverse-engineer the Service for the purpose of building a competing commercial product (this does not restrict fair use of the open-source code under its licence).

## 5. Limitation of liability

To the fullest extent permitted by applicable law, Odd Solutions Ltd, its directors, employees, and contractors will not be liable for any indirect, incidental, consequential, special, exemplary, or punitive damages, or any loss of profits, revenue, data, goodwill, or other intangible losses, arising out of or relating to your use of or inability to use the Service — even if we have been advised of the possibility of such damages.

In any case, our total aggregate liability to you in connection with the Service, in contract, tort, or otherwise, will not exceed **zero pounds sterling (£0)**. The Service is provided to you free of charge and we accept no monetary liability for any loss or damage arising from its use.

Nothing in these Terms excludes or limits liability that cannot be excluded or limited under applicable law, including liability for death or personal injury caused by our negligence, for fraud, or for fraudulent misrepresentation.

## 6. Indemnification

You agree to indemnify and hold harmless Odd Solutions Ltd, its directors, employees, and contractors from any claim, demand, loss, liability, damages, or expenses (including reasonable legal fees) arising out of:

- Your content, including anything you share, export, or render using the Service.
- Your violation of these Terms.
- Your violation of any right of any third party, including intellectual property, privacy, and publicity rights.

## 7. Changes to the Service

We may modify, suspend, or discontinue the Service (or any part of it) at any time, with or without notice. We will not be liable to you or any third party for any such modification, suspension, or discontinuation.

Because the Service is open source, a discontinued version remains available in the public repository.

## 8. Changes to these Terms

We may update these Terms from time to time. The "Last updated" date above reflects the most recent change. Continued use of the Service after changes constitutes acceptance of the revised Terms.

## 9. Governing law

These Terms are governed by the laws of England and Wales. Any dispute arising out of or in connection with these Terms or the Service will be subject to the exclusive jurisdiction of the courts of England and Wales.

## 10. Contact

Questions about these Terms may be directed to [hi@sdocs.dev](mailto:hi@sdocs.dev).

---

Odd Solutions Ltd — registered in England & Wales, company number 16186575.
