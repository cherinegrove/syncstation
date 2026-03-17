// src/routes/oauth.js
const express      = require('express');
const router       = express.Router();
const { getAuthUrl, exchangeCode } = require('../services/hubspotClient');
const tokenStore   = require('../services/tokenStore');
const webhookManager = require('../services/webhookManager');
const { getRules } = require('./settings');

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
    console.error('[OAuth] Missing code. Query:', req.query);
    return res.status(400).send('Missing authorization code');
  }

  console.log('[OAuth] Received code, exchanging for tokens...');

  try {
    const tokens = await exchangeCode(code);
    console.log('[OAuth] Token exchange successful for portal:', tokens.hub_id);
    await tokenStore.set(tokens.hub_id, tokens);
    console.log(`✅  Portal ${tokens.hub_id} installed successfully`);

    // Auto-register webhooks after install
    try {
      const rules = await getRules(tokens.hub_id);
      const allRules = { [tokens.hub_id]: rules };
      await webhookManager.syncSubscriptions(allRules);
      console.log(`[OAuth] Webhooks registered for portal ${tokens.hub_id}`);
    } catch (webhookErr) {
      console.error('[OAuth] Webhook registration error:', webhookErr.message);
    }

    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h2>✅ PropBridge Installed!</h2>
        <p>Portal <strong>${tokens.hub_id}</strong> is connected.</p>
        <p><a href="${process.env.APP_BASE_URL || ('https://' + process.env.RAILWAY_PUBLIC_DOMAIN)}/settings?portalId=${tokens.hub_id}" 
              style="background:#ff6b35;color:white;padding:12px 24px;border-radius:8px;text-decoration:none">
           ⚙ Open Sync Management
        </a></p>
        <p style="margin-top:20px"><a href="https://app.hubspot.com">Return to HubSpot →</a></p>
      </body></html>
    `);
  } catch (err) {
    console.error('[OAuth] Token exchange failed:', err.message);
    console.error('[OAuth] Full error:', err.response?.data || err.stack);
    res.status(500).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h2>❌ Installation Failed</h2>
        <p>Error: ${err.message}</p>
        <p>${JSON.stringify(err.response?.data || '')}</p>
        <a href="/oauth/install">Try again</a>
      </body></html>
    `);
  }
});

module.exports = router;
