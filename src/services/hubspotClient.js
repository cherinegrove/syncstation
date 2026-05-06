// src/services/hubspotClient.js
const hubspot    = require('@hubspot/api-client');
const axios      = require('axios');
const tokenStore = require('./tokenStore');

function getBaseUrl() {
  return process.env.APP_BASE_URL || ('https://' + process.env.RAILWAY_PUBLIC_DOMAIN);
}

function getRedirectUri() {
  return `${getBaseUrl()}/api/oauth/callback`;
}

// ALL scopes matching HubSpot Developer Portal configuration
const SCOPES = [
  'automation',
  'crm.objects.appointments.read',
  'crm.objects.appointments.write',
  'crm.objects.carts.read',
  'crm.objects.carts.write',
  'crm.objects.commercepayments.read',
  'crm.objects.commercepayments.write',
  'crm.objects.companies.read',
  'crm.objects.companies.write',
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.objects.courses.read',
  'crm.objects.courses.write',
  'crm.objects.custom.read',
  'crm.objects.custom.write',
  'crm.objects.deals.read',
  'crm.objects.deals.write',
  'crm.objects.goals.read',
  'crm.objects.goals.write',
  'crm.objects.invoices.read',
  'crm.objects.invoices.write',
  'crm.objects.leads.read',
  'crm.objects.leads.write',
  'crm.objects.line_items.read',
  'crm.objects.line_items.write',
  'crm.objects.listings.read',
  'crm.objects.listings.write',
  'crm.objects.marketing_events.read',
  'crm.objects.marketing_events.write',
  'crm.objects.orders.read',
  'crm.objects.orders.write',
  'crm.objects.products.read',
  'crm.objects.products.write',
  'crm.objects.projects.read',
  'crm.objects.projects.write',
  'crm.objects.quotes.read',
  'crm.objects.quotes.write',
  'crm.objects.services.read',
  'crm.objects.services.write',
  'crm.objects.subscriptions.read',
  'crm.objects.subscriptions.write',
  'crm.pipelines.orders.read',
  'crm.pipelines.orders.write',
  'crm.schemas.appointments.read',
  'crm.schemas.appointments.write',
  'crm.schemas.carts.read',
  'crm.schemas.carts.write',
  'crm.schemas.commercepayments.read',
  'crm.schemas.commercepayments.write',
  'crm.schemas.companies.read',
  'crm.schemas.companies.write',
  'crm.schemas.contacts.read',
  'crm.schemas.contacts.write',
  'crm.schemas.courses.read',
  'crm.schemas.courses.write',
  'crm.schemas.custom.read',
  'crm.schemas.deals.read',
  'crm.schemas.deals.write',
  'crm.schemas.listings.read',
  'crm.schemas.listings.write',
  'crm.schemas.projects.read',
  'crm.schemas.projects.write',
  'crm.schemas.services.read',
  'crm.schemas.services.write',
  'oauth',
  'tickets'
].join(' ');

function getAuthUrl() {
  console.log('[OAuth] ===== REQUESTING SCOPES =====');
  console.log('[OAuth] Total scopes:', SCOPES.split(' ').length);
  console.log('[OAuth] Scopes include schemas.projects:', SCOPES.includes('crm.schemas.projects.read'));
  console.log('[OAuth] Scopes include schemas.custom:', SCOPES.includes('crm.schemas.custom.read'));
  console.log('[OAuth] Full scope string:', SCOPES);
  console.log('[OAuth] ================================');
  
  const clientId    = process.env.HUBSPOT_CLIENT_ID;
  const redirectUri = getRedirectUri();
  console.log('[OAuth] CLIENT_ID:', clientId);
  console.log('[OAuth] REDIRECT_URI:', redirectUri);
  console.log('[OAuth] BASE_URL:', getBaseUrl());
  const params = new URLSearchParams({
    client_id:    clientId,
    redirect_uri: redirectUri,
    scope:        SCOPES
  });
  return `https://app-eu1.hubspot.com/oauth/authorize?${params}`;
}

