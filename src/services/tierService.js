// src/services/tierService.js
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    pool.query(`
      CREATE TABLE IF NOT EXISTS portal_tiers (
        portal_id                  TEXT PRIMARY KEY,
        tier                       TEXT NOT NULL DEFAULT 'trial',
        created_at                 TIMESTAMP DEFAULT NOW(),
        trial_started_at           TIMESTAMP,
        paddle_customer_id         TEXT,
        paddle_subscription_id     TEXT,
        paddle_subscription_status TEXT,
        updated_at                 TIMESTAMP DEFAULT NOW()
      );
      ALTER TABLE portal_tiers ADD COLUMN IF NOT EXISTS trial_expired_synced BOOLEAN DEFAULT FALSE;
    `).then(() => console.log('[Tiers] Table ready'))
      .catch(err => console.error('[Tiers] Table error:', err.message));
  }
  return pool;
}

const TIERS = {
  FREE: {
    name: 'Free',
    price: 0,
    maxMappings: Infinity,
    maxRules: Infinity,
    allowedObjects: ['contacts', 'companies', 'deals', 'tickets', 'leads', 'projects'],
    trialDays: null,
    canSync: true
  },
  TRIAL: {
    name: 'Free Trial',
    price: 0,
    maxMappings: 30,
    maxRules: Infinity,
    allowedObjects: ['contacts', 'companies', 'deals', 'tickets', 'leads', 'projects'],
    trialDays: 7,
    canSync: true
  },
  STARTER: {
    name: 'Starter',
    price: 10,
    maxMappings: 20,
    maxRules: Infinity,
    allowedObjects: ['contacts', 'companies', 'deals'],
    trialDays: null,
    canSync: true
  },
  PRO: {
    name: 'Pro',
    price: 15,
    maxMappings: 30,
    maxRules: Infinity,
    allowedObjects: ['contacts', 'companies', 'deals', 'tickets', 'leads', 'projects'],
    trialDays: null,
    canSync: true
  },
  BUSINESS: {
    name: 'Business',
    price: 40,
    maxMappings: 100,
    maxRules: Infinity,
    allowedObjects: ['contacts', 'companies', 'deals', 'tickets', 'leads', 'projects'],
    trialDays: null,
    canSync: true
  },
  SUSPENDED: {
    name: 'Suspended',
    price: 0,
    maxMappings: 0,
    maxRules: 0,
    allowedObjects: [],
    trialDays: null,
    canSync: false
  },
  CANCELLED: {
    name: 'Cancelled',
    price: 0,
    maxMappings: 0,
    maxRules: 0,
    allowedObjects: [],
    trialDays: null,
    canSync: false
  }
};

// ── Marketing CRM funnel updates ──────────────────────────────────────────────

// Push CRM properties to every (real) user of a portal. Fire-and-forget.
async function pushStatusToCrm(portalId, properties) {
  try {
    const { updateCrmContact } = require('./crmSync');
    const p = getPool();
    const r = await p.query(
      `SELECT u.email FROM portal_users pu
       JOIN users u ON u.id = pu.user_id
       WHERE pu.portal_id = $1 AND pu.is_active`,
      [String(portalId)]
    );
    const emails = r.rows.map(x => x.email).filter(e => !e.includes('+ssdemo'));
    for (const email of emails) {
      await updateCrmContact(email, properties);
    }
  } catch (err) {
    console.error(`[Tiers] CRM push failed for portal ${portalId}:`, err.message);
  }
}

// Mark trial expiry in the CRM exactly once per portal (DB flag + memory guard)
const trialExpiredSyncedCache = new Set();
async function markTrialExpiredOnce(portalId) {
  if (trialExpiredSyncedCache.has(portalId)) return;
  trialExpiredSyncedCache.add(portalId);
  try {
    const p = getPool();
    const r = await p.query(
      `UPDATE portal_tiers SET trial_expired_synced = TRUE
       WHERE portal_id = $1 AND trial_expired_synced IS NOT TRUE
       RETURNING portal_id`,
      [String(portalId)]
    );
    if (r.rows.length > 0) {
      console.log(`[Tiers] Trial expired for portal ${portalId} — updating CRM`);
      await pushStatusToCrm(portalId, { syncstation_status: 'trial_expired' });
    }
  } catch (err) {
    console.error(`[Tiers] Trial-expired CRM sync failed for ${portalId}:`, err.message);
  }
}

