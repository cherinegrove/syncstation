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

// Upsert a contact for a new SyncStation signup. Never throws — signup must
// succeed even if the CRM push fails; failures are logged for follow-up.
async function syncSignupToCrm({ email, fullName, signupDate }) {
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

// Update the status property on an existing contact (e.g. 'connected_portal',
// 'trial_expired', 'paid'). Fire-and-forget like syncSignupToCrm.
async function updateCrmStatus(email, status) {
  try {
    const client = await getClient(MARKETING_PORTAL_ID);
    await client.crm.contacts.basicApi.update(email, {
      properties: { syncstation_status: status }
    }, 'email');
    console.log(`[CRM Sync] ✅ Status '${status}' set for ${email}`);
    return { ok: true };
  } catch (err) {
    const detail = err.body?.message || err.message;
    console.error(`[CRM Sync] ❌ Failed status update for ${email}:`, detail);
    return { ok: false, error: detail };
  }
}

module.exports = { syncSignupToCrm, updateCrmStatus, MARKETING_PORTAL_ID };
