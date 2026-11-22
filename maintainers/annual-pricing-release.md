# Annual pricing and install overview, 22 November 2026

New subscriptions cost USD 2.99 per user per month, billed annually at USD 35.88 per user. Tax may be added at checkout. The homepage leads with the monthly equivalent and states annual billing. Checkout states the annual total. Completing checkout during a free trial charges immediately; payment details are not required to use the trial.

New personal trials last two calendar months, with month-end clamping. Existing trial deadlines and subscription contracts stay unchanged. Creating another library does not restart a trial. Existing grace and retention rules remain in place.

Referral rewards remain person-month credits. On this annual price each credit discounts USD 2.99, up to twelve credits per billed person per year. Unspent credits carry forward. Monthly subscriptions remain supported by the referral adapter.

The install page shows numbered CLI and agent skill commands with the existing copy confirmation. Its installer explanation applies to macOS/Linux. Windows receives the npm command. The setup prompt remains available below the commands.

## Stripe configuration

- Production annual price: `price_1UeYiH0bIITqEUvtLr9RK3rQ`.
- Sandbox annual price: `price_1UeYnt0RfTbC6JQXU12se571`.
- Both prices use lookup key `cloud_standard_annual`, USD 3588, yearly licensed billing, exclusive tax.
- Keep previous monthly prices active for historical contracts and rollback.
- Each environment selects its price through `STRIPE_STANDARD_PRICE_ID` in its own protected environment file. Keep `CLOUD_SINGLE_PLAN_ENABLED=1`.

Both actual application credentials passed price retrieval and two-person Checkout creation (USD 71.76). Sessions were expired immediately without payment. Managed Payments remained enabled.

## Deployment and rollback

Back up each protected environment file before replacing its price ID. Deploy and validate staging before promoting the same immutable release to production. If deployment rolls back, restore the previous environment file and restart the corresponding service too: deployment scripts restore release links, not environment files.

Checkout cache records now track their price in `cloud_single_checkout_prices`. An old open checkout is expired before creating one at the new price. The existing five-column checkout table is unchanged so the previous release can still write it after rollback. Existing completed subscriptions are not migrated or charged by deployment.

Terms version is 2026-11-22. The existing terms review flow presents the revised billing terms to returning users. CLI 1.21.1 includes skill 58 and annual referral/trial instructions. Publish through the existing tag-triggered provenance workflow.

## Validation

The Node suite covers calendar month boundaries, unchanged existing trials, annual personal/team referral redemption, renewal and webhook replay, checkout replacement and rollback table compatibility. Browser checks cover three price locales, signup/install flows, copy confirmation, mobile and desktop layouts, and the Windows installer variant. No real payment is required for these checks.
