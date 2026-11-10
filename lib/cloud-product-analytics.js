'use strict';

const Database = require('better-sqlite3');
const { CURRENT_TERMS_VERSION } = require('./cloud-terms');
const DAY_MS = 86400000;
const HISTORY_DAYS = 90;
const CACHE_MS = 60000;

function calendar(now) {
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  return { now, today, week: today - 6 * DAY_MS, month: today - 29 * DAY_MS,
    start: today - (HISTORY_DAYS - 1) * DAY_MS };
}

function dailySeries(rows, dates, fields) {
  const byDay = new Map(rows.map(row => [row.date, row]));
  const days = [];
  for (let time = dates.start; time <= dates.today; time += DAY_MS) {
    const date = new Date(time).toISOString().slice(0, 10);
    const row = { date };
    for (const field of fields) row[field] = (byDay.get(date) || {})[field] || 0;
    days.push(row);
  }
  return days;
}

// Only aggregates leave this module. The separate connection cannot write to
// authentication, document or billing storage, including attached databases.
class CloudProductAnalytics {
  constructor({ auth, store, billing, singlePlan, adminUserIds = '', now = Date.now }) {
    this.admins = new Set(String(adminUserIds).split(/[\s,]+/).filter(Boolean));
    this.now = now;
    this.db = new Database(auth.db.name, { readonly: true, fileMustExist: true });
    this.db.pragma('query_only = ON');
    try {
      if (store) this.db.prepare('ATTACH DATABASE ? AS content').run(store.db.name);
      if (billing) this.db.prepare('ATTACH DATABASE ? AS billing').run(billing.db.name);
    } catch (error) { this.db.close(); throw error; }
    this.hasContent = Boolean(store);
    this.hasBilling = Boolean(singlePlan && billing && store);
    this.publicCache = null;
    this.privateCache = null;
  }

  isAdmin(userId) { return this.admins.has(userId); }

  cached(key, build) {
    const now = this.now();
    const previous = this[key];
    const day = Math.floor(now / DAY_MS);
    if (previous && previous.day === day && now >= previous.at && now - previous.at < CACHE_MS) return previous.data;
    const data = this.db.transaction(() => build(calendar(now)))();
    this[key] = { at: now, day, data };
    return data;
  }

  signups() {
    return this.cached('publicCache', dates => this.readSignups(dates));
  }

  readSignups(dates) {
    const summary = this.db.prepare(`SELECT COUNT(*) AS total,
        COALESCE(SUM(created_at_ms >= @today),0) AS today,
        COALESCE(SUM(created_at_ms >= @week),0) AS last_7_days,
        COALESCE(SUM(created_at_ms >= @month),0) AS last_30_days
        FROM cloud_auth_users WHERE created_at_ms <= @now`).get(dates);
    const rows = this.db.prepare(`SELECT date(created_at_ms/1000,'unixepoch') AS date, COUNT(*) AS accounts
        FROM cloud_auth_users WHERE created_at_ms >= @start AND created_at_ms <= @now
        GROUP BY date ORDER BY date`).all(dates);
    // Explicit projection: never return identities, source rows or private metrics.
    return { available: true, generated_at: new Date(dates.now).toISOString(), timezone: 'UTC',
      summary, daily: dailySeries(rows, dates, ['accounts']) };
  }

