// src/routes/admin.js - COMPLETE VERSION WITH SYNC ERRORS & AUTO-POPULATION
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

// ✅ UPDATED: GET /admin/portals - Auto-populate missing portals
router.get('/portals', requireAdmin, async (req, res) => {
  const p = getPool();
  
  try {
    // ✅ AUTO-POPULATE: Add any portals from tokens table that aren't in portal_tiers
    await p.query(`
      INSERT INTO portal_tiers (portal_id, tier, created_at)
      SELECT DISTINCT t.portal_id, 'TRIAL', NOW()
      FROM tokens t
      WHERE t.portal_id NOT IN (SELECT portal_id FROM portal_tiers)
      ON CONFLICT (portal_id) DO NOTHING
    `);
    
    // Get all portals with enriched data
    const portals = await getAllPortals();
    
    // ✅ Get sync error counts for each portal
    const errorCounts = await p.query(`
      SELECT portal_id, COUNT(*) as error_count
      FROM sync_logs
      WHERE status = 'error' AND sync_time > NOW() - INTERVAL '24 hours'
      GROUP BY portal_id
    `);
    
    const errorMap = {};
    errorCounts.rows.forEach(row => {
      errorMap[row.portal_id] = parseInt(row.error_count);
    });
    
    // Enrich portals with error counts
    const enrichedPortals = portals.map(portal => ({
      ...portal,
      recent_errors: errorMap[portal.portal_id] || 0
    }));
    
    res.json({ portals: enrichedPortals });
    
  } catch (err) {
    console.error('[Admin] Error getting portals:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/portals/:portalId/tier
router.post('/portals/:portalId/tier', requireAdmin, async (req, res) => {
  const { portalId } = req.params;
  const { tier }     = req.body;
  if (!TIERS[tier]) return res.status(400).json({ error: 'Invalid tier' });
  await setPortalTier(portalId, tier);
  console.log(`[Admin] Portal ${portalId} tier set to ${tier}`);
  res.json({ ok: true });
});

// ✅ NEW: GET /admin/portals/:portalId/sync-errors
router.get('/portals/:portalId/sync-errors', requireAdmin, async (req, res) => {
  const { portalId } = req.params;
  const p = getPool();
  
  try {
    const result = await p.query(`
      SELECT sync_time, status, error_message, records_synced, object_type
      FROM sync_logs
      WHERE portal_id = $1
      ORDER BY sync_time DESC
      LIMIT 50
    `, [portalId]);
    
    res.json({ errors: result.rows });
  } catch (err) {
    console.error('[Admin] Error getting sync errors:', err.message);
    res.json({ errors: [] });
  }
});

// ✅ NEW: Initialize sync_logs table
async function initSyncLogsTable() {
  const p = getPool();
  if (!p) return;
  
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS sync_logs (
        id SERIAL PRIMARY KEY,
        portal_id TEXT NOT NULL,
        sync_time TIMESTAMP DEFAULT NOW(),
        status TEXT, -- 'success', 'error', 'blocked'
        error_message TEXT,
        records_synced INTEGER DEFAULT 0,
        object_type TEXT,
        rule_name TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_sync_logs_portal ON sync_logs(portal_id);
      CREATE INDEX IF NOT EXISTS idx_sync_logs_time ON sync_logs(sync_time);
    `);
    console.log('[Admin] Sync logs table ready');
  } catch (err) {
    console.error('[Admin] Sync logs table error:', err.message);
  }
}

// Initialize on load
initSyncLogsTable();

// POST /admin/notify
router.post('/notify', requireAdmin, async (req, res) => {
  const { portalId, all, type, title, message, actionLabel, actionUrl } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'Missing title or message' });
  const notification = { type: type || 'info', title, message, actionLabel: actionLabel || null, actionUrl: actionUrl || null };
  let sent = 0;
  try {
    if (all) {
      const portals = await getAllPortals();
      for (const portal of portals) {
        await createNotification(portal.portal_id, notification);
        sent++;
      }
    } else if (portalId) {
      await createNotification(String(portalId), notification);
      sent = 1;
    } else {
      return res.status(400).json({ error: 'Provide portalId or all:true' });
    }
    console.log(`[Admin] Sent notification to ${sent} portal(s): "${title}"`);
    res.json({ ok: true, sent });
  } catch (err) {
    console.error('[Admin] Notify error:', err.message);
    res.status(500).json({ error: err.message, sent: 0 });
  }
});

// GET /admin/notifications
router.get('/notifications', requireAdmin, async (req, res) => {
  const notifications = await getAllNotifications();
  res.json({ notifications });
});

// POST /admin/run-checks
router.post('/run-checks', requireAdmin, async (req, res) => {
  await runAutomatedChecks();
  res.json({ ok: true });
});

// ── EMAIL RULES ────────────────────────────────────────────

// GET /admin/email-rules
router.get('/email-rules', requireAdmin, async (req, res) => {
  const rules = await getAllRules();
  res.json({ rules });
});

// PUT /admin/email-rules/:id
router.put('/email-rules/:id', requireAdmin, async (req, res) => {
  const { id }                         = req.params;
  const { subject, body, enabled, name } = req.body;
  await updateRule(id, { subject, body, enabled, name });
  res.json({ ok: true });
});

// POST /admin/email-rules/:id/test
router.post('/email-rules/:id/test', requireAdmin, async (req, res) => {
  const { id }    = req.params;
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Missing email' });
  try {
    const sent = await sendRuleEmail(id, email, 'test-portal', {
      portalId:    'test-portal',
      planName:    'Pro',
      planPrice:   'R540/month',
      maxRules:    'Unlimited',
      maxMappings: '30',
      daysLeft:    '7',
      fromTier:    'TRIAL',
      toTier:      'PRO'
    });
    res.json({ ok: sent });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /admin/email-rules/:id/reset
router.post('/email-rules/:id/reset', requireAdmin, async (req, res) => {
  const p = getPool();
  try {
    await p.query('DELETE FROM email_rules WHERE id = $1', [req.params.id]);
    await seedDefaultRules();
  } catch (err) {
    console.error('[Admin] Reset rule error:', err.message);
  }
  res.json({ ok: true });
});

// GET /admin/email-log
router.get('/email-log', requireAdmin, async (req, res) => {
  const logs = await getEmailLog();
  res.json({ logs });
});

module.exports = router;
