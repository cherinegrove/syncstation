// src/services/crmEngagement.js
// Keeps product-engagement fields fresh on marketing CRM contacts so lists
// and workflows can target real behaviour: last login, last successful sync,
// how many rules they have, and how many are live. Live hooks cover logins
// and rule saves; the daily sweep is the catch-all for sync activity.
const { Pool } = require('pg');
const { updateCrmContact } = require('./crmSync');

let pool = null;
function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

const toDay = d => (d ? new Date(d).toISOString().slice(0, 10) : null);

// Engagement stats per user, aggregated across all their portals
// (rule counts summed, dates maxed). Excludes internal +ssdemo accounts.
async function getEngagementRows(where, params) {
  const p = getPool();
  const r = await p.query(`
    SELECT u.id, u.email, u.last_login,
           COALESCE(SUM(jsonb_array_length(sr.rules)), 0)::int AS rule_count,
           COALESCE(SUM(act.n), 0)::int                        AS active_rules,
           MAX(sl.last_sync)                                   AS last_sync
    FROM users u
    LEFT JOIN portal_users pu ON pu.user_id = u.id AND pu.is_active
    LEFT JOIN sync_rules sr ON sr.portal_id = pu.portal_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS n
      FROM jsonb_array_elements(sr.rules) x
      WHERE (x->>'enabled')::boolean
    ) act ON sr.portal_id IS NOT NULL
    LEFT JOIN LATERAL (
      SELECT MAX(sync_time) AS last_sync
      FROM sync_logs
      WHERE portal_id = pu.portal_id AND status = 'success'
    ) sl ON pu.portal_id IS NOT NULL
    WHERE u.email NOT LIKE '%+ssdemo%' ${where || ''}
    GROUP BY u.id, u.email, u.last_login
  `, params || []);
  return r.rows;
}

// Current package, monthly cost, and standing for a user — based on their
// most recently updated portal (mirrors the CRM's last-write-wins semantics)
async function getUserPackage(userId) {
  const p = getPool();
  const r = await p.query(`
    SELECT pu.portal_id, pt.paddle_subscription_status
    FROM portal_users pu
    JOIN portal_tiers pt ON pt.portal_id = pu.portal_id
    WHERE pu.user_id = $1 AND pu.is_active
    ORDER BY pt.updated_at DESC
    LIMIT 1
  `, [userId]);
  if (!r.rows.length) return null;

  const { getPortalTier } = require('./tierService');
  const tierInfo = await getPortalTier(r.rows[0].portal_id);
  const subStatus = r.rows[0].paddle_subscription_status;

  const goodStanding =
    tierInfo.canSync &&
    !tierInfo.isExpired &&
    !['past_due', 'paused', 'canceled'].includes(subStatus || '');

  return {
    syncstation_package:       tierInfo.tier,
    syncstation_package_cost:  String(tierInfo.price ?? 0),
    syncstation_good_standing: goodStanding ? 'true' : 'false'
  };
}

async function pushEngagementRow(row) {
  const props = {
    syncstation_rule_count:   String(row.rule_count),
    syncstation_active_rules: String(row.active_rules)
  };
  if (row.last_login) props.syncstation_last_login = toDay(row.last_login);
  if (row.last_sync)  props.syncstation_last_sync  = toDay(row.last_sync);
  try {
    const pkg = await getUserPackage(row.id);
    if (pkg) Object.assign(props, pkg);
  } catch (err) {
    console.error(`[CRM Engagement] Package lookup failed for ${row.email}:`, err.message);
  }
  return updateCrmContact(row.email, props);
}

// After a rules save: refresh engagement for everyone on that portal
async function syncPortalEngagement(portalId) {
  try {
    const rows = await getEngagementRows(
      'AND u.id IN (SELECT user_id FROM portal_users WHERE portal_id = $1 AND is_active)',
      [String(portalId)]
    );
    for (const row of rows) await pushEngagementRow(row);
  } catch (err) {
    console.error(`[CRM Engagement] Portal ${portalId} refresh failed:`, err.message);
  }
}

// Cheap login stamp — called from the login route
async function recordLogin(email) {
  if (!email || email.includes('+ssdemo')) return;
  return updateCrmContact(email, {
    syncstation_last_login: toDay(new Date())
  });
}

// Daily catch-all: refresh every real user's engagement fields
async function runEngagementSweep() {
  try {
    const rows = await getEngagementRows();
    console.log(`[CRM Engagement] Sweeping ${rows.length} user(s)`);
    for (const row of rows) await pushEngagementRow(row);
    console.log('[CRM Engagement] Sweep complete');
  } catch (err) {
    console.error('[CRM Engagement] Sweep failed:', err.message);
  }
}

function scheduleEngagementSweep() {
  // First run shortly after boot (lets the app settle), then every 24h
  setTimeout(runEngagementSweep, 2 * 60 * 1000);
  setInterval(runEngagementSweep, 24 * 60 * 60 * 1000);
}

module.exports = { recordLogin, syncPortalEngagement, runEngagementSweep, scheduleEngagementSweep };
