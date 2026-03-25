// src/routes/account.js
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
router.get('/tier', async (req, res) => {
  const { portalId } = req.query;
  if (!portalId) return res.status(400).json({ error: 'Missing portalId' });

  const tierInfo = await getPortalTier(portalId);

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

  res.json({
    ...tierInfo,
    trial_started_at,
    usage: { rules: rules.length, mappings: totalMappings, maxMappingsPerRule }
  });
});

// POST /account/change-tier — self-serve tier change
router.post('/change-tier', async (req, res) => {
  const { portalId, newTier } = req.body;

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

module.exports = router;