async function getPortalTier(portalId) {
  const p = getPool();
  try {
    const result = await p.query(
      `SELECT tier, created_at, trial_started_at,
              paddle_customer_id, paddle_subscription_id, paddle_subscription_status
       FROM portal_tiers WHERE portal_id = $1`,
      [portalId]
    );

    console.log('[Tiers] getPortalTier for', portalId, '- DB returned:', result.rows.length, 'rows');
    if (result.rows.length > 0) console.log('[Tiers] DB tier value:', result.rows[0].tier);

    if (result.rows.length === 0) {
      console.log('[Tiers] Portal not found, creating with trial tier');
      await p.query(
        'INSERT INTO portal_tiers (portal_id, tier, created_at, trial_started_at) VALUES ($1, $2, NOW(), NOW()) ON CONFLICT (portal_id) DO NOTHING',
        [portalId, 'trial']
      );
      return { tier: 'trial', created_at: new Date(), isExpired: false, canSync: true, ...TIERS.TRIAL };
    }

    const row       = result.rows[0];
    const tierUpper = row.tier.toUpperCase();
    const tierConfig = TIERS[tierUpper] || TIERS.FREE;

    // Check trial expiry using trial_started_at
    let isExpired = false;
    if (tierConfig.trialDays) {
      const startDate  = new Date(row.trial_started_at || row.created_at);
      const expiryDate = new Date(startDate.getTime() + (tierConfig.trialDays * 86400000));
      isExpired = Date.now() > expiryDate.getTime();
    }

    let canSync = tierConfig.canSync;
    if (isExpired) canSync = false;

    // First time we see this trial as expired → funnel update in the CRM
    if (isExpired && tierUpper === 'TRIAL') {
      markTrialExpiredOnce(portalId); // deliberately not awaited
    }

    const returnValue = {
      tier:                       row.tier.toLowerCase(),
      created_at:                 row.created_at,
      trial_started_at:           row.trial_started_at,
      paddle_customer_id:         row.paddle_customer_id,
      paddle_subscription_id:     row.paddle_subscription_id,
      paddle_subscription_status: row.paddle_subscription_status,
      isExpired,
      canSync,
      ...tierConfig
    };

    console.log('[Tiers] Returning tier:', returnValue.tier, 'for portal', portalId);
    return returnValue;

  } catch (err) {
    console.error('[Tiers] Get tier error:', err.message);
    return { tier: 'free', created_at: new Date(), isExpired: false, canSync: true, ...TIERS.FREE };
  }
}

async function setPortalTier(portalId, tier, paddleData = {}) {
  const p = getPool();
  const tierUpper = tier.toUpperCase();
  if (!TIERS[tierUpper]) throw new Error(`Invalid tier: ${tier}`);

  const validTier = tier.toLowerCase();
  const { customer_id, subscription_id, subscription_status } = paddleData;

  await p.query(`
    INSERT INTO portal_tiers (portal_id, tier, created_at, trial_started_at, paddle_customer_id, paddle_subscription_id, paddle_subscription_status, updated_at)
    VALUES ($1, $2, NOW(), NOW(), $3, $4, $5, NOW())
    ON CONFLICT (portal_id) DO UPDATE SET
      tier                       = $2,
      paddle_customer_id         = COALESCE($3, portal_tiers.paddle_customer_id),
      paddle_subscription_id     = COALESCE($4, portal_tiers.paddle_subscription_id),
      paddle_subscription_status = COALESCE($5, portal_tiers.paddle_subscription_status),
      trial_expired_synced       = FALSE,
      updated_at                 = NOW()
  `, [portalId, validTier, customer_id, subscription_id, subscription_status]);
  trialExpiredSyncedCache.delete(String(portalId));

  // Funnel update in the marketing CRM (fire-and-forget)
  const paidTiers = ['starter', 'pro', 'business'];
  const statusMap = { cancelled: 'cancelled', suspended: 'suspended', trial: 'trial', free: 'free' };
  const crmProps = paidTiers.includes(validTier)
    ? { syncstation_status: 'customer', syncstation_plan: validTier }
    : { syncstation_status: statusMap[validTier] || validTier };
  pushStatusToCrm(portalId, crmProps); // deliberately not awaited

  return { tier: validTier };
}

function isObjectAllowed(tier, objectType) {
  const tierConfig = TIERS[tier.toUpperCase()] || TIERS.FREE;
  return tierConfig.allowedObjects.includes(objectType);
}

async function getAllPortals() {
  const p = getPool();
  try {
    const result = await p.query(`
      SELECT pt.portal_id, pt.tier, pt.created_at, pt.trial_started_at,
             pt.paddle_customer_id, pt.paddle_subscription_id, pt.paddle_subscription_status,
             pt.updated_at, t.data->>'hub_id' as hub_id
      FROM portal_tiers pt
      LEFT JOIN tokens t ON t.portal_id = pt.portal_id
      ORDER BY pt.updated_at DESC
    `);
    return result.rows;
  } catch (err) {
    console.error('[Tiers] Get all portals error:', err.message);
    return [];
  }
}

module.exports = { TIERS, getPortalTier, setPortalTier, getAllPortals, isObjectAllowed };
