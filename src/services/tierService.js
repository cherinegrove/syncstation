// src/services/tierService.js - FIXED VERSION WITH PROPER TIER ENFORCEMENT
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    // Create table on first connection
    pool.query(`
      CREATE TABLE IF NOT EXISTS portal_tiers (
        portal_id TEXT PRIMARY KEY,
        tier TEXT NOT NULL DEFAULT 'TRIAL',
        created_at TIMESTAMP DEFAULT NOW(),
        paystack_customer_id TEXT,
        paystack_subscription_id TEXT,
        paystack_subscription_status TEXT,
        paddle_customer_id TEXT,
        paddle_subscription_id TEXT,
        paddle_subscription_status TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `).then(() => console.log('[Tiers] Table ready'))
      .catch(err => console.error('[Tiers] Table error:', err.message));
  }
  return pool;
}

// Tier definitions with limits
const TIERS = {
  FREE: {
    name: 'FREE',
    price: 0,
    maxMappings: Infinity,
    maxRules: Infinity,
    allowedObjects: ['contacts', 'companies', 'deals', 'tickets', 'leads', 'projects'],
    trialDays: null,
    canSync: true  // ✅ FREE CAN SYNC
  },
  TRIAL: {
    name: 'TRIAL',
    price: 0,
    maxMappings: 30,
    maxRules: Infinity,
    allowedObjects: ['contacts', 'companies', 'deals', 'tickets', 'leads', 'projects'],
    trialDays: 7,
    canSync: true  // ✅ TRIAL CAN SYNC (until expired)
  },
  STARTER: {
    name: 'STARTER',
    price: 10,
    maxMappings: 20,
    maxRules: Infinity,
    allowedObjects: ['contacts', 'companies', 'deals'],
    trialDays: null,
    canSync: true
  },
  PRO: {
    name: 'PRO',
    price: 15,
    maxMappings: 30,
    maxRules: Infinity,
    allowedObjects: ['contacts', 'companies', 'deals', 'tickets', 'leads', 'projects'],
    trialDays: null,
    canSync: true
  },
  BUSINESS: {
    name: 'BUSINESS',
    price: 40,
    maxMappings: 100,
    maxRules: Infinity,
    allowedObjects: ['contacts', 'companies', 'deals', 'tickets', 'leads', 'projects'],
    trialDays: null,
    canSync: true
  },
  PROFESSIONAL: {
    name: 'PROFESSIONAL',
    price: 30,
    maxMappings: 50,
    maxRules: Infinity,
    allowedObjects: ['contacts', 'companies', 'deals', 'tickets', 'leads', 'projects'],
    trialDays: null,
    canSync: true
  },
  SUSPENDED: {
    name: 'SUSPENDED',
    price: 0,
    maxMappings: 0,
    maxRules: 0,
    allowedObjects: [],
    trialDays: null,
    canSync: false  // ❌ SUSPENDED CANNOT SYNC
  },
  CANCELLED: {
    name: 'CANCELLED',
    price: 0,
    maxMappings: 0,
    maxRules: 0,
    allowedObjects: [],
    trialDays: null,
    canSync: false  // ❌ CANCELLED CANNOT SYNC
  }
};

async function getPortalTier(portalId) {
  const p = getPool();
  try {
    const result = await p.query(
      'SELECT tier, created_at, paystack_customer_id, paystack_subscription_id, paystack_subscription_status FROM portal_tiers WHERE portal_id = $1',
      [portalId]
    );
    
    if (result.rows.length === 0) {
      // New portal - default to FREE tier
      await p.query(
        'INSERT INTO portal_tiers (portal_id, tier, created_at) VALUES ($1, $2, NOW()) ON CONFLICT (portal_id) DO NOTHING',
        [portalId, 'free']
      );
      return {
        tier: 'free',
        created_at: new Date(),
        isExpired: false,
        canSync: true,  // ✅ FREE CAN SYNC
        ...TIERS.FREE
      };
    }
    
    const row = result.rows[0];
    // Normalize tier to uppercase for lookup, lowercase for storage
    const tierUpper = row.tier.toUpperCase();
    const tierConfig = TIERS[tierUpper] || TIERS.FREE;
    
    // Check if trial is expired
    let isExpired = false;
    if (tierConfig.trialDays) {
      const createdDate = new Date(row.created_at);
      const expiryDate = new Date(createdDate.getTime() + (tierConfig.trialDays * 86400000));
      isExpired = Date.now() > expiryDate.getTime();
    }
    
    // Determine if portal can sync
    let canSync = tierConfig.canSync;
    if (isExpired) {
      canSync = false;  // Expired trials cannot sync
    }
    
    return {
      tier: row.tier.toLowerCase(),  // Return lowercase for consistency
      created_at: row.created_at,
      paystack_customer_id: row.paystack_customer_id,
      paystack_subscription_id: row.paystack_subscription_id,
      paystack_subscription_status: row.paystack_subscription_status,
      isExpired,
      canSync,
      ...tierConfig
    };
  } catch (err) {
    console.error('[Tiers] Get tier error:', err.message);
    // On error, default to FREE tier (allow syncing)
    return {
      tier: 'free',
      created_at: new Date(),
      isExpired: false,
      canSync: true,
      ...TIERS.FREE
    };
  }
}

async function setPortalTier(portalId, tier, paystackData = {}) {
  const p = getPool();
  // Validate tier exists (check uppercase version)
  const tierUpper = tier.toUpperCase();
  if (!TIERS[tierUpper]) {
    throw new Error(`Invalid tier: ${tier}`);
  }
  
  // Store lowercase in database (frontend expects lowercase)
  const validTier = tier.toLowerCase();
  
  const { customer_id, subscription_id, subscription_status } = paystackData;
  
  await p.query(`
    INSERT INTO portal_tiers (portal_id, tier, created_at, paystack_customer_id, paystack_subscription_id, paystack_subscription_status, updated_at)
    VALUES ($1, $2, NOW(), $3, $4, $5, NOW())
    ON CONFLICT (portal_id) DO UPDATE SET
      tier = $2,
      paystack_customer_id = COALESCE($3, portal_tiers.paystack_customer_id),
      paystack_subscription_id = COALESCE($4, portal_tiers.paystack_subscription_id),
      paystack_subscription_status = COALESCE($5, portal_tiers.paystack_subscription_status),
      updated_at = NOW()
  `, [portalId, validTier, customer_id, subscription_id, subscription_status]);
  
  return { tier: validTier };
}

// ✅ NEW: Check if object type is allowed for this tier
function isObjectAllowed(tier, objectType) {
  const tierUpper = tier.toUpperCase();
  const tierConfig = TIERS[tierUpper] || TIERS.FREE;
  return tierConfig.allowedObjects.includes(objectType);
}

async function getAllPortals() {
  const p = getPool();
  try {
    const result = await p.query(`
      SELECT 
        pt.portal_id,
        pt.tier,
        pt.created_at,
        pt.paystack_customer_id,
        pt.paystack_subscription_id,
        pt.paystack_subscription_status,
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

module.exports = {
  TIERS,
  getPortalTier,
  setPortalTier,
  getAllPortals,
  isObjectAllowed  // ✅ EXPORT THIS
};
