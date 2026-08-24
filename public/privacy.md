---
title: SmallDocs Privacy Notice
description: What SmallDocs receives, why it is processed, where it is stored, and your choices.
---

# Privacy Notice

**Last updated: 24 August 2026**

This notice explains how **Odd Solutions Ltd**, company number 16186575, handles personal data when it operates SmallDocs. Odd Solutions Ltd is the controller for account, service, support, security, and billing records. For document content uploaded by a Team customer, the customer may be the controller and Odd Solutions Ltd may act as its processor.

Contact: [hi@smalldocs.org](mailto:hi@smalldocs.org).

Registered office: 98 Downhills Park Road, London, United Kingdom, N17 6PA.

## The three document modes

SmallDocs handles documents differently depending on the feature you choose.

### Local documents

When you run `sdoc file.md`, the command line tool reads the file, compresses it, and puts it after the `#` in a SmallDocs URL. Browsers do not send that URL fragment to the web server. Rendering happens in the browser. We receive the normal request for the application files, but not the document content in the fragment.

Bridge mode connects the browser to a process bound to your computer's loopback address. The bridge can access only the files explicitly opened for that session. The SmallDocs page is trusted by the bridge, so a compromise of the served application could affect an open Bridge file.

### Encrypted short links

An encrypted short link uploads encrypted document bytes to SmallDocs. The server stores the ciphertext and short identifier. The decryption key remains after the `#` in the shared URL and is not sent to our server. A short link is deleted after 365 days without a successful access. Encrypted copies may remain in backup archives until the backup retention cycle completes.

### SmallDocs Cloud

Cloud stores selected documents for access across authorised people and connected machines. Document bodies, titles, filenames, tags, and revision metadata are encrypted at rest. SmallDocs manages the encryption keys and can decrypt an authorised document in application memory to render, search, edit, merge, export, and notify about it. Cloud is not end-to-end encrypted or zero knowledge.

Access checks run before a Cloud document is decrypted. Search decrypts authorised current documents in memory for that request. We do not keep a plaintext keyword index. Search text, document text, and result snippets are excluded from application logs.

## Personal data we process

| Data | Why it is used | Lawful basis |
| --- | --- | --- |
| Email address, first name, last name, identity-provider identifier, and sign-in history | Create and secure an account, sign a person in, display identity, and recover access | Contract and legitimate interests in service security |
| Session and connected-machine records, hashed credentials, issue times, expiry times, and revocation state | Authenticate browsers and command line clients and allow credentials to be revoked | Contract and legitimate interests in preventing unauthorised access |
| Account name, membership, roles, invitation address, approved email domains, permission groups, and audit events | Provide Team access controls and show administrative history | Contract and legitimate interests in account security and dispute handling |
| Encrypted document data and operational metadata such as identifiers, sizes, revision times, and access events | Store, retrieve, search, edit, merge, back up, and recover Cloud documents | Contract. For Team content, the customer may determine the lawful basis |
| Billing contact, Stripe customer and subscription identifiers, plan, seat quantity, invoice and payment status, tax state, and retention dates | Take payment, calculate entitlement, manage cancellation, and keep accounting records | Contract and legal obligation |
| Recipient address, notification choice, subject, delivery state, and optional note | Send sign-in, invitation, sharing, billing, and deletion messages | Contract and legitimate interests in delivering and securing the service |
| Support requests, business enquiries, and correspondence | Respond to a request and keep a record of the response | Contract or steps requested before a contract, and legitimate interests in support |
| Coarse visit information described below | Understand whether the public reader is used and detect a stale application version | Legitimate interests in operating and improving the service |
| Security and operational events, provider request identifiers, counts, latency, disk use, job age, and failure codes | Detect abuse, diagnose incidents, reconcile providers, and recover the service | Legitimate interests in security and reliability |

The web server receives an IP address and user-agent as part of an HTTP connection. Nginx access logging is disabled in the Cloud production configuration. IP addresses used for rate limiting are transformed with a keyed hash before a rate-limit event is stored. We do not use advertising cookies or sell personal data.

## Public reader analytics and local storage

The public application records a cohort week, current week, coarse device category, browser family, coarse referrer category, local hour, and load type when analytics are enabled. A cohort week is shared by everyone whose first visit occurred that week; it is not a unique identifier. Aggregate counts are published at [smalldocs.org/analytics](/analytics).

The public reader stores the cohort value and application preferences in browser storage. Cloud uses a Secure, HttpOnly, SameSite session cookie after sign-in. The cookie contains an opaque credential, not a document.

You can opt out of cohort attribution on the analytics page or clear site data in your browser. Necessary authentication storage cannot be disabled while remaining signed in.

