// src/services/crmSync.js
// Pushes SyncStation signups into our own HubSpot CRM so we can track,
// nurture, and market to users. Reuses the OAuth tokens SyncStation already
// holds for our portal (we're a customer of our own app) — no extra credentials.
const { getClient } = require('./hubspotClient');

// Our marketing CRM portal (cybersolve.net)
const MARKETING_PORTAL_ID = process.env.MARKETING_PORTAL_ID || '24888076';

function splitName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  return { firstname: parts[0] || '', lastname: parts.slice(1).join(' ') };
}

// Internal test accounts never belong in the marketing CRM
function isInternalTestEmail(email) {
  return !email || email.includes('+ssdemo');
}

// Upsert a contact for a new SyncStation signup. Never throws — signup must
// succeed even if the CRM push fails; failures are logged for follow-up.
async function syncSignupToCrm({ email, fullName, signupDate }) {
  if (isInternalTestEmail(email)) return { ok: true, skipped: true };
  try {
    const client = await getClient(MARKETING_PORTAL_ID);
    const { firstname, lastname } = splitName(fullName);

    const properties = {
      email,
      firstname,
      lastname,
      lifecyclestage: 'lead',
      // Date-type property: HubSpot accepts YYYY-MM-DD
      syncstation_signup_date: (signupDate ? new Date(signupDate) : new Date()).toISOString().slice(0, 10),
      syncstation_status: 'registered'
    };

    try {
      const created = await client.crm.contacts.basicApi.create({ properties });
      console.log(`[CRM Sync] ✅ Created HubSpot contact ${created.id} for ${email}`);
      return { ok: true, id: created.id, action: 'created' };
    } catch (err) {
      // 409 = contact already exists — update it by email instead
      if (err.code === 409 || err.body?.category === 'CONFLICT') {
        const updated = await client.crm.contacts.basicApi.update(email, { properties }, 'email');
        console.log(`[CRM Sync] ✅ Updated existing HubSpot contact for ${email}`);
        return { ok: true, id: updated.id, action: 'updated' };
      }
      throw err;
    }
  } catch (err) {
    const detail = err.body?.message || err.message;
    console.error(`[CRM Sync] ❌ Failed to sync ${email} to HubSpot:`, detail);
    return { ok: false, error: detail };
  }
}

// Update properties on an existing contact by email; creates the contact if
// it doesn't exist yet. Never throws — failures are logged for follow-up.
async function updateCrmContact(email, properties) {
  if (isInternalTestEmail(email)) return { ok: true, skipped: true };
  try {
    const client = await getClient(MARKETING_PORTAL_ID);
    try {
      await client.crm.contacts.basicApi.update(email, { properties }, 'email');
    } catch (err) {
      if (err.code === 404) {
        await client.crm.contacts.basicApi.create({ properties: { email, ...properties } });
      } else {
        throw err;
      }
    }
    console.log(`[CRM Sync] ✅ Updated ${email}:`, Object.keys(properties).join(', '));
    return { ok: true };
  } catch (err) {
    const detail = err.body?.message || err.message;
    console.error(`[CRM Sync] ❌ Failed contact update for ${email}:`, detail);
    return { ok: false, error: detail };
  }
}

// Status-only convenience (e.g. 'trial_expired', 'customer')
async function updateCrmStatus(email, status) {
  return updateCrmContact(email, { syncstation_status: status });
}

// Called when a user connects their HubSpot portal via OAuth — records which
// portal they linked so marketing can see who's activated and from where.
async function updateCrmOnPortalConnect(email, portalId, hubDomain) {
  return updateCrmContact(email, {
    syncstation_status: 'connected_portal',
    syncstation_portal_id: String(portalId),
    syncstation_hub_domain: hubDomain || ''
  });
}

module.exports = { syncSignupToCrm, updateCrmContact, updateCrmStatus, updateCrmOnPortalConnect, MARKETING_PORTAL_ID };
