---
title: SmallDocs Service Providers
description: Providers involved in hosting, encryption, backups, email, and billing.
---

# Service Providers and Subprocessors

**Last updated: 24 August 2026**

Odd Solutions Ltd uses the following providers to operate SmallDocs Cloud. Some providers act as processors on our instructions. A provider such as Stripe may also act as an independent controller for parts of its regulated payment service.

Odd Solutions Ltd is registered in England and Wales under company number 16186575. Its registered office is 98 Downhills Park Road, London, United Kingdom, N17 6PA. Contact: [hi@smalldocs.org](mailto:hi@smalldocs.org).

| Provider | Purpose | Main processing location or service region | Data involved |
| --- | --- | --- | --- |
| Hetzner Online GmbH | Production compute, network, and local database storage | Nuremberg, Germany | Account records, encrypted Cloud data, operational metadata, and transient plaintext while an authorised request is processed |
| Amazon Web Services EMEA SARL and affiliates | AWS KMS document-key management and KMS-encrypted S3 backups | `eu-central-1`, Germany | Wrapped encryption keys, encryption context, encrypted database backups, and backup metadata |
| Stripe group companies | Checkout, recurring billing, tax calculation, invoices, refunds, and payment-fraud controls | Stripe's global payment infrastructure | Billing name, email, address, tax information, payment method, customer and subscription identifiers, and transaction records |
| Resend, Inc. | Transactional email delivery | Resend's infrastructure and downstream mail delivery network | Recipient email address, subject, authentication or invitation content, billing status notices, and delivery events |

## Optional identity providers

Google or GitHub sign-in is available only when that provider is configured and shown on the sign-in page. If enabled and selected, the provider sends SmallDocs a stable account identifier and verified email address. Email-code sign-in does not use Google or GitHub identity services.

## Public website resources

The public reader may request fonts from Google Fonts and a chart library from jsDelivr when the selected font or document feature requires it. Those providers receive normal network request data such as an IP address and user-agent. They do not receive a Cloud document from our server. A document can itself refer to an external image or other resource; the reader's browser then contacts the referenced host directly.

## Changes

We will update this page when a provider with access to customer personal data or Cloud content is added or replaced. For a material change affecting paid Cloud use, we will provide notice where required.

Questions about a provider or data-processing agreement can be sent to [hi@smalldocs.org](mailto:hi@smalldocs.org).
