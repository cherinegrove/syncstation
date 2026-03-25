// src/services/notificationService.js
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        portal_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        action_label TEXT,
        action_url TEXT,
        status TEXT NOT NULL DEFAULT 'unread',
        created_at TIMESTAMP DEFAULT NOW(),
        read_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_portal_id ON notifications(portal_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
    `).then(() => console.log('[Notifications] Tables ready'))
      .catch(err => console.error('[Notifications] Table error:', err.message));
  }
  return pool;
}

// Initialize on module load
getPool();

async function createNotification(portalId, { type, title, message, actionLabel, actionUrl }) {
  const p = getPool();
  if (!p) {
    console.error('[Notifications] No database pool available');
    return null;
  }
  try {
    const result = await p.query(
      `INSERT INTO notifications (portal_id, type, title, message, action_label, action_url)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [String(portalId), type || 'info', title, message, actionLabel || null, actionUrl || null]
    );
    console.log(`[Notifications] Created ID ${result.rows[0].id} for portal ${portalId}: "${title}"`);
    return result.rows[0].id;
  } catch (err) {
    console.error('[Notifications] Create error:', err.message);
    return null;
  }
}

async function getNotifications(portalId, includeRead = false) {
  const p = getPool();
  if (!p) return [];
  try {
    const query = includeRead
      ? 'SELECT * FROM notifications WHERE portal_id = $1 ORDER BY created_at DESC LIMIT 20'
      : "SELECT * FROM notifications WHERE portal_id = $1 AND status = 'unread' ORDER BY created_at DESC";
    const result = await p.query(query, [String(portalId)]);
    return result.rows;
  } catch (err) {
    console.error('[Notifications] Get error:', err.message);
    return [];
  }
}

async function markRead(notificationId) {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(
      "UPDATE notifications SET status = 'read', read_at = NOW() WHERE id = $1",
      [notificationId]
    );
  } catch (err) {
    console.error('[Notifications] Mark read error:', err.message);
  }
}

async function markAllRead(portalId) {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(
      "UPDATE notifications SET status = 'read', read_at = NOW() WHERE portal_id = $1 AND status = 'unread'",
      [String(portalId)]
    );
  } catch (err) {
    console.error('[Notifications] Mark all read error:', err.message);
  }
}

