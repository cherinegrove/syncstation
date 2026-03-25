// src/services/emailRulesService.js
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    pool.query(`
      CREATE TABLE IF NOT EXISTS email_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        enabled BOOLEAN DEFAULT TRUE,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS email_log (
        id SERIAL PRIMARY KEY,
        portal_id TEXT,
        rule_id TEXT,
        to_email TEXT,
        subject TEXT,
        status TEXT DEFAULT 'sent',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `).then(() => {
      console.log('[EmailRules] Tables ready');
      seedDefaultRules();
    }).catch(err => console.error('[EmailRules] Table error:', err.message));
  }
  return pool;
}

const DEFAULT_RULES = [
  {
    id: 'trial_activated',
    name: 'Trial Activated',
    trigger_type: 'trial_activated',
    subject: '🎉 Welcome to PropBridge — your trial has started!',
    body: `Hi there,\n\nYour 14-day free trial is now active! You can start syncing property values between your HubSpot CRM objects right away.\n\nYou have access to:\n• Up to 10 sync rules\n• Up to 10 property mappings per rule\n• Real-time webhook sync\n\nTo get started, set up your first sync rule in the settings page.\n\nWelcome aboard!\nThe PropBridge Team`,
    enabled: true
  },
  {
    id: 'trial_ending_7',
    name: 'Trial Ending (7 Days)',
    trigger_type: 'trial_ending_7',
    subject: '⏰ Your PropBridge trial ends in 7 days',
    body: `Hi there,\n\nJust a heads up — your PropBridge free trial ends in 7 days.\n\nTo keep your sync rules running after the trial, please upgrade to a paid plan. Plans start at just $7/month.\n\nUpgrade now to avoid any interruption to your sync rules.\n\nThe PropBridge Team`,
    enabled: true
  },
  {
    id: 'trial_ending_3',
    name: 'Trial Ending (3 Days)',
    trigger_type: 'trial_ending_3',
    subject: '⏰ Your PropBridge trial ends in 3 days',
    body: `Hi there,\n\nYour PropBridge free trial ends in just 3 days.\n\nUpgrade now to keep your sync rules active — it only takes a minute.\n\nPlans start at $7/month with no setup fees.\n\nThe PropBridge Team`,
    enabled: true
  },
  {
    id: 'trial_expired',
    name: 'Trial Expired',
    trigger_type: 'trial_expired',
    subject: '⚠️ Your PropBridge trial has expired',
    body: `Hi there,\n\nYour PropBridge trial has ended and your sync rules have been paused.\n\nUpgrade now to reactivate your account and keep your data in sync. Your rules and settings are saved and will resume immediately after upgrading.\n\nThe PropBridge Team`,
    enabled: true
  },
  {
    id: 'plan_upgraded',
    name: 'Plan Upgraded',
    trigger_type: 'plan_upgraded',
    subject: '✅ Your PropBridge plan has been upgraded',
    body: `Hi there,\n\nYour PropBridge plan has been upgraded successfully. Your new limits are now active.\n\nThank you for your support!\nThe PropBridge Team`,
    enabled: true
  },
  {
    id: 'plan_changed',
    name: 'Plan Changed',
    trigger_type: 'plan_changed',
    subject: '📋 Your PropBridge plan has been updated',
    body: `Hi there,\n\nYour PropBridge plan has been updated. Your new limits are now active.\n\nThe PropBridge Team`,
    enabled: true
  },
  {
    id: 'usage_90',
    name: 'Usage at 90%',
    trigger_type: 'usage_90',
    subject: '⚠️ You\'ve used 90% of your PropBridge sync rules',
    body: `Hi there,\n\nYou're approaching your sync rule limit on PropBridge. You've used 90% of your available rules.\n\nUpgrade your plan to add more sync rules and avoid hitting your limit.\n\nThe PropBridge Team`,
    enabled: true
  }
];

async function seedDefaultRules() {
  const p = getPool();
  if (!p) return;
  try {
    for (const rule of DEFAULT_RULES) {
      await p.query(`
        INSERT INTO email_rules (id, name, trigger_type, subject, body, enabled)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO NOTHING
      `, [rule.id, rule.name, rule.trigger_type, rule.subject, rule.body, rule.enabled]);
    }
    console.log('[EmailRules] Default rules seeded');
  } catch (err) {
    console.error('[EmailRules] Seed error:', err.message);
  }
}

async function getAllRules() {
  const p = getPool();
  if (!p) return DEFAULT_RULES;
  try {
    const result = await p.query('SELECT * FROM email_rules ORDER BY id');
    return result.rows;
  } catch (err) {
    console.error('[EmailRules] Get error:', err.message);
    return DEFAULT_RULES;
  }
}

async function getRule(id) {
  const p = getPool();
  if (!p) return DEFAULT_RULES.find(r => r.id === id);
  try {
    const result = await p.query('SELECT * FROM email_rules WHERE id = $1', [id]);
    return result.rows[0] || null;
  } catch (err) {
    return null;
  }
}

async function updateRule(id, { subject, body, enabled, name }) {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(`
      UPDATE email_rules SET subject = $1, body = $2, enabled = $3, name = $4, updated_at = NOW()
      WHERE id = $5
    `, [subject, body, enabled, name, id]);
    console.log(`[EmailRules] Updated rule ${id}`);
  } catch (err) {
    console.error('[EmailRules] Update error:', err.message);
  }
}

async function logEmail(portalId, ruleId, toEmail, subject, status = 'sent') {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(
      'INSERT INTO email_log (portal_id, rule_id, to_email, subject, status) VALUES ($1, $2, $3, $4, $5)',
      [String(portalId || ''), ruleId || '', toEmail || '', subject || '', status]
    );
  } catch (err) {
    console.error('[EmailRules] Log error:', err.message);
  }
}

async function getEmailLog(limit = 100) {
  const p = getPool();
  if (!p) return [];
  try {
    const result = await p.query(
      'SELECT * FROM email_log ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  } catch (err) {
    return [];
  }
}

// Initialize
getPool();

module.exports = { getAllRules, getRule, updateRule, logEmail, getEmailLog, seedDefaultRules };
