// src/routes/webhooks.js
const express = require('express');
const router = express.Router();
const { getClient } = require('../services/hubspotClient');
const { sync } = require('../services/syncService');

// In-memory store to track our own writes (prevents bidirectional loops)
const recentWrites = new Map();

function markWrite(objectType, objectId, properties) {
  const key = `${objectType}:${objectId}`;
  recentWrites.set(key, {
    properties: Object.keys(properties),
    timestamp: Date.now()
  });
  
  // Clean up after 10 seconds
  setTimeout(() => recentWrites.delete(key), 10000);
}

function wasRecentlyWritten(objectType, objectId, propertyName) {
  const key = `${objectType}:${objectId}`;
  const write = recentWrites.get(key);
  
  if (!write) return false;
  if (Date.now() - write.timestamp > 10000) {
    recentWrites.delete(key);
    return false;
  }
  
  return write.properties.includes(propertyName);
}

// POST /webhooks/receive
router.post('/receive', async (req, res) => {
  try {
    const events = req.body || [];
    
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(200).json({ ok: true, message: 'No events' });
    }

    console.log(`[Webhooks] Received ${events.length} event(s)`);
    if (events.length > 0) {
      console.log(`[Webhooks] Sample event:`, JSON.stringify(events[0]));
    }

    // Process events asynchronously (don't block HubSpot's webhook)
    res.status(200).json({ ok: true });

    // Process each event
    for (const event of events) {
      try {
        await processWebhookEvent(event);
      } catch (err) {
        console.error(`[Webhooks] Error processing event ${event.eventId}:`, err.message);
      }
    }

  } catch (err) {
    console.error('[Webhooks] Webhook error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Helper to properly pluralize object types (handles irregular plurals)
function pluralize(objectType) {
  if (!objectType) return objectType;
  if (objectType.endsWith('s')) return objectType;
  
  // Handle irregular plurals
  const irregulars = {
    'company': 'companies'
  };
  
  return irregulars[objectType] || objectType + 's';
}

async function processWebhookEvent(event) {
  const {
    portalId,
    objectId,
    propertyName,
    propertyValue,
    subscriptionType
  } = event;

  if (!portalId || !objectId || !propertyName) {
    console.log('[Webhooks] Skipping event - missing required fields');
    return;
  }

  // Extract object type from subscription type (e.g., "contact.propertyChange" → "contacts")
  const objectType = subscriptionType?.split('.')[0];
  if (!objectType) {
    console.log('[Webhooks] Skipping event - could not determine object type');
    return;
  }

  // Pluralize object type for API consistency (handle irregular plurals)
  const pluralObjectType = pluralize(objectType);

  // Check if this was our own write (prevent loops)
  if (wasRecentlyWritten(pluralObjectType, String(objectId), propertyName)) {
    console.log(`[Webhooks] Skipping ${pluralObjectType} ${objectId} - ${propertyName} was recently written by us`);
    return;
  }

  console.log(`[Webhooks] ${pluralObjectType} ${objectId} - ${propertyName} changed to "${propertyValue}"`);

  // Get sync rules for this portal
  const { getRules } = require('./settings');
  const rules = await getRules(portalId);

  if (!rules || rules.length === 0) {
    console.log(`[Webhooks] No sync rules for portal ${portalId}`);
    return;
  }

  // Find rules that involve this object type and property
  const matchingRules = rules.filter(rule => {
    if (!rule.enabled) return false;
    
    // Check if this object/property is in the rule's mappings
    const isSource = rule.sourceObject === pluralObjectType && 
                     rule.mappings.some(m => m.source === propertyName);
    
    const isTarget = rule.direction === 'two_way' && 
                     rule.targetObject === pluralObjectType && 
                     rule.mappings.some(m => m.target === propertyName);
    
    return isSource || isTarget;
  });

  if (matchingRules.length === 0) {
    console.log(`[Webhooks] No matching rules for ${pluralObjectType}.${propertyName}`);
    return;
  }

  console.log(`[Webhooks] Found ${matchingRules.length} matching rule(s)`);

  // Get HubSpot client
  const client = await getClient(portalId);

  // Process each matching rule
  for (const rule of matchingRules) {
    try {
      // Determine sync direction based on which object changed
      let sourceObjectType, targetObjectType;
      
      if (rule.sourceObject === pluralObjectType) {
        // Normal direction: source changed
        sourceObjectType = rule.sourceObject;
        targetObjectType = rule.targetObject;
      } else {
        // Reverse direction: target changed (bidirectional only)
        sourceObjectType = rule.targetObject;
        targetObjectType = rule.sourceObject;
      }

      console.log(`[Sync] Starting: ${sourceObjectType} ${objectId} -> ${targetObjectType} (${rule.direction})`);

      const result = await sync(client, {
        portalId, // ADDED: Pass portalId for custom object token access
        sourceObjectType,
        sourceId: objectId,
        targetObjectType,
        direction: rule.direction,
        mappings: rule.mappings,
        skipIfHasValue: rule.skipIfHasValue === 'true',
        associationRule: rule.assocRule || 'all',
        associationLabel: rule.assocLabel || '',
        onWrite: markWrite,
        // BUG FIX: Pass original rule source/target so sync can reverse mappings
        ruleSourceObject: rule.sourceObject,
        ruleTargetObject: rule.targetObject
      });

      console.log(`[Webhooks] Rule "${rule.name}" synced ${result.updated} record(s) - status: ${result.status}`);

      if (result.errors && result.errors.length > 0) {
        console.error(`[Webhooks] Rule "${rule.name}" errors:`, result.errors);
      }

    } catch (err) {
      console.error(`[Webhooks] Rule "${rule.name}" failed:`, err.message);
    }
  }
}

module.exports = router;
