// src/services/hubspotClient.js
const hubspot    = require('@hubspot/api-client');
const axios      = require('axios');
const tokenStore = require('./tokenStore');

function getBaseUrl() {
  return process.env.APP_BASE_URL || ('https://' + process.env.RAILWAY_PUBLIC_DOMAIN);
}

function getRedirectUri() {
  return `${getBaseUrl()}/oauth/callback`;
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

  return res.data;
}

async function getClient(portalId) {
  const tokens = await tokenStore.get(portalId);
  if (!tokens || !tokens.access_token) {
    throw new Error(`No tokens for portal ${portalId}`);
  }
  const client = new hubspot.Client({ accessToken: tokens.access_token });
  return client;
}

module.exports = {
  getAuthUrl,
  exchangeCode,
  refreshToken,
  getClient,
  SCOPES
};