async function getAllNotifications(limit = 100) {
  const p = getPool();
  if (!p) return [];
  try {
    const result = await p.query(
      'SELECT * FROM notifications ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  } catch (err) {
    console.error('[Notifications] Get all error:', err.message);
    return [];
  }
}

async function notify(portalId, notification, emailTo = null) {
  const id = await createNotification(portalId, notification);
  if (emailTo && id) {
    const { sendEmail } = require('./emailService');
    const BASE = process.env.APP_BASE_URL || ('https://' + process.env.RAILWAY_PUBLIC_DOMAIN);
    await sendEmail(
      emailTo,
      notification.title,
      `<div style="font-family:sans-serif;max-width:560px;margin:40px auto;padding:32px;background:#18181c;border-radius:12px;color:#f0f0f4">
        <h2 style="color:#ff6b35">⇄ PropBridge</h2>
        <h3>${notification.title}</h3>
        <p style="color:#c0c0d0">${notification.message}</p>
        ${notification.actionLabel && notification.actionUrl
          ? `<a href="${BASE}${notification.actionUrl}" style="background:#ff6b35;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:16px">${notification.actionLabel}</a>`
          : ''}
      </div>`
    );
  }
  return id;
}

async function runAutomatedChecks() {
  const p = getPool();
  if (!p) return;

  try {
    const { getAllPortals, TIERS } = require('./tierService');
    const { getRules }             = require('../routes/settings');
    const tokenStore               = require('./tokenStore');
    const { sendTrialEnding, sendTrialExpired } = require('./emailService');

    const portals = await getAllPortals();

    for (const portal of portals) {
      const portalId = portal.portal_id;
      const tier     = portal.tier;
      const tierInfo = TIERS[tier] || TIERS.trial;

      if (!tierInfo.maxRules) continue; // Skip suspended/cancelled

      // Get installer email
      let installerEmail = null;
      try {
        const tokens = await tokenStore.get(portalId);
        installerEmail = tokens?.installerEmail || null;
      } catch (e) {}

      const rules    = await getRules(portalId);

      // Usage > 90%
      const usagePct = (rules.length / tierInfo.maxRules) * 100;
      if (usagePct >= 90 && usagePct < 100) {
        const recent = await p.query(
          `SELECT id FROM notifications WHERE portal_id = $1 AND type = 'warning'
           AND title LIKE '%90%' AND created_at > NOW() - INTERVAL '7 days'`,
          [portalId]
        );
        if (!recent.rows.length) {
          await createNotification(portalId, {
            type:        'warning',
            title:       "You've used 90% of your sync rules",
            message:     `You're using ${rules.length} of ${tierInfo.maxRules} sync rules. Upgrade to avoid hitting your limit.`,
            actionLabel: 'Upgrade Now',
            actionUrl:   `/account?portalId=${portalId}`
          });
        }
      }

      // Trial checks
      if (tier === 'trial') {
        const daysSince = (Date.now() - new Date(portal.trial_started_at).getTime()) / 86400000;
        const daysLeft  = Math.ceil(14 - daysSince);

        // Trial expiring — 7 days
        if (daysLeft === 7) {
          const recent = await p.query(
            `SELECT id FROM notifications WHERE portal_id = $1
             AND title LIKE '%7 day%' AND created_at > NOW() - INTERVAL '2 days'`,
            [portalId]
          );
          if (!recent.rows.length) {
            await createNotification(portalId, {
              type:        'warning',
              title:       'Your free trial expires in 7 days',
              message:     'Upgrade now to keep your sync rules active.',
              actionLabel: 'View Plans',
              actionUrl:   `/account?portalId=${portalId}`
            });
            if (installerEmail) await sendTrialEnding(installerEmail, portalId, 7);
          }
        }

        // Trial expiring — 3 days
        if (daysLeft <= 3 && daysLeft > 0) {
          const recent = await p.query(
            `SELECT id FROM notifications WHERE portal_id = $1
             AND title LIKE '%3 day%' AND created_at > NOW() - INTERVAL '2 days'`,
            [portalId]
          );
          if (!recent.rows.length) {
            await createNotification(portalId, {
              type:        'warning',
              title:       `Your free trial expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
              message:     'Upgrade now to keep your sync rules active after your trial ends.',
              actionLabel: 'View Plans',
              actionUrl:   `/account?portalId=${portalId}`
            });
            if (installerEmail) await sendTrialEnding(installerEmail, portalId, daysLeft);
          }
        }

        // Trial expired
        if (daysSince >= 14) {
          const recent = await p.query(
            `SELECT id FROM notifications WHERE portal_id = $1 AND type = 'error'
             AND title LIKE '%expired%' AND created_at > NOW() - INTERVAL '7 days'`,
            [portalId]
          );
          if (!recent.rows.length) {
            await createNotification(portalId, {
              type:        'error',
              title:       'Your free trial has expired',
              message:     'Your sync rules are now paused. Upgrade to reactivate PropBridge.',
              actionLabel: 'Upgrade Now',
              actionUrl:   `/account?portalId=${portalId}`
            });
            if (installerEmail) await sendTrialExpired(installerEmail, portalId);
          }
        }
      }
    }
    console.log('[Notifications] Automated checks complete');
  } catch (err) {
    console.error('[Notifications] Automated check error:', err.message);
  }
}

module.exports = {
  createNotification,
  getNotifications,
  markRead,
  markAllRead,
  notify,
  getAllNotifications,
  runAutomatedChecks
};
