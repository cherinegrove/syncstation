// src/routes/account.js
const { requirePortalAccess } = require('../middleware/requirePortalAccess');
const express = require('express');
const router  = express.Router();
const path    = require('path');
const { getPortalTier, setPortalTier, TIERS } = require('../services/tierService');
const { createNotification } = require('../services/notificationService');
const { sendPlanChanged, sendAdminNotification } = require('../services/emailService');
const { getRules } = require('./settings');
const tokenStore = require('../services/tokenStore');
const { Pool } = require('pg');

let pool = null;
function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

async function getInstallerEmail(portalId) {
  try {
    const tokens = await tokenStore.get(portalId);
    return tokens?.installerEmail || null;
  } catch (err) {
    return null;
  }
}

// GET /account
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/account.html'));
});

// GET /account/tier
router.get('/tier', requirePortalAccess, async (req, res) => {
  const portalId = req.portalId;
  if (!portalId) return res.status(400).json({ error: 'Missing portalId' });

  const tierInfo = await getPortalTier(portalId);
  console.log('[Account] GET /tier for portal', portalId, '- returning:', tierInfo.tier);

  let trial_started_at = null;
  try {
    const p = getPool();
    if (p) {
      const result = await p.query(
        'SELECT trial_started_at FROM portal_tiers WHERE portal_id = $1',
        [String(portalId)]
      );
      trial_started_at = result.rows[0]?.trial_started_at || null;
    }
  } catch (err) {
    console.error('[Account] Get trial date error:', err.message);
  }

  const rules              = await getRules(portalId);
  const totalMappings      = rules.reduce((sum, r) => sum + (r.mappings?.length || 0), 0);
  const maxMappingsPerRule = rules.length ? Math.max(...rules.map(r => r.mappings?.length || 0)) : 0;

  // Prevent caching of tier information
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  
  res.json({
    ...tierInfo,
    trial_started_at,
    usage: { rules: rules.length, mappings: totalMappings, maxMappingsPerRule }
  });
});

// POST /account/change-tier — self-serve tier change
router.post('/change-tier', requirePortalAccess, async (req, res) => {
  const portalId = req.portalId;
  const { newTier } = req.body;

  if (!portalId || !newTier) return res.status(400).json({ error: 'Missing portalId or newTier' });
  if (!TIERS[newTier]) return res.status(400).json({ error: 'Invalid tier' });

  const currentTierInfo    = await getPortalTier(portalId);
  const newTierInfo        = TIERS[newTier];
  const rules              = await getRules(portalId);
  const maxMappingsPerRule = rules.length ? Math.max(...rules.map(r => r.mappings?.length || 0)) : 0;

  // Check if downgrade is allowed
  if (newTierInfo.maxRules < rules.length) {
    return res.status(400).json({
      ok: false,
      blocked: true,
      reason: `You currently have ${rules.length} sync rules but the ${newTierInfo.name} plan only allows ${newTierInfo.maxRules}. Please delete ${rules.length - newTierInfo.maxRules} rule(s) before downgrading.`
    });
  }

  if (newTierInfo.maxMappings < maxMappingsPerRule) {
    return res.status(400).json({
      ok: false,
      blocked: true,
      reason: `One of your rules has ${maxMappingsPerRule} property mappings but the ${newTierInfo.name} plan only allows ${newTierInfo.maxMappings} per rule. Please reduce your mappings before downgrading.`
    });
  }

  // Change the tier
  const fromTier = currentTierInfo.tier;
  await setPortalTier(portalId, newTier);
  console.log(`[Account] Portal ${portalId} changed tier from ${fromTier} to ${newTier}`);

  // Send in-app notification
  const isUpgrade = newTierInfo.price > (TIERS[fromTier]?.price || 0);
  await createNotification(portalId, {
    type:    'success',
    title:   `Plan ${isUpgrade ? 'upgraded' : 'changed'} to ${newTierInfo.name}`,
    message: `Your account is now on the ${newTierInfo.name} plan. You have ${newTierInfo.maxRules} sync rules and ${newTierInfo.maxMappings} mappings per rule.`
  });

  // Send email confirmation
  const email = await getInstallerEmail(portalId);
  if (email) {
    await sendPlanChanged(email, portalId, fromTier, newTier, newTierInfo);
  }

  // Notify admin
  await sendAdminNotification(
    `Portal ${portalId} changed plan`,
    `Portal ${portalId} changed from ${fromTier} to ${newTier}. Installer email: ${email || 'unknown'}.`
  );

  res.json({ ok: true, tier: newTier, tierInfo: newTierInfo });
});

// ── CONTACT SUPPORT ──────────────────────────────────────────────────────────
router.post('/contact', async (req, res) => {
  const { name, email, message, portalId } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email and message are required' });
  }

  try {
    const { sendEmail } = require('../services/emailService');

    const supportEmail = process.env.ADMIN_EMAIL || 'support@syncstation.app';

    await sendEmail(
      supportEmail,
      `[SyncStation Support] New message from ${name}`,
      `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#FF6B35">New Support Request</h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;color:#888;width:120px">From</td><td style="padding:8px 0;font-weight:500">${name}</td></tr>
            <tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0"><a href="mailto:${email}">${email}</a></td></tr>
            <tr><td style="padding:8px 0;color:#888">Portal ID</td><td style="padding:8px 0;font-family:monospace">${portalId || 'N/A'}</td></tr>
          </table>
          <h3 style="margin-top:24px;margin-bottom:8px">Message</h3>
          <div style="background:#f5f5f5;padding:16px;border-radius:8px;white-space:pre-wrap">${message}</div>
          <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
          <p style="color:#888;font-size:12px">Reply directly to this email to respond to ${name}.</p>
        </div>
      `
    );

    // Also send confirmation to the user
    await sendEmail(
      email,
      'We received your message — SyncStation Support',
      `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#FF6B35">Thanks for reaching out, ${name}!</h2>
          <p>We've received your message and will get back to you within 24 hours.</p>
          <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;white-space:pre-wrap"><strong>Your message:</strong><br><br>${message}</div>
          <p style="color:#888;font-size:13px">— The SyncStation Team</p>
        </div>
      `
    );

    console.log(`[Account] Contact form submitted by ${email} (portal: ${portalId})`);
    res.json({ success: true });

  } catch (err) {
    console.error('[Account] Contact form error:', err.message);
    res.status(500).json({ error: 'Failed to send message. Please email support@syncstation.app directly.' });
  }
});

module.exports = router;
