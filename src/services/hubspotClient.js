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
  'crm.schemas.contacts.read',
  'crm.schemas.custom.read',
  'oauth',
  'tickets'
].join(' ');

function getAuthUrl() {
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
  console.log('[OAuth] Exchanging code, client_id:', clientId);
  try {
    const { data } = await axios.post(
      'https://api-eu1.hubapi.com/oauth/v1/token',
      new URLSearchParams({
        grant_type:    'authorization_code',
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        code
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return data;
  } catch (err) {
    console.error('[OAuth] Exchange error:', JSON.stringify(err.response?.data));
    throw err;
  }
}

async function refreshToken(portalId) {
  const stored = await tokenStore.get(portalId);
  if (!stored) throw new Error(`No tokens found for portal ${portalId}`);

  const { data } = await axios.post(
    'https://api-eu1.hubapi.com/oauth/v1/token',
    new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     process.env.HUBSPOT_CLIENT_ID,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET,
      refresh_token: stored.refresh_token
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const updated = { ...stored, ...data, savedAt: Date.now() };
  await tokenStore.set(portalId, updated);
  return updated;
}

async function getClient(portalId) {
  let tokens = await tokenStore.get(portalId);
  if (!tokens) throw new Error(`Portal ${portalId} not installed`);

  const expiresAt = tokens.savedAt + (tokens.expires_in - 300) * 1000;
  if (Date.now() > expiresAt) {
    tokens = await refreshToken(portalId);
  }

  return new hubspot.Client({ accessToken: tokens.access_token });
}

module.exports = { getAuthUrl, exchangeCode, getClient };
