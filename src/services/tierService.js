// src/services/tierService.js - COMPLETE VERSION WITH PAYSTACK COLUMNS
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
    trialDays: null
  },
  TRIAL: {
    name: 'TRIAL',
    price: 0,
    maxMappings: 30,
    maxRules: Infinity,
    allowedObjects: ['contacts', 'companies', 'deals', 'tickets', 'leads', 'projects'],
    trialDays: 7
  },
  STARTER: {
    name: 'STARTER',
    price: 7,
    maxMappings: 10,
    maxRules: Infinity,
    allowedObjects: ['contacts', 'companies', 'deals'],
    trialDays: null
  },
  PRO: {
    name: 'PRO',
    price: 15,
    maxMappings: 30,
    maxRules: Infinity,
    allowedObjects: ['contacts', 'companies', 'deals', 'tickets', 'leads', 'projects'],
    trialDays: null
  },
  BUSINESS: {
    name: 'BUSINESS',
    price: 25,
    maxMappings: 100,
    maxRules: Infinity,
    allowedObjects: ['contacts', 'companies', 'deals', 'tickets', 'leads', 'projects'],
    trialDays: null
  },
  SUSPENDED: {
    name: 'SUSPENDED',
    price: 0,
    maxMappings: 0,
    maxRules: 0,
    allowedObjects: [],
    trialDays: null
  },
  CANCELLED: {
    name: 'CANCELLED',
    price: 0,
    maxMappings: 0,
    maxRules: 0,
    allowedObjects: [],
    trialDays: null
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
      await p.query(
        'INSERT INTO portal_tiers (portal_id, tier, created_at) VALUES ($1, $2, NOW()) ON CONFLICT (portal_id) DO NOTHING',
        [portalId, 'trial']
      );
      return { tier: 'trial', created_at: new Date(), expired: false };
    }
    
    const row = result.rows[0];
    // Normalize tier to lowercase for frontend
    const tier = row.tier.toLowerCase();
    const tierConfig = TIERS[tier.toUpperCase()] || TIERS.TRIAL;
    
    let expired = false;
    if (tierConfig.trialDays) {
      const createdDate = new Date(row.created_at);
      const expiryDate = new Date(createdDate.getTime() + (tierConfig.trialDays * 86400000));
      expired = Date.now() > expiryDate.getTime();
    }
    
    return {
      tier: tier,  // Use normalized lowercase tier
      created_at: row.created_at,
      paystack_customer_id: row.paystack_customer_id,
      paystack_subscription_id: row.paystack_subscription_id,
      paystack_subscription_status: row.paystack_subscription_status,
      expired
    };
  } catch (err) {
    console.error('[Tiers] Get tier error:', err.message);
    return { tier: 'trial', created_at: new Date(), expired: false };
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
  getAllPortals
};
