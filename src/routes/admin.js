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
    // Get users from portal_users table (new auth system)
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

    // Fallback: if no portal_users, show the HubSpot token installer email
    let users = result.rows;
    if (users.length === 0) {
      try {
        const tokenResult = await p.query(
          `SELECT data->>'installerEmail' AS email, data->>'hub_id' AS hub_id, updated_at
           FROM tokens WHERE portal_id = $1`,
          [String(portalId)]
        );
        if (tokenResult.rows.length > 0 && tokenResult.rows[0].email) {
          users = [{
            id: null,
            email: tokenResult.rows[0].email,
            full_name: 'HubSpot Owner (OAuth)',
            last_login: tokenResult.rows[0].updated_at,
            email_verified: true,
            is_active: true,
            registered_at: tokenResult.rows[0].updated_at,
            role: 'owner',
            portal_active: true,
            auth_source: 'hubspot_oauth'
          }];
        }
      } catch (e) {}
    }

    res.json({ users, portalId });
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
    // Check which optional columns exist
    let hasTriggerType = false, hasRecordIds = false;
    try { await p.query("SELECT trigger_type FROM sync_logs LIMIT 1"); hasTriggerType = true; } catch(e) {}
    try { await p.query("SELECT source_record_id FROM sync_logs LIMIT 1"); hasRecordIds = true; } catch(e) {}

    let query = `
      SELECT id, portal_id, sync_time, status, error_message,
             records_synced, object_type, rule_name
             ${hasTriggerType ? ", COALESCE(trigger_type, 'polling') AS trigger_type" : ", 'polling' AS trigger_type"}
             ${hasRecordIds ? ", source_record_id, target_record_id" : ", NULL AS source_record_id, NULL AS target_record_id"}
      FROM sync_logs
      WHERE portal_id = $1
    `;
    const params = [String(portalId)];

    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    const { recordId } = req.query;
    if (recordId) {
      query += ` AND (source_record_id = $${params.length + 1} OR target_record_id = $${params.length + 1})`;
      params.push(recordId);
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
    `, [String(portalId)]).catch(() => ({ rows: [{}] }));

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

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL TEMPLATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/email-templates', requireAdmin, async (req, res) => {
  try {
    const p = getPool();
    // Auto-create tables if they don't exist yet
    await p.query(`
      CREATE TABLE IF NOT EXISTS email_templates (
        id SERIAL PRIMARY KEY, journey_key VARCHAR(64) UNIQUE NOT NULL,
        name VARCHAR(128) NOT NULL, subject TEXT NOT NULL, heading TEXT NOT NULL,
        body TEXT NOT NULL, button_text TEXT, button_url TEXT, footer TEXT,
        is_active BOOLEAN DEFAULT true, updated_at TIMESTAMPTZ DEFAULT NOW(), updated_by TEXT,
        logo_url TEXT, hero_image_url TEXT
      )`);
    // Add new columns if they don't exist (safe migration)
    await p.query(`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS logo_url TEXT`).catch(()=>{});
    await p.query(`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS hero_image_url TEXT`).catch(()=>{});
    await p.query(`
      CREATE TABLE IF NOT EXISTS email_journeys (
        id SERIAL PRIMARY KEY, journey_key VARCHAR(64) UNIQUE NOT NULL,
        trigger_event VARCHAR(64) NOT NULL, delay_days INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true, last_run TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await p.query(`
      CREATE TABLE IF NOT EXISTS email_log (
        id SERIAL PRIMARY KEY, journey_key VARCHAR(64), recipient TEXT NOT NULL,
        portal_id TEXT, subject TEXT, status VARCHAR(16) DEFAULT 'sent',
        error TEXT, sent_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    const [tmplResult, journeyResult] = await Promise.all([
      p.query('SELECT * FROM email_templates ORDER BY journey_key ASC'),
      p.query('SELECT * FROM email_journeys ORDER BY journey_key ASC')
    ]);
    const journeyMap = {};
    journeyResult.rows.forEach(j => { journeyMap[j.journey_key] = j; });
    res.json({ templates: tmplResult.rows.map(t => ({ ...t, journey: journeyMap[t.journey_key] || null })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/email-templates/:key', requireAdmin, async (req, res) => {
  const { key } = req.params;
  const { subject, heading, body, button_text, button_url, footer, is_active, logo_url, hero_image_url } = req.body;
  try {
    const p = getPool();
    await p.query(
      `UPDATE email_templates SET subject=$1, heading=$2, body=$3, button_text=$4, button_url=$5, footer=$6, is_active=$7, updated_at=NOW(), logo_url=$9, hero_image_url=$10 WHERE journey_key=$8`,
      [subject, heading, body, button_text, button_url, footer, is_active, key, logo_url||null, hero_image_url||null]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/email-journeys/:key', requireAdmin, async (req, res) => {
  const { key } = req.params;
  const { delay_days, is_active } = req.body;
  try {
    const p = getPool();
    await p.query(`UPDATE email_journeys SET delay_days=$1, is_active=$2 WHERE journey_key=$3`, [delay_days, is_active, key]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/email-log', requireAdmin, async (req, res) => {
  try {
    const p = getPool();
    const result = await p.query('SELECT * FROM email_log ORDER BY sent_at DESC LIMIT 200');
    res.json({ logs: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/email-test', requireAdmin, async (req, res) => {
  const { journey_key, recipient } = req.body;
  if (!journey_key || !recipient) return res.status(400).json({ error: 'journey_key and recipient required' });
  try {
    const p = getPool();
    const tmpl = await p.query('SELECT * FROM email_templates WHERE journey_key = $1', [journey_key]);
    if (!tmpl.rows.length) return res.status(404).json({ error: 'Template not found' });
    const t = tmpl.rows[0];
    const appUrl = process.env.APP_URL || 'https://portal.syncstation.app';
    const replace = str => (str || '')
      .replace(/\{\{name\}\}/g, 'Test User').replace(/\{\{inviter\}\}/g, 'Admin')
      .replace(/\{\{portal_id\}\}/g, '12345678').replace(/\{\{days_since\}\}/g, '5')
      .replace(/\{\{token\}\}/g, 'test-token-preview').replace(/\{\{invite_url\}\}/g, appUrl + '/register?invite=test')
      .replace(/\{\{app_url\}\}/g, appUrl);
    const subject  = replace(t.subject) + ' [TEST]';
    const bodyHtml = replace(t.body).split('\n').map(l => l.trim() ? `<p style="margin:8px 0;font-size:15px;line-height:1.6;color:#c0c0d0">${l}</p>` : '<br>').join('');
    const btnText  = replace(t.button_text);
    const btnUrl   = replace(t.button_url);
    const btnHtml  = btnText ? `<div style="text-align:center;margin:28px 0"><a href="${btnUrl}" style="background:#FF6B35;color:white;padding:13px 32px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block">${btnText}</a></div>` : '';
    const logoHtml = t.logo_url
      ? `<img src="${t.logo_url}" alt="Logo" style="height:36px;object-fit:contain;vertical-align:middle;margin-right:10px">`
      : `<span style="font-size:20px">🔄</span> `;
    const heroHtml = t.hero_image_url
      ? `<div style="margin:-36px -32px 28px;"><img src="${t.hero_image_url}" alt="" style="width:100%;max-height:200px;object-fit:cover;display:block"></div>`
      : '';
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="background:#0f0f11;margin:0;padding:40px 20px;font-family:'Helvetica Neue',Arial,sans-serif"><div style="max-width:580px;margin:0 auto;background:#18181c;border-radius:12px;overflow:hidden;border:1px solid #2e2e38"><div style="background:#0f0f11;padding:24px 32px;border-bottom:1px solid #2e2e38;display:flex;align-items:center;justify-content:space-between">${logoHtml}<span style="font-size:18px;font-weight:700;color:#f0f0f4">SyncStation</span><span style="background:#ff6b3520;color:#ff6b35;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;border:1px solid #ff6b3540">TEST</span></div><div style="padding:36px 32px">${heroHtml}<h1 style="font-size:22px;font-weight:700;color:#f0f0f4;margin:0 0 20px">${replace(t.heading)}</h1>${bodyHtml}${btnHtml}</div><div style="padding:20px 32px;border-top:1px solid #2e2e38;font-size:12px;color:#55556a">${replace(t.footer) || ''}</div></div></body></html>`;
    const { sendEmail } = require('../services/emailService');
    const sent = await sendEmail(recipient, subject, html);
    await p.query('INSERT INTO email_log (journey_key, recipient, subject, status) VALUES ($1,$2,$3,$4)', [journey_key, recipient, subject, sent ? 'sent' : 'failed']).catch(() => {});
    if (sent) res.json({ ok: true, message: `Test email sent to ${recipient}` });
    else res.status(500).json({ error: 'Email send failed — check RESEND_API_KEY in Railway env vars' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

// POST /admin/api/email-seed — seeds default templates if missing
router.post('/email-seed', requireAdmin, async (req, res) => {
  try {
    const p = getPool();
    // Ensure tables exist before seeding
    await p.query(`CREATE TABLE IF NOT EXISTS email_templates (id SERIAL PRIMARY KEY, journey_key VARCHAR(64) UNIQUE NOT NULL, name VARCHAR(128) NOT NULL, subject TEXT NOT NULL, heading TEXT NOT NULL, body TEXT NOT NULL, button_text TEXT, button_url TEXT, footer TEXT, is_active BOOLEAN DEFAULT true, updated_at TIMESTAMPTZ DEFAULT NOW(), updated_by TEXT)`);
    await p.query(`CREATE TABLE IF NOT EXISTS email_journeys (id SERIAL PRIMARY KEY, journey_key VARCHAR(64) UNIQUE NOT NULL, trigger_event VARCHAR(64) NOT NULL, delay_days INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT true, last_run TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await p.query(`CREATE TABLE IF NOT EXISTS email_log (id SERIAL PRIMARY KEY, journey_key VARCHAR(64), recipient TEXT NOT NULL, portal_id TEXT, subject TEXT, status VARCHAR(16) DEFAULT 'sent', error TEXT, sent_at TIMESTAMPTZ DEFAULT NOW())`);
    const appUrl = process.env.APP_URL || 'https://portal.syncstation.app';
    const templates = [
      ['new_account','New Account Welcome','Welcome to SyncStation!','Welcome to SyncStation 🎉','Hi {{name}},\n\nYour account has been created. Connect your HubSpot portal to get started.','Connect HubSpot',appUrl+'/oauth/install',"You received this because an account was created with this address.",'on_register',0],
      ['verify_email','Email Verification','Verify your SyncStation account','Verify your email address','Hi {{name}},\n\nPlease verify your email to complete setup. This link expires in 24 hours.','Verify Email',appUrl+'/verify-email?token={{token}}',"If you didn't create an account, ignore this email.",'on_register',0],
      ['forgot_password','Password Reset','Reset your SyncStation password','Reset your password','Hi {{name}},\n\nWe received a request to reset your password. This link expires in 1 hour.','Reset Password',appUrl+'/reset-password?token={{token}}',"This link expires in 1 hour.",'on_forgot_password',0],
      ['team_invite','Team Invitation','{{inviter}} invited you to join SyncStation',"You've been invited! 🤝",'Hi there,\n\n{{inviter}} has invited you to collaborate on their HubSpot portal on SyncStation.','Accept Invitation','{{invite_url}}',"This invitation expires in 7 days.",'on_invite',0],
      ['trial_ending_3','Trial Ending (3 days)','Your SyncStation trial ends in 3 days','Your free trial is almost up ⏰','Hi {{name}},\n\nYour SyncStation trial for portal {{portal_id}} ends in 3 days. Upgrade now to keep syncing.','Upgrade Now',appUrl+'/account',"Questions? Reply to this email.",'scheduled',4],
      ['trial_ended','Trial Ended','Your SyncStation trial has ended','Your trial has ended','Hi {{name}},\n\nYour free trial for portal {{portal_id}} has ended and syncing has been paused. Upgrade to resume.','Choose a Plan',appUrl+'/account',"Need help choosing a plan? Reply to this email.",'scheduled',0],
      ['account_suspended','Account Suspended','Your SyncStation account has been suspended','Account suspended','Hi {{name}},\n\nYour SyncStation account for portal {{portal_id}} has been suspended. Please update your billing.','Update Billing',appUrl+'/account',"If you think this is a mistake, contact support.",'scheduled',0],
      ['no_sync_rules','No Sync Rules Set Up',"You haven't set up any sync rules yet",'Ready to start syncing? 🔄','Hi {{name}},\n\nYou connected HubSpot {{days_since}} days ago but have no sync rules yet. Set one up in minutes.','Create a Sync Rule',appUrl+'/settings',"Need help? Reply to this email.",'scheduled',3]
    ];
    let inserted = 0;
    for (const [key,name,subj,head,body,btnTxt,btnUrl,foot,trigger,delay] of templates) {
      const r = await p.query(
        `INSERT INTO email_templates (journey_key,name,subject,heading,body,button_text,button_url,footer,is_active,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NOW())
         ON CONFLICT (journey_key) DO NOTHING`,
        [key,name,subj,head,body,btnTxt,btnUrl,foot]
      );
      if (r.rowCount > 0) inserted++;
      await p.query(
        `INSERT INTO email_journeys (journey_key,trigger_event,delay_days,is_active)
         VALUES ($1,$2,$3,true) ON CONFLICT (journey_key) DO NOTHING`,
        [key,trigger,delay]
      );
    }
    res.json({ ok: true, inserted, message: `${inserted} template(s) seeded` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
