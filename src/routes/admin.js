// src/routes/admin.js
const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const { getPortalTier, setPortalTier, getAllPortals, TIERS } = require('../services/tierService');
const { createNotification, getAllNotifications, runAutomatedChecks } = require('../services/notificationService');
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
  if (req.session && req.session.adminId) return next();
  if (req.accepts('html')) return res.redirect('/admin/auth/login');
  res.status(401).json({ error: 'Not authenticated' });
}

// ── GET /admin/api/portals ────────────────────────────────────────────────────
router.get('/portals', requireAdmin, async (req, res) => {
  const p = getPool();
  try {
    await p.query(`
      INSERT INTO portal_tiers (portal_id, tier, created_at)
      SELECT DISTINCT t.portal_id, 'trial', NOW()
      FROM tokens t
      WHERE t.portal_id NOT IN (SELECT portal_id FROM portal_tiers)
      ON CONFLICT (portal_id) DO NOTHING
    `).catch(() => {});

    const portals = await getAllPortals();

    const enriched = await Promise.all(portals.map(async (portal) => {
      let syncRuleCount = 0;
      let totalMappings = 0;
      let userCount = 0;
      let hasToken = false;

      try {
        const r = await p.query('SELECT rules FROM sync_rules WHERE portal_id = $1', [String(portal.portal_id)]);
        if (r.rows.length > 0) {
          const rules = r.rows[0].rules || [];
          syncRuleCount = rules.length;
          totalMappings = rules.reduce((sum, r) => sum + (r.mappings?.length || 0), 0);
        }
      } catch (e) {}

      try {
        const r = await p.query(
          'SELECT COUNT(*) as count FROM portal_users WHERE portal_id = $1 AND is_active = true',
          [String(portal.portal_id)]
        );
        userCount = parseInt(r.rows[0]?.count || 0);
      } catch (e) {}

      try {
        const r = await p.query('SELECT 1 FROM tokens WHERE portal_id = $1', [String(portal.portal_id)]);
        hasToken = r.rows.length > 0;
      } catch (e) {}

      return { ...portal, sync_rule_count: syncRuleCount, total_mappings: totalMappings, user_count: userCount, has_token: hasToken };
    }));

    res.json({ portals: enriched });
  } catch (err) {
    console.error('[Admin] Error getting portals:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/api/portals/:portalId/users ────────────────────────────────────
router.get('/portals/:portalId/users', requireAdmin, async (req, res) => {
  const p = getPool();
  const { portalId } = req.params;
  try {
    const result = await p.query(`
      SELECT
        u.id,
        u.email,
        u.full_name,
        u.last_login,
        u.email_verified,
        u.is_active,
        u.created_at  AS registered_at,
        pu.role,
        pu.invited_at,
        pu.is_active  AS portal_active
      FROM portal_users pu
      JOIN users u ON u.id = pu.user_id
      WHERE pu.portal_id = $1
      ORDER BY
        CASE pu.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END,
        u.full_name ASC
    `, [String(portalId)]);

    res.json({ users: result.rows, portalId });
  } catch (err) {
    console.error('[Admin] Error getting portal users:', err.message);
    res.json({ users: [], portalId, note: err.message });
  }
});

// ── DELETE /admin/api/portals/:portalId ───────────────────────────────────────
// Removes a portal connection entirely:
// - tokens (HubSpot OAuth connection)
// - sync_rules
// - portal_tiers
// - portal_users (if any)
// - notifications (if any)
router.delete('/portals/:portalId', requireAdmin, async (req, res) => {
  const p = getPool();
  const { portalId } = req.params;
  const id = String(portalId);

  try {
    const deleted = {};

    // 1. Remove HubSpot OAuth token
    try {
      const r = await p.query('DELETE FROM tokens WHERE portal_id = $1', [id]);
      deleted.tokens = r.rowCount;
    } catch (e) { deleted.tokens = 0; }

    // 2. Remove sync rules
    try {
      const r = await p.query('DELETE FROM sync_rules WHERE portal_id = $1', [id]);
      deleted.sync_rules = r.rowCount;
    } catch (e) { deleted.sync_rules = 0; }

    // 3. Remove portal tier
    try {
      const r = await p.query('DELETE FROM portal_tiers WHERE portal_id = $1', [id]);
      deleted.portal_tiers = r.rowCount;
    } catch (e) { deleted.portal_tiers = 0; }

    // 4. Remove portal users
    try {
      const r = await p.query('DELETE FROM portal_users WHERE portal_id = $1', [id]);
      deleted.portal_users = r.rowCount;
    } catch (e) { deleted.portal_users = 0; }

    // 5. Remove notifications
    try {
      const r = await p.query('DELETE FROM notifications WHERE portal_id = $1', [id]);
      deleted.notifications = r.rowCount;
    } catch (e) { deleted.notifications = 0; }

    // 6. Remove polling sync times
    try {
      const r = await p.query('DELETE FROM polling_sync_times WHERE portal_id = $1', [id]);
      deleted.polling_sync_times = r.rowCount;
    } catch (e) { deleted.polling_sync_times = 0; }

    console.log(`[Admin] Deleted portal ${id}:`, deleted);
    res.json({ ok: true, portalId: id, deleted });

  } catch (err) {
    console.error('[Admin] Delete portal error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/api/users/:userId/send-reset ──────────────────────────────────
router.post('/users/:userId/send-reset', requireAdmin, async (req, res) => {
  const p = getPool();
  const { userId } = req.params;

  try {
    const userResult = await p.query(
      'SELECT id, email, full_name FROM users WHERE id = $1',
      [parseInt(userId)]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt  = new Date(Date.now() + 60 * 60 * 1000);

    await p.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, resetToken, expiresAt]
    );

    const appUrl   = process.env.APP_URL || process.env.APP_BASE_URL || 'https://portal.syncstation.app';
    const resetUrl = `${appUrl}/reset-password?token=${resetToken}`;

    let emailSent = false;
    try {
      const emailService = require('../services/emailService_auth');
      await emailService.sendPasswordResetEmail(user.email, user.full_name, resetToken);
      emailSent = true;
    } catch (e) {
      console.log('[Admin] Email not sent:', e.message);
    }

    res.json({ success: true, userId: user.id, email: user.email, name: user.full_name, resetUrl, emailSent, expiresAt });

  } catch (err) {
    console.error('[Admin] Send reset error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/api/portals/:portalId/tier ────────────────────────────────────
router.post('/portals/:portalId/tier', requireAdmin, async (req, res) => {
  try {
    const { portalId } = req.params;
    const { tier }     = req.body;

    if (!TIERS[tier.toUpperCase()]) {
      return res.status(400).json({ error: 'Invalid tier' });
    }

    const result = await setPortalTier(portalId, tier.toLowerCase());
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[Admin] Error setting tier:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/api/notify ────────────────────────────────────────────────────
router.post('/notify', requireAdmin, async (req, res) => {
  try {
    const { portalId, all, type, title, message, actionLabel, actionUrl } = req.body;

    if (!title || !message) return res.status(400).json({ error: 'Missing title or message' });

    if (all) {
      const portals = await getAllPortals();
      let sent = 0;
      for (const portal of portals) {
        await createNotification(portal.portal_id, { type, title, message, actionLabel, actionUrl });
        sent++;
      }
      return res.json({ sent });
    }

    if (!portalId) return res.status(400).json({ error: 'Missing portalId' });

    await createNotification(portalId, { type, title, message, actionLabel, actionUrl });
    res.json({ sent: 1 });
  } catch (err) {
    console.error('[Admin] Error sending notification:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/api/notifications ─────────────────────────────────────────────
router.get('/notifications', requireAdmin, async (req, res) => {
  try {
    const notifications = await getAllNotifications();
    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/api/run-checks ────────────────────────────────────────────────
router.post('/run-checks', requireAdmin, async (req, res) => {
  try {
    await runAutomatedChecks();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/api/portals/:portalId/logs ────────────────────────────────────
router.get('/portals/:portalId/logs', requireAdmin, async (req, res) => {
  const p = getPool();
  const { portalId } = req.params;
  const { status, limit = 100, offset = 0 } = req.query;

  try {
    let query = `
      SELECT id, portal_id, sync_time, status, error_message,
             records_synced, object_type, rule_name,
             COALESCE(trigger_type, 'polling') AS trigger_type
      FROM sync_logs
      WHERE portal_id = $1
    `;
    const params = [String(portalId)];

    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY sync_time DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await p.query(query, params);

    // Get summary counts
    const summary = await p.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'success') AS success_count,
        COUNT(*) FILTER (WHERE status = 'error')   AS error_count,
        COUNT(*) FILTER (WHERE status = 'blocked') AS blocked_count,
        COUNT(*)                                   AS total_count,
        MAX(sync_time) FILTER (WHERE status = 'success') AS last_success,
        MAX(sync_time) FILTER (WHERE status = 'error')   AS last_error
      FROM sync_logs WHERE portal_id = $1
    `, [String(portalId)]);

    res.json({
      logs:    result.rows,
      summary: summary.rows[0],
      portalId
    });
  } catch (err) {
    console.error('[Admin] Logs error:', err.message);
    res.json({ logs: [], summary: {}, portalId, error: err.message });
  }
});

// ── GET /admin/api/logs/errors ────────────────────────────────────────────────
// Get all recent errors across all portals
router.get('/logs/errors', requireAdmin, async (req, res) => {
  const p = getPool();
  try {
    const result = await p.query(`
      SELECT portal_id, sync_time, error_message, object_type, rule_name,
             COALESCE(trigger_type, 'polling') AS trigger_type
      FROM sync_logs
      WHERE status = 'error'
      ORDER BY sync_time DESC
      LIMIT 200
    `);
    res.json({ errors: result.rows });
  } catch (err) {
    res.json({ errors: [], error: err.message });
  }
});

module.exports = router;
