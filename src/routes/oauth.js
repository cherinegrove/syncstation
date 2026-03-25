// src/routes/oauth.js
const express      = require('express');
const router       = express.Router();
const { getAuthUrl, exchangeCode } = require('../services/hubspotClient');
const tokenStore   = require('../services/tokenStore');
const webhookManager = require('../services/webhookManager');
const { getRules } = require('./settings');
const { getPortalTier } = require('../services/tierService');
const { sendTrialActivated } = require('../services/emailService');
const { createNotification } = require('../services/notificationService');

// GET /oauth/install
router.get('/install', (req, res) => {
  const url = getAuthUrl();
  console.log('[OAuth] Redirecting to:', url);
  res.redirect(url);
});

// GET /oauth/callback
router.get('/callback', async (req, res) => {
  const { code, error, error_description } = req.query;

  if (error) {
    console.error('[OAuth] HubSpot error:', error, error_description);
    return res.status(400).send(`HubSpot error: ${error} - ${error_description}`);
  }

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  try {
    const tokens  = await exchangeCode(code);
    const portalId = tokens.hub_id;
    console.log('[OAuth] Token exchange successful for portal:', portalId);

    // Save tokens
    await tokenStore.set(portalId, { ...tokens, savedAt: Date.now() });
    console.log(`✅  Portal ${portalId} installed successfully`);

    // Get installer email from HubSpot
    let installerEmail = null;
    try {
      const axios  = require('axios');
      const meRes  = await axios.get('https://api-eu1.hubapi.com/oauth/v1/access-tokens/' + tokens.access_token);
      installerEmail = meRes.data?.user || null;
      console.log(`[OAuth] Installer email: ${installerEmail}`);

      // Save email with token
      const stored = await tokenStore.get(portalId);
      await tokenStore.set(portalId, { ...stored, installerEmail });
    } catch (emailErr) {
      console.error('[OAuth] Could not fetch installer email:', emailErr.message);
    }

    // Check if this is a new install (first time)
    const tierInfo = await getPortalTier(portalId);
    const isNewInstall = tierInfo.tier === 'trial';

    if (isNewInstall && installerEmail) {
      // Send welcome email
      await sendTrialActivated(installerEmail, portalId);

      // Send welcome in-app notification
      await createNotification(portalId, {
        type:        'success',
        title:       '🎉 Welcome to PropBridge!',
        message:     'Your 14-day free trial is now active. Set up your first sync rule to get started.',
        actionLabel: 'Set Up Sync Rules',
        actionUrl:   `/settings?portalId=${portalId}`
      });
    }

    // Auto-register webhooks
    try {
      const rules    = await getRules(portalId);
      const allRules = { [portalId]: rules };
      await webhookManager.syncSubscriptions(allRules);
      console.log(`[OAuth] Webhooks registered for portal ${portalId}`);
    } catch (webhookErr) {
      console.error('[OAuth] Webhook registration error:', webhookErr.message);
    }

    const BASE = process.env.APP_BASE_URL || ('https://' + process.env.RAILWAY_PUBLIC_DOMAIN);
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f0f11;color:#f0f0f4">
        <div style="max-width:480px;margin:0 auto">
          <div style="font-size:48px;margin-bottom:16px">🎉</div>
          <h2 style="font-size:24px;margin-bottom:8px">PropBridge Installed!</h2>
          <p style="color:#8888a0;margin-bottom:32px">Portal <strong style="color:#ff6b35">${portalId}</strong> is connected. Your 14-day free trial is active.</p>
          <a href="${BASE}/settings?portalId=${portalId}"
             style="background:#ff6b35;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
            ⚙ Open Sync Settings
          </a>
          <p style="margin-top:24px"><a href="https://app.hubspot.com" style="color:#8888a0;font-size:13px">Return to HubSpot →</a></p>
        </div>
      </body></html>
    `);
  } catch (err) {
    console.error('[OAuth] Token exchange failed:', err.message);
    res.status(500).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h2>❌ Installation Failed</h2>
        <p>${err.message}</p>
        <a href="/oauth/install">Try again</a>
      </body></html>
    `);
  }
});

module.exports = router;