## Who receives data

We use Hetzner for the production server, AWS KMS for document-key protection, Amazon S3 for encrypted backups, Stripe for billing and tax, and Resend for transactional email. Their purposes, locations, and the data involved are listed on the [Service Providers and Subprocessors](/subprocessors) page.

Google or GitHub receives identity requests only if that provider is configured, shown on the sign-in page, and selected by you. The public reader may request a selected font from Google Fonts or a chart library from jsDelivr. If a document refers to an external image or other resource, your browser contacts that resource's host directly.

Some providers operate internationally. Where UK personal data is transferred outside the UK, we rely on an applicable adequacy regulation, the UK International Data Transfer Agreement or UK Addendum to standard contractual clauses, or another lawful transfer mechanism. Stripe may act as an independent controller for regulated payment and fraud-prevention activity.

## Retention

- Sign-in codes are valid for 10 minutes and allow no more than 5 attempts. Only a keyed hash of a code is stored.
- Browser sessions expire after 30 days unless revoked earlier. Command line access tokens expire after 15 minutes; the longer-lived connected-machine credential remains until revoked or the account is deleted.
- Active Cloud account and membership records are kept while needed to provide the account. A verified identity can remain after the last subscription ends so the person can sign in, export retained data, recover a subscription, or exercise data rights.
- Cloud keeps the current revision and up to 3 previous revisions. Previous revisions are retained for no more than 90 days.
- A deleted Cloud document can normally be restored for 30 days before permanent deletion from the active database.
- After cancellation, Cloud data is scheduled for deletion 30 days after the paid period ends. After a failed payment, it is scheduled for deletion 60 days after the failed payment.
- Team administrative events are kept with the account and removed when the account is permanently purged, unless a record must be retained for a legal claim or security investigation.
- Encrypted production backups are created nightly. Local archives are kept for 7 days. Off-site archives are protected from early deletion for 30 days by S3 Object Lock, then removed through an asynchronous lifecycle process. An archive can remain for slightly longer than 31 days. Deleted ciphertext can remain until the applicable backup archive expires.
- Encrypted short links expire after 365 days without a successful access.
- Billing, invoice, tax, refund, and transaction records may be retained for 6 years after the financial year to which they relate, or longer when law or an active enquiry requires it.
- Operational logs are normally retained for no more than 90 days, unless a specific security incident or legal claim requires a relevant record to be preserved for longer.
- Support correspondence is normally retained for 2 years after the request closes, unless it becomes part of a transaction, security incident, or legal claim.

When an active database row is deleted, copies may remain as encrypted ciphertext in retained backups. Backup access requires separate credentials and encryption keys. Backup expiry is not an immediate deletion mechanism for provider records that the provider must retain independently, such as Stripe transaction records.

## Service closure or transfer

If SmallDocs Cloud closes or Odd Solutions Ltd ceases trading, data-protection duties continue to apply. Where reasonably within our control, we will provide notice and an authenticated export window before active Cloud data is deleted. An administrator or liquidator may take control of decisions about company data during a formal insolvency process.

A reorganisation, sale, administration, or transfer of the service may involve personal data moving to a successor. Any transfer must have a lawful basis. Where reasonably practicable, we will give affected customers notice and an opportunity to export or delete retained Cloud content before a material transfer. The [Service Closure and Data Portability Policy](/service-closure) describes the operational process and its limits.

## Security

Cloud database values and backups are encrypted at rest. Document encryption keys are protected by AWS KMS and are not stored in plaintext beside document data. Connections use TLS. Production workload, backup, and provider credentials have separate permissions. Connected machines can be viewed and revoked.

Encryption at rest protects a copied database or backup from being useful on its own. It does not protect against a compromise of the running application, its KMS permissions, an authorised user session, or a sufficiently privileged operator.

The source code and a per-deploy file manifest are public. Verification steps are at [smalldocs.org/trust](/trust).

## Your rights

Depending on the circumstances, UK data-protection law gives you rights to:

- ask for a copy of personal data;
- correct inaccurate or incomplete data;
- ask for deletion or restriction;
- object to processing based on legitimate interests;
- receive data you provided in a portable form; and
- withdraw consent where consent is the basis for processing.

Email [hi@smalldocs.org](mailto:hi@smalldocs.org) from the address associated with the account. We may need to verify the request. If a Team controls the document content, we may refer a content request to that Team.

You can complain to the UK Information Commissioner's Office at [ico.org.uk](https://ico.org.uk). Please contact us first if you want us to investigate a concern.

## Changes

We will update this notice when a data flow, provider, retention period, or legal requirement changes. For a material change affecting a paid account, we will provide notice where required.