async function exchangeCode(code) {
  const clientId     = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  const redirectUri  = getRedirectUri();

  const params = new URLSearchParams({
    grant_type:   'authorization_code',
    client_id:     clientId,
    client_secret: clientSecret,
    redirect_uri:  redirectUri,
    code
  });

  const res = await axios.post('https://api.hubapi.com/oauth/v1/token', params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  // IMPROVED LOGGING: Show full response to debug scope issues
  console.log('[OAuth] Token received! Full response:', JSON.stringify(res.data, null, 2));
  console.log('[OAuth] Scopes granted:', res.data.scope);
  console.log('[OAuth] Token type:', res.data.token_type);
  console.log('[OAuth] Expires in:', res.data.expires_in, 'seconds');

  return res.data;
}

async function refreshToken(refreshTok) {
  const clientId     = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;

  const params = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     clientId,
    client_secret: clientSecret,
    refresh_token: refreshTok
  });

  const res = await axios.post('https://api.hubapi.com/oauth/v1/token', params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  console.log('[OAuth] Token refreshed! Expires in:', res.data.expires_in, 'seconds');
  
  return res.data;
}

// In-memory lock to prevent multiple simultaneous refresh attempts for the same portal
const refreshLocks = new Map();

async function getClient(portalId) {
  const tokens = await tokenStore.get(portalId);
  if (!tokens || !tokens.access_token) {
    throw new Error(`No tokens for portal ${portalId}`);
  }
  
  // Check if token is expired or about to expire (within 5 minutes)
  // HubSpot tokens typically expire in 30 minutes (1800 seconds)
  const expiresIn = tokens.expires_in || 1800; // Default to 30 minutes if not provided
  const expiresAt = tokens.savedAt + (expiresIn * 1000);
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;
  
  // If token is still valid and not expiring soon, return client immediately
  if (now < expiresAt - fiveMinutes) {
    const client = new hubspot.Client({ accessToken: tokens.access_token });
    return client;
  }
  
  // Token is expired or expiring soon - need to refresh
  console.log(`[OAuth] Token expired or expiring soon for portal ${portalId}, refreshing...`);
  
  // Check if a refresh is already in progress for this portal
  if (refreshLocks.has(portalId)) {
    console.log(`[OAuth] Refresh already in progress for portal ${portalId}, waiting...`);
    await refreshLocks.get(portalId);
    // After waiting, get the refreshed token from store
    const refreshedTokens = await tokenStore.get(portalId);
    if (refreshedTokens && refreshedTokens.access_token) {
      return new hubspot.Client({ accessToken: refreshedTokens.access_token });
    }
  }
  
  // Create a promise for this refresh operation
  const refreshPromise = (async () => {
    try {
      if (!tokens.refresh_token) {
        throw new Error(`No refresh token available for portal ${portalId}`);
      }
      
      const newTokens = await refreshToken(tokens.refresh_token);
      
      // Preserve the hub_id and installerEmail from the original tokens
      await tokenStore.set(portalId, { 
        ...newTokens, 
        savedAt: Date.now(),
        hub_id: tokens.hub_id || portalId,
        installerEmail: tokens.installerEmail
      });
      
      console.log(`[OAuth] ✅ Token refreshed successfully for portal ${portalId}`);
      
      return new hubspot.Client({ accessToken: newTokens.access_token });
      
    } catch (err) {
      console.error(`[OAuth] ❌ Token refresh failed for portal ${portalId}:`, err.message);
      
      // If refresh fails, the user will need to reinstall
      throw new Error(`Token refresh failed for portal ${portalId}. Please reinstall the app.`);
      
    } finally {
      // Remove the lock
      refreshLocks.delete(portalId);
    }
  })();
  
  // Store the promise so other concurrent requests can wait for it
  refreshLocks.set(portalId, refreshPromise);
  
  return refreshPromise;
}

// ─── Background token keepalive ──────────────────────────────────────────────
// Proactively refreshes all portal tokens every 20 minutes so they never
// expire between polling cycles or during rate-limit backoff waits.
async function keepAliveAllTokens() {
  try {
    const all = await tokenStore.getAll();
    for (const [portalId, tokens] of Object.entries(all)) {
      if (!tokens || !tokens.refresh_token) continue;
      const expiresIn = tokens.expires_in || 1800;
      const expiresAt = (tokens.savedAt || 0) + (expiresIn * 1000);
      const tenMinutes = 10 * 60 * 1000;
      if (Date.now() > expiresAt - tenMinutes) {
        try {
          await getClient(portalId); // triggers refresh internally
          console.log(`[OAuth] ♻️  Keepalive refreshed token for portal ${portalId}`);
        } catch (e) {
          console.error(`[OAuth] Keepalive failed for portal ${portalId}:`, e.message);
        }
      }
    }
  } catch (e) {
    console.error('[OAuth] Keepalive error:', e.message);
  }
}

// Run every 20 minutes
setInterval(keepAliveAllTokens, 20 * 60 * 1000);

module.exports = {
  getAuthUrl,
  exchangeCode,
  refreshToken,
  getClient,
  SCOPES
};
