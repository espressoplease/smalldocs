'use strict';
const crypto = require('crypto');

// Attribution and earned person-months live with billing so reservations are atomic.
class CloudReferrals {
  constructor({ billing, auth, secret, origin }) {
    this.db = billing.db; this.now = billing.now; this.auth = auth;
    this.secret = secret; this.origin = origin; this.rewardTrigger = 'paid';
    if (!secret || secret.length < 16) throw new Error('Referral signing secret is required');
    this.auth.db.exec(`CREATE TABLE IF NOT EXISTS cloud_referral_signup_outbox (
      user_id TEXT PRIMARY KEY, intent_hash TEXT NOT NULL, created_at_ms INTEGER NOT NULL)`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cloud_referral_signup_intents (
        intent_hash TEXT PRIMARY KEY, code TEXT NOT NULL, created_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cloud_referral_links (
        user_id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, created_at_ms INTEGER NOT NULL,
        seen_at_ms INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS cloud_referrals (
        id TEXT PRIMARY KEY, referred_user_id TEXT NOT NULL UNIQUE, referrer_user_id TEXT NOT NULL,
        identity_hash TEXT NOT NULL UNIQUE, created_at_ms INTEGER NOT NULL,
        installed_at_ms INTEGER, paid_at_ms INTEGER, paid_invoice_id TEXT, rewarded_at_ms INTEGER,
        CHECK(referred_user_id != referrer_user_id)
      );
      CREATE INDEX IF NOT EXISTS cloud_referrals_owner_idx ON cloud_referrals(referrer_user_id, created_at_ms, id);
      CREATE TABLE IF NOT EXISTS cloud_referral_rewards (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, referral_id TEXT NOT NULL UNIQUE,
        earned_at_ms INTEGER NOT NULL, redemption_id TEXT, consumed_at_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS cloud_referral_rewards_owner_idx ON cloud_referral_rewards(user_id, consumed_at_ms, redemption_id);
      CREATE TABLE IF NOT EXISTS cloud_referral_redemptions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, account_id TEXT NOT NULL,
        scope TEXT NOT NULL, scope_key TEXT NOT NULL UNIQUE,
        seats INTEGER NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL,
        product_id TEXT NOT NULL, coupon_id TEXT NOT NULL UNIQUE, invoice_id TEXT UNIQUE,
        currency_options_json TEXT NOT NULL DEFAULT '{}', consumed_seats INTEGER,
        state TEXT NOT NULL CHECK(state IN ('reserved','applied','released')),
        created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
      );
    `);
  }
  _hmac(value) { return crypto.createHmac('sha256', this.secret).update(value).digest('base64url'); }
  link(userId) {
    this.db.prepare('INSERT OR IGNORE INTO cloud_referral_links(user_id,code,created_at_ms) VALUES(?,?,?)')
      .run(userId, crypto.randomBytes(18).toString('base64url'), this.now());
    return this.db.prepare('SELECT * FROM cloud_referral_links WHERE user_id=?').get(userId);
  }
  resolve(code) {
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{24}$/.test(code)) return null;
    const link = this.db.prepare('SELECT * FROM cloud_referral_links WHERE code=?').get(code);
    const owner = link && this.auth.getUser(link.user_id);
    return owner && owner.disabledAtMs == null ? { ...link, name: owner.firstName || 'A SmallDocs user' } : null;
  }
  rememberIntent(key, code) {
    if (!key || !this.resolve(code)) return;
    this.db.prepare('INSERT OR IGNORE INTO cloud_referral_signup_intents(intent_hash,code,created_at_ms) VALUES(?,?,?)')
      .run(this._hmac('referral-intent:' + key),code,this.now());
    this.db.prepare('DELETE FROM cloud_referral_signup_intents WHERE created_at_ms < ?').run(this.now() - 2*86400000);
  }
  intent(key, alreadyHashed = false) {
    if (!key) return null;
    const row = this.db.prepare('SELECT code FROM cloud_referral_signup_intents WHERE intent_hash=?').get(alreadyHashed ? key : this._hmac('referral-intent:' + key));
    return row ? this.resolve(row.code) : null;
  }
  recordSignup({ user, created, intentKey }) {
    if (!user) return;
    try {
      if (created && intentKey) this.auth.db.prepare('INSERT OR IGNORE INTO cloud_referral_signup_outbox(user_id,intent_hash,created_at_ms) VALUES(?,?,?)')
        .run(user.id,this._hmac('referral-intent:' + intentKey),this.now());
      this.recoverSignup(user.id);
    } catch (_) { console.warn('[referrals] Signup attribution will be retried.'); }
  }
  recoverSignup(userId) {
    try {
      const pending = this.auth.db.prepare('SELECT * FROM cloud_referral_signup_outbox WHERE user_id=?').get(userId);
      if (!pending) return;
      this.attribute({ user: this.auth.getUser(userId), created: true, intentHash: pending.intent_hash });
      this.auth.db.prepare('DELETE FROM cloud_referral_signup_outbox WHERE user_id=? AND intent_hash=?').run(userId,pending.intent_hash);
    } catch (_) { /* Authentication remains usable while attribution is pending. */ }
  }
  recordInstallation(userId) {
    this.recoverSignup(userId);
    try {
      const row = this.db.prepare('SELECT installed_at_ms,paid_at_ms,rewarded_at_ms FROM cloud_referrals WHERE referred_user_id=?').get(userId);
      if (!row || (row.installed_at_ms != null && (row.rewarded_at_ms != null || row.paid_at_ms == null))) return;
      this.installed(userId);
    } catch (_) { console.warn('[referrals] Agent connection will be retried.'); }
  }
  attribute({ user, created, intentKey, intentHash }) {
    // Only a freshly created account can use the introduction attached to its
    // verified email challenge or browser-bound OAuth transaction.
    if (!created || !user || user.disabledAtMs != null) return null;
    const link = this.intent(intentHash || intentKey,Boolean(intentHash));
    if (!link || link.user_id === user.id) return null;
    const email = user.identities.find(identity => identity.verifiedEmail)?.verifiedEmail;
    if (!email) return null;
    const owner = this.auth.getUser(link.user_id);
    if (owner.identities.some(identity => identity.verifiedEmail?.toLowerCase() === email.toLowerCase())) return null;
    const hash = this._hmac('referral-identity:' + email.trim().toLowerCase());
    this.db.prepare(`INSERT OR IGNORE INTO cloud_referrals
      (id,referred_user_id,referrer_user_id,identity_hash,created_at_ms) VALUES(?,?,?,?,?)`)
      .run(crypto.randomUUID(), user.id, link.user_id, hash, this.now());
    return this.db.prepare('SELECT * FROM cloud_referrals WHERE referred_user_id=?').get(user.id) || null;
  }
  _award(row) {
    const owner = row && this.auth.getUser(row.referrer_user_id);
    if (!owner || owner.disabledAtMs != null || row.rewarded_at_ms != null) return;
    const now = this.now();
    this.db.prepare('INSERT OR IGNORE INTO cloud_referral_rewards(id,user_id,referral_id,earned_at_ms) VALUES(?,?,?,?)')
      .run(crypto.randomUUID(), row.referrer_user_id, row.id, now);
    this.db.prepare('UPDATE cloud_referrals SET rewarded_at_ms=? WHERE id=? AND rewarded_at_ms IS NULL').run(now, row.id);
  }
  installed(userId) {
    this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM cloud_referrals WHERE referred_user_id=?').get(userId);
      if (!row) return;
      this.db.prepare('UPDATE cloud_referrals SET installed_at_ms=COALESCE(installed_at_ms,?) WHERE id=?').run(this.now(), row.id);
      if (row.paid_at_ms != null) this._award(row);
    }).immediate();
  }
  paid(userId, invoiceId) {
    this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM cloud_referrals WHERE referred_user_id=?').get(userId);
      if (!row) return;
      this.db.prepare('UPDATE cloud_referrals SET paid_at_ms=COALESCE(paid_at_ms,?),paid_invoice_id=COALESCE(paid_invoice_id,?) WHERE id=?')
        .run(this.now(),invoiceId,row.id);
      if (row.installed_at_ms != null) this._award(row);
    }).immediate();
  }
  summary(userId, after) {
    const link = this.link(userId);
    const boundary = after && this.db.prepare('SELECT id,created_at_ms FROM cloud_referrals WHERE id=? AND referrer_user_id=?').get(after,userId);
    if (after && !boundary) throw Object.assign(new Error('Invalid referral cursor'), { code: 'invalid_request' });
    const rows = this.db.prepare(`SELECT * FROM cloud_referrals WHERE referrer_user_id=?
      AND (? IS NULL OR created_at_ms < ? OR (created_at_ms = ? AND id < ?))
      ORDER BY created_at_ms DESC,id DESC LIMIT 21`).all(userId,boundary ? boundary.created_at_ms : null,
        boundary ? boundary.created_at_ms : null,boundary ? boundary.created_at_ms : null,boundary ? boundary.id : null);
    const balances = this.db.prepare(`SELECT
      SUM(consumed_at_ms IS NULL AND redemption_id IS NULL) AS available,
      SUM(consumed_at_ms IS NULL AND redemption_id IS NOT NULL) AS reserved,
      SUM(consumed_at_ms IS NOT NULL) AS used FROM cloud_referral_rewards WHERE user_id=?`).get(userId);
    const counts = this.db.prepare(`SELECT COUNT(*) AS total, SUM(installed_at_ms IS NOT NULL) AS installed,
      SUM(MAX(created_at_ms,COALESCE(installed_at_ms,0),COALESCE(rewarded_at_ms,0)) > ?) AS unread
      FROM cloud_referrals WHERE referrer_user_id=?`).get(link.seen_at_ms, userId);
    return {
      url: this.origin + '/home?ref=' + encodeURIComponent(link.code),
      reward_trigger: this.rewardTrigger, available_person_months: Number(balances.available) || 0,
      reserved_person_months: Number(balances.reserved) || 0, used_person_months: Number(balances.used) || 0,
      total_referrals: counts.total, installed_referrals: Number(counts.installed) || 0, unread_count: Number(counts.unread) || 0,
      as_of_ms: this.now(), next_cursor: rows.length > 20 ? rows[19].id : null,
      referrals: rows.slice(0, 20).map(row => {
        const user = this.auth.getUser(row.referred_user_id);
        return { id: row.id, name: user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || 'New user' : 'Deleted account',
          status: row.rewarded_at_ms != null ? 'rewarded' : row.installed_at_ms != null ? 'installed' : 'signed_up',
          created_at_ms: row.created_at_ms, installed_at_ms: row.installed_at_ms, rewarded_at_ms: row.rewarded_at_ms };
      }),
    };
  }
  seen(userId, through) {
    if (!Number.isSafeInteger(through) || through < 0) return;
    this.db.prepare('UPDATE cloud_referral_links SET seen_at_ms=MAX(seen_at_ms,?) WHERE user_id=?').run(Math.min(through, this.now()), userId);
  }
  available(userId) {
    return this.db.prepare('SELECT COUNT(*) AS n FROM cloud_referral_rewards WHERE user_id=? AND consumed_at_ms IS NULL AND redemption_id IS NULL').get(userId).n;
  }
  balances(userId) {
    const row = this.db.prepare(`SELECT
      SUM(consumed_at_ms IS NULL AND redemption_id IS NULL) AS available,
      SUM(consumed_at_ms IS NULL AND redemption_id IS NOT NULL) AS reserved,
      SUM(consumed_at_ms IS NOT NULL) AS used FROM cloud_referral_rewards WHERE user_id=?`).get(userId);
    return { available_person_months: Number(row.available) || 0, reserved_person_months: Number(row.reserved) || 0,
      used_person_months: Number(row.used) || 0 };
  }
  redemption(key) { return this.db.prepare('SELECT * FROM cloud_referral_redemptions WHERE scope_key=?').get(key); }
  reserve({ userId, accountId, scope, key, quantity, unitAmount, currency, productId, currencyOptions = {} }) {
    return this.db.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM cloud_referral_redemptions WHERE scope_key=?').get(key);
      if (existing) {
        if (existing.user_id !== userId || existing.account_id !== accountId) throw new Error('Referral reservation account mismatch');
        return existing.state === 'released' ? null : existing;
      }
      if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(unitAmount) || unitAmount < 1 ||
          !/^[a-z]{3}$/.test(currency) || !/^prod_[A-Za-z0-9_]+$/.test(productId)) throw new Error('Invalid referral redemption');
      const rewards = this.db.prepare(`SELECT id FROM cloud_referral_rewards
        WHERE user_id=? AND consumed_at_ms IS NULL AND redemption_id IS NULL ORDER BY earned_at_ms,id LIMIT ?`).all(userId, quantity);
      if (!rewards.length) return null;
      const id = crypto.randomUUID(), amount = rewards.length * unitAmount, now = this.now();
      if (!Number.isSafeInteger(amount)) throw new Error('Invalid referral amount');
      const options = {};
      for (const [code, unit] of Object.entries(currencyOptions)) {
        if (!/^[a-z]{3}$/.test(code) || !Number.isSafeInteger(unit) || unit < 1 || !Number.isSafeInteger(unit * rewards.length)) throw new Error('Invalid referral currency');
        if (code !== currency) options[code] = { amount_off: unit * rewards.length };
      }
      this.db.prepare(`INSERT INTO cloud_referral_redemptions
        (id,user_id,account_id,scope,scope_key,seats,amount_minor,currency,product_id,coupon_id,currency_options_json,state,created_at_ms,updated_at_ms)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'reserved',?,?)`)
        .run(id,userId,accountId,scope,key,rewards.length,amount,currency,productId,'sdocs_ref_' + id.replace(/-/g,''),JSON.stringify(options),now,now);
      for (const reward of rewards) this.db.prepare('UPDATE cloud_referral_rewards SET redemption_id=? WHERE id=?').run(id,reward.id);
      return this.db.prepare('SELECT * FROM cloud_referral_redemptions WHERE id=?').get(id);
    }).immediate();
  }
  release(key) {
    this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM cloud_referral_redemptions WHERE scope_key=? AND state='reserved'").get(key);
      if (!row) return;
      this.db.prepare('UPDATE cloud_referral_rewards SET redemption_id=NULL WHERE redemption_id=? AND consumed_at_ms IS NULL').run(row.id);
      this.db.prepare("UPDATE cloud_referral_redemptions SET state='released',updated_at_ms=? WHERE id=?").run(this.now(),row.id);
    }).immediate();
  }
  settle(id, invoiceId, usedSeats) {
    this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM cloud_referral_redemptions WHERE id=? AND state='reserved'").get(id);
      if (!row || (row.invoice_id && row.invoice_id !== invoiceId)) return;
      const seats = usedSeats == null ? row.seats : usedSeats;
      if (!Number.isSafeInteger(seats) || seats < 0 || seats > row.seats) throw new Error('Invalid used referral credit');
      const now = this.now();
      const rewards = this.db.prepare('SELECT id FROM cloud_referral_rewards WHERE redemption_id=? AND consumed_at_ms IS NULL ORDER BY earned_at_ms,id').all(id);
      rewards.forEach((reward,index) => {
        if (index < seats) this.db.prepare('UPDATE cloud_referral_rewards SET consumed_at_ms=? WHERE id=?').run(now,reward.id);
        else this.db.prepare('UPDATE cloud_referral_rewards SET redemption_id=NULL WHERE id=?').run(reward.id);
      });
      this.db.prepare("UPDATE cloud_referral_redemptions SET state='applied',invoice_id=?,consumed_seats=?,updated_at_ms=? WHERE id=?").run(invoiceId,seats,now,id);
    }).immediate();
  }
}
module.exports = { CloudReferrals };
