// src/routes/webhooks.js
// Receives property change notifications from HubSpot and triggers syncs
const express       = require('express');
const router        = express.Router();
const crypto        = require('crypto');
const { getClient } = require('../services/hubspotClient');
const { sync }      = require('../services/syncService');
const { getRules }  = require('./settings');

// Verify HubSpot webhook signature
function verifySignature(req) {
  try {
    const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
    const signature    = req.headers['x-hubspot-signature-v3'] || req.headers['x-hubspot-signature'];
    if (!signature || !clientSecret) return true; // Skip in dev

    const body      = JSON.stringify(req.body);
    const timestamp = req.headers['x-hubspot-request-timestamp'];
    const method    = req.method.toUpperCase();
    const url       = `${process.env.APP_BASE_URL}/webhooks/receive`;

    const source   = `${method}${url}${body}${timestamp}`;
    const expected = crypto.createHmac('sha256', clientSecret).update(source).digest('base64');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return true; // Don't block on verification errors
  }
}

// POST /webhooks/receive
// HubSpot sends batches of property change events here
router.post('/receive', async (req, res) => {
  // Respond immediately so HubSpot doesn't retry
  res.status(200).send('ok');

  const events = Array.isArray(req.body) ? req.body : [req.body];
  console.log(`[Webhooks] Received ${events.length} event(s)`);

  // Group events by portal
  const byPortal = {};
  for (const event of events) {
    const portalId = String(event.portalId);
    if (!byPortal[portalId]) byPortal[portalId] = [];
    byPortal[portalId].push(event);
  }

  // Process each portal's events
  for (const [portalId, portalEvents] of Object.entries(byPortal)) {
    try {
      await processPortalEvents(portalId, portalEvents);
    } catch (err) {
      console.error(`[Webhooks] Error processing portal ${portalId}:`, err.message);
    }
  }
});

async function processPortalEvents(portalId, events) {
  const rules = await getRules(portalId);
  const activeRules = rules.filter(r => r.enabled);
  if (!activeRules.length) return;

  const client = await getClient(portalId);

  for (const event of events) {
    const { objectId, objectType: rawObjectType, propertyName, propertyValue } = event;

    // Normalize object type
    const objectType = normalizeObjectType(rawObjectType);

    console.log(`[Webhooks] ${objectType} ${objectId} - ${propertyName} changed to "${propertyValue}"`);

    // Find rules that match this event
    const matchingRules = activeRules.filter(rule => {
      const isSource = rule.sourceObject === objectType &&
        rule.mappings?.some(m => m.source === propertyName);
      const isTarget = rule.direction === 'two_way' &&
        rule.targetObject === objectType &&
        rule.mappings?.some(m => m.target === propertyName);
      return isSource || isTarget;
    });

    if (!matchingRules.length) continue;

    for (const rule of matchingRules) {
      try {
        // Determine if this record is source or target
        let sourceObjectType = rule.sourceObject;
        let sourceId         = objectId;
        let targetObjectType = rule.targetObject;

        // If the changed record is the target (bidirectional), flip it
        if (rule.direction === 'two_way' && rule.targetObject === objectType) {
          sourceObjectType = rule.targetObject;
          sourceId         = objectId;
          targetObjectType = rule.sourceObject;
        }

        const result = await sync(client, {
          sourceObjectType,
          sourceId:        String(sourceId),
          targetObjectType,
          direction:       rule.direction,
          mappings:        rule.mappings,
          skipIfHasValue:  rule.skipIfHasValue === 'true',
          associationRule: rule.assocRule || 'all',
          associationLabel: rule.assocLabel || ''
        });

        console.log(`[Webhooks] Rule "${rule.name}" synced ${result.updated} record(s) - status: ${result.status}`);
      } catch (err) {
        console.error(`[Webhooks] Rule "${rule.name}" failed:`, err.message);
      }
    }
  }
}

function normalizeObjectType(raw) {
  const map = {
    'contact':  'contacts',
    'company':  'companies',
    'deal':     'deals',
    'ticket':   'tickets',
    'lead':     'leads',
    'product':  'products',
    'contacts': 'contacts',
    'companies':'companies',
    'deals':    'deals',
    'tickets':  'tickets'
  };
  return map[raw?.toLowerCase()] || raw?.toLowerCase();
}

module.exports = router;
