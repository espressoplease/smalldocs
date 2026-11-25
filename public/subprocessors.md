---
title: SmallDocs Service Providers
description: Providers involved in hosting, encryption, backups, email, billing, and enquiries.
---

# Service Providers and Subprocessors

**Last updated: 25 November 2026**

Odd Solutions Ltd uses the following providers to operate SmallDocs Cloud and its website. Some providers act as processors on our instructions. Under Stripe Managed Payments, Stripe acts as Merchant of Record and an independent controller for regulated payment, indirect tax, dispute, and fraud-prevention activity.

Odd Solutions Ltd is registered in England and Wales under company number 16186575. Its registered office is 98 Downhills Park Road, London, United Kingdom, N17 6PA. Contact: [hi@smalldocs.org](mailto:hi@smalldocs.org).

| Provider | Purpose | Main processing location or service region | Data involved |
| --- | --- | --- | --- |
| Hetzner Online GmbH | Production compute, network, and local database storage | Nuremberg, Germany | Account records, encrypted Cloud data, unencrypted published public pages, operational metadata, and transient plaintext while an authorised request is processed |
| Amazon Web Services EMEA SARL and affiliates | AWS KMS document-key management and KMS-encrypted S3 backups | `eu-central-1`, Germany | Wrapped encryption keys, encryption context, encrypted database backups, and backup metadata |
| Stripe group companies | Stripe Managed Payments (Merchant of Record): checkout, recurring billing, indirect tax calculation and compliance, invoices, refunds, payment disputes, payment support, and fraud controls | Stripe's global payment infrastructure | Billing name, email, address, tax information, payment method, customer and subscription identifiers, and transaction records |
| Resend, Inc. | Transactional email delivery | Resend's infrastructure and downstream mail delivery network | Recipient email address, subject, authentication or invitation content, billing status notices, and delivery events |
| SmallCRM (`smallcrm.org`) | Business-interest and install-help website contact forms | SmallCRM hosted workspace | Name, email address, company name, and enquiry message submitted via website contact forms (Cloud documents and accounts are not sent to SmallCRM) |

## Optional identity providers

Google or GitHub sign-in is available only when that provider is configured and shown on the sign-in page. If enabled and selected, the provider sends SmallDocs a stable account identifier and verified email address. Email-code sign-in does not use Google or GitHub identity services.

## Public website and browser-side resources

When you load the website or use specific client-side features, your browser contacts the following hosts directly:

- **Google Fonts** (`fonts.googleapis.com`, `fonts.gstatic.com`): selected web fonts.
- **jsDelivr** (`cdn.jsdelivr.net`): on-demand client-side libraries for charts, Mermaid diagrams, KaTeX math, syntax highlighting, PDF/PPTX/DOCX export, export fonts, and the speech-recognition WebAssembly runtime.
- **Hugging Face** (`huggingface.co`): the quantized Whisper speech-recognition model (~100 MB) downloaded directly to your browser if comment voice dictation is prepared. Microphone audio stays on your device and is not sent to Hugging Face or SmallDocs.
- **Cloudflare R2** (`r2.dev`): demo videos displayed on the homepage and shared or published page footers.
- **GitHub** (`raw.githubusercontent.com`): latest independent manifest verification result shown in the open-source trust footer.
- **YouTube** (`youtube-nocookie.com`): privacy-enhanced video player when a document contains a supported video fence.

Those hosts receive normal browser HTTP request data such as an IP address and user-agent. They do not receive Cloud documents from our server. A document can itself refer to an external image or other resource; the reader's browser then contacts the referenced host directly.

## Changes

We will update this page when a provider with access to customer personal data or Cloud content is added or replaced. For a material change affecting paid Cloud use, we will provide notice where required.

Questions about a provider or data-processing agreement can be sent to [hi@smalldocs.org](mailto:hi@smalldocs.org).
