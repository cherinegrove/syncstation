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
        portal_id TEXT PRIMARY KEY,
        tier TEXT NOT NULL DEFAULT 'trial',
        trial_started_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `).then(() => console.log('[Tiers] Table ready'))
      .catch(err => console.error('[Tiers] Table error:', err.message));
  }
  return pool;
}

const TIERS = {
  trial:    { name: 'Free Trial',  maxRules: 10, maxMappings: 10, price: 0,  trialDays: 14 },
  starter:  { name: 'Starter',     maxRules: 10, maxMappings: 10, price: 7   },
  growth:   { name: 'Growth',      maxRules: 30, maxMappings: 30, price: 12  },
  pro:      { name: 'Pro',         maxRules: 50, maxMappings: 50, price: 16  },
  business: { name: 'Business',    maxRules: 100, maxMappings: 100, price: 25 }
};

async function getPortalTier(portalId) {
  const p = getPool();
  if (!p) return { tier: 'trial', ...TIERS.trial, isExpired: false };

  try {
    const result = await p.query(
      'SELECT tier, trial_started_at FROM portal_tiers WHERE portal_id = $1',
      [String(portalId)]
    );

    if (!result.rows[0]) {
      // New portal — create trial
      await p.query(
        'INSERT INTO portal_tiers (portal_id, tier) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [String(portalId), 'trial']
      );
      return { tier: 'trial', ...TIERS.trial, isExpired: false };
    }

    const { tier, trial_started_at } = result.rows[0];
    const tierInfo = TIERS[tier] || TIERS.trial;

    // Check if trial expired
    let isExpired = false;
    if (tier === 'trial') {
      const daysSinceStart = (Date.now() - new Date(trial_started_at).getTime()) / (1000 * 60 * 60 * 24);
      isExpired = daysSinceStart > 14;
    }

    return { tier, ...tierInfo, isExpired };
  } catch (err) {
    console.error('[Tiers] Get tier error:', err.message);
    return { tier: 'trial', ...TIERS.trial, isExpired: false };
  }
}

async function setPortalTier(portalId, tier) {
  const p = getPool();
  if (!p) return;
  await p.query(`
    INSERT INTO portal_tiers (portal_id, tier, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (portal_id) DO UPDATE SET tier = $2, updated_at = NOW()
  `, [String(portalId), tier]);
}

async function getAllPortals() {
  const p = getPool();
  if (!p) return [];
  try {
    const result = await p.query(`
      SELECT 
        pt.portal_id,
        pt.tier,
        pt.trial_started_at,
        pt.updated_at,
        t.data->>'hub_id' as hub_id
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

async function checkLimits(portalId, rules) {
  const tierInfo = await getPortalTier(portalId);

  if (tierInfo.isExpired) {
    return { allowed: false, reason: 'Trial expired. Please upgrade to continue.' };
  }

  if (rules.length > tierInfo.maxRules) {
    return {
      allowed: false,
      reason: `Your ${tierInfo.name} plan allows ${tierInfo.maxRules} sync rules. You have ${rules.length}. Please upgrade.`
    };
  }

  for (const rule of rules) {
    if (rule.mappings && rule.mappings.length > tierInfo.maxMappings) {
      return {
        allowed: false,
        reason: `Your ${tierInfo.name} plan allows ${tierInfo.maxMappings} property mappings per rule. Rule "${rule.name}" has ${rule.mappings.length}. Please upgrade.`
      };
    }
  }

  return { allowed: true, tierInfo };
}

module.exports = { getPortalTier, setPortalTier, getAllPortals, checkLimits, TIERS };
cancelled: { name: 'Cancelled', maxRules: 0, maxMappings: 0, price: 0 };
