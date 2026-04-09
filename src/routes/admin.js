// src/routes/admin.js - COMPLETE VERSION WITH PAYSTACK COLUMNS
const express    = require('express');
const router     = express.Router();
const path       = require('path');
const { getPortalTier, setPortalTier, getAllPortals, TIERS } = require('../services/tierService');
const { createNotification, getAllNotifications, runAutomatedChecks } = require('../services/notificationService');
const { getAllRules, getRule, updateRule, getEmailLog, seedDefaultRules } = require('../services/emailRulesService');
const { sendRuleEmail } = require('../services/emailService');
const { Pool } = require('pg');

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

function requireAdmin(req, res, next) {
  const key = req.query.key || req.headers['x-admin-key'];
  if (process.env.ADMIN_KEY && key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// GET /admin
router.get('/', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// GET /admin/portals - Auto-populate missing portals
router.get('/portals', requireAdmin, async (req, res) => {
  const p = getPool();
  
  try {
    // AUTO-POPULATE: Add any portals from tokens table that aren't in portal_tiers
    await p.query(`
      INSERT INTO portal_tiers (portal_id, tier, created_at)
      SELECT DISTINCT t.portal_id, 'TRIAL', NOW()
      FROM tokens t
      WHERE t.portal_id NOT IN (SELECT portal_id FROM portal_tiers)
      ON CONFLICT (portal_id) DO NOTHING
    `);
    
    // Get all portals with enriched data
    const portals = await getAllPortals();
    res.json({ portals });
  } catch (err) {
    console.error('[Admin] Error getting portals:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/portals/:portalId/tier
router.post('/portals/:portalId/tier', requireAdmin, async (req, res) => {
  try {
    const { portalId } = req.params;
    const { tier } = req.body;
    
    if (!TIERS[tier.toUpperCase()]) {
      return res.status(400).json({ error: 'Invalid tier' });
    }
    
    await setPortalTier(portalId, tier.toUpperCase());
    res.json({ ok: true });
  } catch (err) {
    console.error('[Admin] Error setting tier:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/portals/:portalId/sync-errors
router.get('/portals/:portalId/sync-errors', requireAdmin, async (req, res) => {
  const p = getPool();
  
  try {
    const { portalId } = req.params;
    const result = await p.query(`
      SELECT * FROM sync_logs
      WHERE portal_id = $1 AND status = 'error'
      ORDER BY created_at DESC
      LIMIT 20
    `, [portalId]);
    
    res.json({ errors: result.rows });
  } catch (err) {
    console.error('[Admin] Error getting sync errors:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/notify
router.post('/notify', requireAdmin, async (req, res) => {
  try {
    const { portalId, all, type, title, message, actionLabel, actionUrl } = req.body;
    
    if (!title || !message) {
      return res.status(400).json({ error: 'Missing title or message' });
    }
    
    if (all) {
      const portals = await getAllPortals();
      let sent = 0;
      for (const portal of portals) {
        await createNotification(portal.portal_id, { type, title, message, actionLabel, actionUrl });
        sent++;
      }
      return res.json({ sent });
    }
    
    if (!portalId) {
      return res.status(400).json({ error: 'Missing portalId' });
    }
    
    await createNotification(portalId, { type, title, message, actionLabel, actionUrl });
    res.json({ sent: 1 });
  } catch (err) {
    console.error('[Admin] Error sending notification:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/notifications
router.get('/notifications', requireAdmin, async (req, res) => {
  try {
    const notifications = await getAllNotifications();
    res.json({ notifications });
  } catch (err) {
    console.error('[Admin] Error getting notifications:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/run-checks
router.post('/run-checks', requireAdmin, async (req, res) => {
  try {
    await runAutomatedChecks();
    res.json({ ok: true });
  } catch (err) {
    console.error('[Admin] Error running checks:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