  overview(userId) {
    // Check even on a cache hit. Library roles never confer product admin access.
    if (!this.isAdmin(userId)) throw Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' });
    return this.cached('privateCache', dates => {
      const libraryUsers = this.hasContent ? `SELECT DISTINCT m.user_id FROM content.cloud_workspace_memberships m
        JOIN content.cloud_workspaces w ON w.id=m.workspace_id AND w.deleted_at_ms IS NULL
        JOIN content.cloud_projects p ON p.workspace_id=w.id AND p.deleted_at_ms IS NULL
        WHERE m.status='active'` : 'SELECT NULL AS user_id WHERE 0';
      const authors = this.hasContent ? `SELECT user_id FROM content.cloud_document_activation_events
        UNION SELECT created_by_user_id AS user_id FROM content.cloud_documents` : 'SELECT NULL AS user_id WHERE 0';
      const paidPeople = this.hasBilling ? `SELECT a.owner_user_id AS user_id FROM billing.cloud_single_accounts a
        JOIN billing.cloud_billing_subscriptions s ON s.workspace_id=a.id
        WHERE s.provider='stripe' AND s.status='active' AND s.initial_payment_pending=0 AND s.access_activated_at_ms IS NOT NULL
        UNION SELECT sp.user_id FROM billing.cloud_single_sponsors sp
        JOIN billing.cloud_billing_subscriptions s ON s.workspace_id=sp.account_id
        WHERE s.provider='stripe' AND s.status='active' AND s.initial_payment_pending=0 AND s.access_activated_at_ms IS NOT NULL
        AND EXISTS (SELECT 1 FROM billing.cloud_single_libraries l
          JOIN content.cloud_workspace_memberships m ON m.workspace_id=l.workspace_id AND m.user_id=sp.user_id AND m.status='active'
          JOIN content.cloud_workspaces w ON w.id=m.workspace_id AND w.deleted_at_ms IS NULL
          WHERE l.account_id=sp.account_id)` : 'SELECT NULL AS user_id WHERE 0';
      const flags = `WITH library_users AS (${libraryUsers}), authors AS (${authors}), paid_people AS (${paidPeople}),
        accounts AS (SELECT u.id, u.created_at_ms,
          CASE WHEN u.disabled_at_ms IS NULL THEN 1 ELSE 0 END AS enabled,
          CASE WHEN TRIM(COALESCE(u.first_name,''))!='' AND TRIM(COALESCE(u.last_name,''))!='' THEN 1 ELSE 0 END AS profile,
          EXISTS (SELECT 1 FROM cloud_auth_terms_acceptances t WHERE t.user_id=u.id AND t.terms_version=@terms) AS terms,
          EXISTS (SELECT 1 FROM library_users l WHERE l.user_id=u.id) AS library,
          EXISTS (SELECT 1 FROM cloud_cli_credentials c WHERE c.user_id=u.id AND c.created_at_ms<=@now) AS agent,
          EXISTS (SELECT 1 FROM authors a WHERE a.user_id=u.id) AS document,
          EXISTS (SELECT 1 FROM paid_people p WHERE p.user_id=u.id) AS paid
          FROM cloud_auth_users u WHERE u.created_at_ms<=@now),
        progress AS (SELECT *, (enabled AND profile AND terms AND library) AS ready FROM accounts)`;
      const parameters = { ...dates, terms: CURRENT_TERMS_VERSION };
      const totals = this.db.prepare(flags + ` SELECT COUNT(*) AS accounts,
        COALESCE(SUM(enabled),0) AS enabled, COALESCE(SUM(profile),0) AS profile_complete,
        COALESCE(SUM(ready),0) AS ready, COALESCE(SUM(agent),0) AS agent_connected,
        COALESCE(SUM(document),0) AS document_created, COALESCE(SUM(paid AND enabled),0) AS paid_people FROM progress`).get(parameters);
      const rows = this.db.prepare(flags + ` SELECT date(created_at_ms/1000,'unixepoch') AS date,
        COUNT(*) AS accounts, SUM(profile) AS profile_complete, SUM(ready) AS ready,
        SUM(agent) AS agent_connected, SUM(document) AS document_created, SUM(paid AND enabled) AS paid_people
        FROM progress WHERE created_at_ms>=@start GROUP BY date ORDER BY date`).all(parameters);
      const libraries = this.hasContent ? this.db.prepare(`SELECT
        COALESCE(SUM(kind='personal'),0) AS personal, COALESCE(SUM(kind='team'),0) AS team
        FROM content.cloud_workspaces WHERE deleted_at_ms IS NULL`).get() : null;
      const billing = this.hasBilling ? this.db.prepare(`SELECT
        (SELECT COUNT(*) FROM billing.cloud_billing_personal_trials) AS trials_started,
        COALESCE(SUM(status='active' AND initial_payment_pending=0 AND access_activated_at_ms IS NOT NULL),0) AS active_subscriptions,
        COALESCE(SUM(status='past_due'),0) AS past_due_subscriptions,
        COALESCE(SUM(initial_payment_pending=1 AND status!='canceled'),0) AS pending_subscriptions,
        COALESCE(SUM(status='canceled'),0) AS canceled_subscriptions,
        COALESCE(SUM(CASE WHEN status='active' AND initial_payment_pending=0 AND access_activated_at_ms IS NOT NULL THEN seat_quantity ELSE 0 END),0) AS billed_seats
        FROM billing.cloud_billing_subscriptions WHERE provider='stripe'`).get() : null;
      return { generated_at: new Date(dates.now).toISOString(), timezone: 'UTC',
        signups: this.readSignups(dates).summary, totals, libraries, billing,
        cohorts: dailySeries(rows, dates, ['accounts', 'profile_complete', 'ready', 'agent_connected', 'document_created', 'paid_people']) };
    });
  }

  close() { this.db.close(); }
}

module.exports = { CloudProductAnalytics, DAY_MS, CACHE_MS };
