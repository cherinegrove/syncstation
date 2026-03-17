// src/services/hubspotClient.js
const hubspot    = require('@hubspot/api-client');
const axios      = require('axios');
const tokenStore = require('./tokenStore');

const CLIENT_ID  = process.env.HUBSPOT_CLIENT_ID;
const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET;
const BASE_URL   = process.env.APP_BASE_URL || ('https://' + process.env.RAILWAY_PUBLIC_DOMAIN);
const REDIRECT_URI = `${BASE_URL}/oauth/callback`;

const SCOPES = [
  'automation',
  'crm.objects.companies.read',
  'crm.objects.companies.write',
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.objects.custom.read',
  'crm.objects.custom.write',
  'crm.objects.deals.read',
  'crm.objects.deals.write',
  'crm.objects.leads.read',
  'crm.objects.leads.write',
  'crm.objects.products.read',
  'crm.objects.products.write',
  'crm.objects.projects.read',
  'crm.objects.projects.write',
  'tickets'
].join(' ');

function getAuthUrl() {
  const params = new URLSearchParams({
    client_id:    CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope:        SCOPES
  });
  console.log('[OAuth] REDIRECT_URI:', REDIRECT_URI);
  console.log('[OAuth] BASE_URL:', BASE_URL);
  return `https://app-eu1.hubspot.com/oauth/authorize?${params}`;
}

async function exchangeCode(code) {
  const { data } = await axios.post(
    'https://api.hubapi.com/oauth/v1/token',
    new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  REDIRECT_URI,
      code
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return data;
}

async function refreshToken(portalId) {
  const stored = await tokenStore.get(portalId);
  if (!stored) throw new Error(`No tokens found for portal ${portalId}`);

  const { data } = await axios.post(
    'https://api.hubapi.com/oauth/v1/token',
    new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
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
