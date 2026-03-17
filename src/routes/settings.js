// src/routes/settings.js
const express       = require('express');
const router        = express.Router();
const path          = require('path');
const { getClient } = require('../services/hubspotClient');
const { Pool }      = require('pg');

let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    pool.query(`
      CREATE TABLE IF NOT EXISTS sync_rules (
        portal_id TEXT PRIMARY KEY,
        rules JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `).catch(err => console.error('[DB] sync_rules table error:', err.message));
  }
  return pool;
}

// In-memory fallback
const memRulesStore = {};

async function getRules(portalId) {
  const p = getPool();
  if (p) {
    try {
      const result = await p.query('SELECT rules FROM sync_rules WHERE portal_id = $1', [String(portalId)]);
      return result.rows[0]?.rules || [];
    } catch (err) {
      console.error('[DB] Get rules error:', err.message);
    }
  }
  return memRulesStore[portalId] || [];
}

async function saveRules(portalId, rules) {
  const p = getPool();
  if (p) {
    try {
      await p.query(`
        INSERT INTO sync_rules (portal_id, rules, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (portal_id) DO UPDATE SET rules = $2, updated_at = NOW()
      `, [String(portalId), JSON.stringify(rules)]);
      return;
    } catch (err) {
      console.error('[DB] Save rules error:', err.message);
    }
  }
  memRulesStore[portalId] = rules;
}

// ── GET /settings ─────────────────────────────────────────────
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/settings.html'));
});

// ── GET /settings/rules ───────────────────────────────────────
router.get('/rules', async (req, res) => {
  const { portalId } = req.query;
  if (!portalId) return res.status(400).json({ error: 'Missing portalId' });
  const rules = await getRules(portalId);
  res.json({ rules });
});

// ── POST /settings/rules ──────────────────────────────────────
router.post('/rules', async (req, res) => {
  const { portalId, rules } = req.body;
  if (!portalId) return res.status(400).json({ error: 'Missing portalId' });
  await saveRules(portalId, rules || []);
  console.log(`[Settings] Saved ${rules?.length || 0} rules for portal ${portalId}`);
  res.json({ ok: true });
});

// ── GET /settings/properties/:objectType ─────────────────────
router.get('/properties/:objectType', async (req, res) => {
  const { objectType } = req.params;
  const { portalId }   = req.query;

  if (!portalId) return res.status(400).json({ error: 'Missing portalId', properties: [] });

  try {
    const client = await getClient(portalId);
    const response = await client.crm.properties.coreApi.getAll(objectType);
    const properties = (response.results || [])
      .filter(p => !p.hidden && !p.calculated)
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(p => ({ name: p.name, label: p.label, type: p.type }));
    res.json({ properties });
  } catch (err) {
    console.error('[Settings] Properties error:', err.message);
    // If token expired or missing, return helpful error
    if (err.message.includes('not installed') || err.message.includes('token')) {
      return res.status(401).json({ 
        error: 'App not connected. Please reinstall.', 
        reinstallUrl: `${process.env.APP_BASE_URL}/oauth/install`,
        properties: [] 
      });
    }
    res.status(500).json({ error: err.message, properties: [] });
  }
});

// Export for use in crmcard
module.exports = router;
module.exports.getRules = getRules;

// Override POST /settings/rules to also sync webhooks
const webhookManager = require('../services/webhookManager');

router.post('/rules/sync-webhooks', async (req, res) => {
  try {
    const tokenStore = require('../services/tokenStore');
    const allTokens  = await tokenStore.getAll();
    const allRules   = {};
    for (const portalId of Object.keys(allTokens)) {
      allRules[portalId] = await getRules(portalId);
    }
    await webhookManager.syncSubscriptions(allRules);
    res.json({ ok: true, message: 'Webhook subscriptions synced' });
  } catch (err) {
    console.error('[Settings] Webhook sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /settings/sync-webhooks - trigger webhook subscription sync
router.get('/sync-webhooks', async (req, res) => {
  try {
    const { portalId } = req.query;
    const webhookManager = require('../services/webhookManager');
    const tokenStore = require('../services/tokenStore');
    const allTokens = await tokenStore.getAll();
    const allRules = {};
    for (const pid of Object.keys(allTokens)) {
      allRules[pid] = await getRules(pid);
    }
    await webhookManager.syncSubscriptions(allRules);
    res.json({ ok: true, portals: Object.keys(allTokens), message: 'Webhook subscriptions synced!' });
  } catch (err) {
    console.error('[Settings] Webhook sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
