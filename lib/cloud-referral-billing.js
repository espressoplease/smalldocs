'use strict';

function id(value) { return typeof value === 'string' ? value : value && value.id; }
function subscriptionId(invoice) { return id(invoice.parent?.subscription_details?.subscription || invoice.subscription); }
function couponId(discount) { return id(discount && (discount.source?.coupon || discount.coupon)); }
function unitPrice(price, currency) {
  if (price.recurring?.interval !== 'month' || (price.recurring.interval_count || 1) !== 1 || price.billing_scheme === 'tiered') {
    throw new Error('Referral rewards require the monthly per-person price');
  }
  const amount = currency === price.currency ? price.unit_amount : price.currency_options?.[currency]?.unit_amount;
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('Referral currency price is unavailable');
  return amount;
}

class ReferralBilling {
  constructor({ referrals, single, stripe, priceId }) {
    this.referrals = referrals; this.single = single; this.stripe = stripe; this.priceId = priceId;
  }
  async coupon(row) {
    await this.stripe.createReferralCoupon({ couponId: row.coupon_id, amount: row.amount_minor,
      currency: row.currency, currencyOptions: JSON.parse(row.currency_options_json), productId: row.product_id,
      redemptionId: row.id, idempotencyKey: 'referral-coupon-' + row.id });
    return row;
  }
  needsCheckoutRefresh(operationId, userId, quantity) {
    const current = this.referrals.redemption('checkout:' + operationId);
    return this.referrals.available(userId) > 0 && (!current || current.seats < quantity);
  }
  async checkout({ userId, accountId, operationId, quantity }) {
    const key = 'checkout:' + operationId;
    let row = this.referrals.redemption(key);
    if (!row && !this.referrals.available(userId)) return null;
    if (!row) {
      const price = await this.stripe.retrievePrice({ priceId: this.priceId });
      const options = {};
      for (const currency of Object.keys(price.currency_options || {})) options[currency] = unitPrice(price,currency);
      row = this.referrals.reserve({ userId, accountId, scope: 'checkout', key, quantity,
        unitAmount: unitPrice(price,price.currency), currency: price.currency, productId: id(price.product), currencyOptions: options });
    }
    return row && row.state !== 'released' ? this.coupon(row) : null;
  }
  async context(invoice) {
    const subId = subscriptionId(invoice);
    if (!subId) return null;
    const subscription = await this.stripe.retrieveSubscription({ subscriptionId: subId });
    const metadata = subscription.metadata || {};
    if (metadata.single_plan !== 'true' || !metadata.workspace_id) return null;
    const account = this.single.db.prepare('SELECT * FROM cloud_single_accounts WHERE id=?').get(metadata.workspace_id);
    if (!account || account.owner_user_id !== metadata.owner_user_id || id(subscription.customer) !== id(invoice.customer)) return null;
    const stored = this.single.billing.getSubscription(account.id);
    const checkout = this.single.db.prepare('SELECT * FROM cloud_single_checkouts WHERE account_id=? AND operation_id=?')
      .get(account.id,metadata.single_checkout_operation_id || '');
    const current = stored && stored.providerSubscriptionId === subId && stored.providerCustomerId === id(invoice.customer);
    if (!current && !checkout) return null;
    return { account, metadata, subscription };
  }
  rowForInvoice(invoice, context) {
    const reference = invoice.metadata?.sdocs_referral_redemption ||
      (invoice.billing_reason === 'subscription_create' ? context.metadata.sdocs_referral_redemption : null);
    return (reference && this.referrals.db.prepare('SELECT * FROM cloud_referral_redemptions WHERE id=?').get(reference)) ||
      this.referrals.redemption('invoice:' + invoice.id) ||
      (invoice.billing_reason === 'subscription_create' && this.referrals.redemption('checkout:' + context.metadata.single_checkout_operation_id));
  }
  hasCoupon(invoice, row) {
    return (invoice.discounts || []).some(discount => couponId(discount) === row.coupon_id);
  }
  bind(row, invoice, context) {
    if (row.account_id !== context.account.id || row.user_id !== context.account.owner_user_id ||
        (row.invoice_id && row.invoice_id !== invoice.id)) throw new Error('Referral invoice account mismatch');
    this.referrals.db.prepare("UPDATE cloud_referral_redemptions SET invoice_id=?,updated_at_ms=? WHERE id=? AND state='reserved'")
      .run(invoice.id,this.referrals.now(),row.id);
  }
  async created(invoice) {
    if (!['subscription_create','subscription_cycle'].includes(invoice.billing_reason)) return;
    const context = await this.context(invoice);
    if (!context) return;
    let row = this.rowForInvoice(invoice,context);
    if (row && this.hasCoupon(invoice,row)) { this.bind(row,invoice,context); return; }
    // The first invoice is finalized immediately. Its discount is supplied to
    // Checkout in advance; only recurring draft invoices are changed here.
    if (invoice.status !== 'draft' || invoice.billing_reason !== 'subscription_cycle') {
      if (row && row.state === 'reserved' && !this.hasCoupon(invoice,row)) this.referrals.release(row.scope_key);
      return;
    }
    if (!row && !this.referrals.available(context.account.owner_user_id)) return;
    const lines = invoice.lines?.data || [];
    if (invoice.lines?.has_more) throw new Error('Referral invoice lines are incomplete');
    const eligible = lines.filter(line => id(line.pricing?.price_details?.price || line.price) === this.priceId &&
      !(line.proration || line.parent?.subscription_item_details?.proration));
    if (eligible.length !== 1 || !Number.isSafeInteger(eligible[0].quantity) || eligible[0].quantity < 1) return;
    const price = await this.stripe.retrievePrice({ priceId: this.priceId });
    const unit = unitPrice(price,invoice.currency);
    const existingDiscount = (invoice.total_discount_amounts || []).reduce((sum, item) => sum + (Number(item.amount) || 0),0);
    const remaining = Math.max(0, (Number(invoice.subtotal) || 0) - existingDiscount);
    const quantity = Math.min(eligible[0].quantity,Math.floor(remaining / unit));
    if (!quantity && !row) return;
    row = row || this.referrals.reserve({ userId: context.account.owner_user_id, accountId: context.account.id,
      scope: 'invoice', key: 'invoice:' + invoice.id, quantity, unitAmount: unit, currency: invoice.currency, productId: id(price.product) });
    if (!row || row.state === 'released') return;
    await this.coupon(row);
    const discounts = (invoice.discounts || []).map(discount => ({ discount: id(discount) }));
    discounts.push({ coupon: row.coupon_id });
    const updated = await this.stripe.updateInvoiceReferralDiscount({ invoiceId: invoice.id, discounts,
      redemptionId: row.id, idempotencyKey: 'referral-invoice-' + row.id });
    if (updated.id !== invoice.id) throw new Error('Referral invoice update failed');
    this.bind(row,invoice,context);
  }
  async event(event) {
    if (event.type === 'checkout.session.expired') {
      const metadata = event.data.object.metadata || {};
      if (metadata.single_plan === 'true' && metadata.single_checkout_operation_id) {
        const session = await this.stripe.retrieveCheckoutSession({ sessionId: event.data.object.id });
        if (session.status === 'expired') this.referrals.release('checkout:' + metadata.single_checkout_operation_id);
      }
      return;
    }
    if (!['invoice.created','invoice.paid','invoice.voided','invoice.deleted'].includes(event.type)) return;
    if (event.type === 'invoice.deleted') {
      const row = this.referrals.redemption('invoice:' + event.data.object.id);
      if (row && row.state === 'reserved') this.referrals.release(row.scope_key);
      return;
    }
    // Webhooks can arrive out of order. Read the current invoice and never
    // consume a reward on an unsigned payload or an unpaid invoice.
    const invoice = await this.stripe.retrieveInvoice({ invoiceId: event.data.object.id });
    if (event.type === 'invoice.created') return this.created(invoice);
    const context = await this.context(invoice);
    if (!context) return;
    const row = this.rowForInvoice(invoice,context);
    if (row && (row.account_id !== context.account.id || row.user_id !== context.account.owner_user_id)) throw new Error('Referral invoice account mismatch');
    if (invoice.status === 'void') {
      if (row && row.state === 'reserved') this.referrals.release(row.scope_key);
      return;
    }
    if (invoice.status !== 'paid') return;
    if (row && row.state === 'reserved' && this.hasCoupon(invoice,row)) {
      this.bind(row,invoice,context);
      const discountIds = (invoice.discounts || []).filter(discount => couponId(discount) === row.coupon_id).map(id);
      const actual = (invoice.total_discount_amounts || []).filter(value => discountIds.includes(id(value.discount)))
        .reduce((sum,value) => sum + (Number(value.amount) || 0),0);
      const face = row.currency === invoice.currency ? row.amount_minor : JSON.parse(row.currency_options_json)[invoice.currency]?.amount_off;
      if (!Number.isSafeInteger(face) || face < 1) throw new Error('Referral invoice currency mismatch');
      this.referrals.settle(row.id,invoice.id,Math.min(row.seats,Math.floor(actual / (face / row.seats))));
    } else if (row && row.state === 'reserved') {
      this.referrals.release(row.scope_key);
    }
    if (invoice.lines?.has_more) throw new Error('Referral invoice lines are incomplete');
    const monthlyLine = (invoice.lines?.data || []).find(line => id(line.pricing?.price_details?.price || line.price) === this.priceId &&
      !(line.proration || line.parent?.subscription_item_details?.proration) && line.amount > 0);
    if (invoice.amount_paid > 0 && monthlyLine && ['subscription_create','subscription_cycle'].includes(invoice.billing_reason)) {
      this.referrals.paid(context.account.owner_user_id,invoice.id);
    }
  }
}
module.exports = { ReferralBilling, unitPrice, subscriptionId, couponId };
