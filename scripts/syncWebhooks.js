// src/routes/webhooks.js
const express    = require('express');
const crypto     = require('crypto');
const { Pool }   = require('pg');
const { getClient } = require('../services/hubspotClient');
const { sync }      = require('../services/syncService');
const { getPortalTier, isObjectAllowed } = require('../services/tierService');

const router = express.Router();

// ─── DB Pool ──────────────────────────────────────────────────────────────────
let pool = null;
function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

// ─── Webhook Signature Verification ──────────────────────────────────────────
function verifyWebhookSignature(req) {
  const secret = process.env.HUBSPOT_CLIENT_SECRET;
  if (!secret) return true; // skip in dev

  const signature = req.headers['x-hubspot-signature-v3'] || req.headers['x-hubspot-signature'];
  if (!signature) return false;

  // v3 signature
  if (req.headers['x-hubspot-signature-v3']) {
    const timestamp  = req.headers['x-hubspot-request-timestamp'];
    const uri        = `${process.env.APP_BASE_URL || 'https://portal.syncstation.app'}/webhooks/receive`;
    const body       = JSON.stringify(req.body);
    const str        = `${req.method}${uri}${body}${timestamp}`;
    const hash       = crypto.createHmac('sha256', secret).update(str).digest('hex');
    return hash === signature;
  }

  // v1/v2 signature fallback
  const body = JSON.stringify(req.body);
  const hash = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return hash === signature;
}

// ─── Log webhook sync result ──────────────────────────────────────────────────
async function logWebhookSync(portalId, objectType, ruleName, status, errorMessage, recordsSynced, sourceRecordId, targetRecordId) {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(`
      INSERT INTO sync_logs
        (portal_id, sync_time, status, error_message, records_synced, object_type, rule_name, trigger_type, source_record_id, target_record_id)
      VALUES ($1, NOW(), $2, $3, $4, $5, $6, 'webhook', $7, $8)
    `, [
      String(portalId),
      status,
      errorMessage || null,
      recordsSynced || 0,
      objectType || 'unknown',
      ruleName || 'webhook',
      sourceRecordId ? String(sourceRecordId) : null,
      targetRecordId ? String(targetRecordId) : null
    ]);
  } catch (e) {
    console.error('[Webhooks] Log error:', e.message);
  }
}

// ─── Get sync rules for a portal (from DB) ───────────────────────────────────
async function getSyncRules(portalId) {
  const p = getPool();
  if (!p) return [];
  try {
    const result = await p.query('SELECT rules FROM sync_rules WHERE portal_id = $1', [String(portalId)]);
    if (!result.rows.length) return [];
    const rules = result.rows[0].rules || [];
    return rules.filter(r => r.enabled !== false);
  } catch (e) {
    console.error('[Webhooks] Error fetching rules:', e.message);
    return [];
  }
}

// ─── Build set of all mapped property names for a portal ─────────────────────
function getMappedFields(rules) {
  const fields = new Set();
  for (const rule of rules) {
    for (const mapping of (rule.mappings || [])) {
      if (mapping.source) fields.add(mapping.source.toLowerCase());
      if (mapping.target) fields.add(mapping.target.toLowerCase());
    }
  }
  return fields;
}

// ─── In-memory tier cache — avoids DB hit on every webhook for inactive portals
const tierCache = new Map(); // portalId -> { tier, cachedAt }
const TIER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getCachedTier(portalId) {
  const now = Date.now();
  const cached = tierCache.get(portalId);
  if (cached && (now - cached.cachedAt) < TIER_CACHE_TTL) {
    return cached.tier;
  }
  const tierInfo = await getPortalTier(portalId);
  tierCache.set(portalId, { tier: tierInfo.tier, cachedAt: now });
  return tierInfo.tier;
}

// ─── Main webhook receiver ────────────────────────────────────────────────────
router.post('/receive', async (req, res) => {
  // Acknowledge immediately — HubSpot retries on slow responses
  res.status(200).send('OK');

  const events = Array.isArray(req.body) ? req.body : [req.body];
  console.log(`[Webhooks] Received ${events.length} event(s)`);
  if (events.length > 0) {
    console.log('[Webhooks] Sample event:', JSON.stringify(events[0]));
  }

  // Group events by portal
  const byPortal = {};
  for (const event of events) {
    const pid = String(event.portalId);
    if (!byPortal[pid]) byPortal[pid] = [];
    byPortal[pid].push(event);
  }

  for (const [portalId, portalEvents] of Object.entries(byPortal)) {
    // Fast tier check with cache — skip inactive portals immediately
    try {
      const tier = await getCachedTier(portalId);
      if (tier === 'cancelled' || tier === 'suspended') {
        // Drop silently — no logging to avoid log spam
        continue;
      }
    } catch (e) {
      // If tier check fails, still process (fail open)
    }
    await processPortalEvents(portalId, portalEvents);
  }
});

async function processPortalEvents(portalId, events) {
  // Load rules and tier once per portal per batch
  let rules, tierInfo, client;
  try {
    rules    = await getSyncRules(portalId);
    tierInfo = await getPortalTier(portalId); // still needed for isObjectAllowed checks
    client   = await getClient(portalId);
  } catch (e) {
    console.error(`[Webhooks] Setup error for portal ${portalId}:`, e.message);
    return;
  }

  if (!rules.length) return;

  const mappedFields = getMappedFields(rules);
  const OUR_APP_ID   = String(process.env.HUBSPOT_APP_ID || '31781241');

  // HubSpot numeric objectTypeId → plural name (used in associationChange payloads)
  const HS_TYPE_ID_MAP = {
    '0-1':   'contacts',
    '0-2':   'companies',
    '0-3':   'deals',
    '0-5':   'tickets',
    '0-136': 'leads',
    '0-18':  'products',
  };

  for (const event of events) {
    const { subscriptionType, objectId, propertyName, propertyValue, changeSource, sourceId: eventSourceId } = event;

    if (!subscriptionType || !objectId) continue;

    // ── ASSOCIATION CHANGE HANDLER ──────────────────────────────────────────
    if (subscriptionType.endsWith('.associationChange')) {
      // Only process new associations, not removals
      if (event.changeType !== 'CREATED') continue;

      const rawType    = subscriptionType.split('.')[0];
      const objectType = rawType.endsWith('y')
        ? rawType.slice(0, -1) + 'ies'
        : rawType + 's';

      // Map the associated object's typeId to a name
      const toObjectType = HS_TYPE_ID_MAP[event.toObjectTypeId] || null;
      if (!toObjectType) {
        console.log(`[Webhooks] ⏭️  Unknown toObjectTypeId ${event.toObjectTypeId} in associationChange`);
        continue;
      }

      // Find rules with syncOnAssociation that match this object pair
      const assocRules = rules.filter(rule => {
        if (!rule.enabled || !rule.syncOnAssociation) return false;
        return (rule.sourceObject === objectType && rule.targetObject === toObjectType) ||
               (rule.direction === 'two_way' && rule.targetObject === objectType && rule.sourceObject === toObjectType);
      });

      if (!assocRules.length) continue;

      if (tierInfo.isExpired) {
        console.log(`[Webhooks] ⛔ Portal ${portalId} tier expired - skipping association sync`);
        continue;
      }

      console.log(`[Webhooks] 🔗 Association created: ${objectType} ${objectId} ↔ ${toObjectType} ${event.toObjectId}`);
      console.log(`[Webhooks] Found ${assocRules.length} rule(s) with syncOnAssociation for this pair`);

      for (const rule of assocRules) {
        // Determine source/target based on which object fired the event
        let sourceObjectType = rule.sourceObject;
        let sourceId         = objectId;

        if (rule.direction === 'two_way' && rule.targetObject === objectType) {
          sourceObjectType = rule.targetObject;
          sourceId         = objectId;
        }

        await processWebhookRule(client, portalId, rule, sourceObjectType, sourceId);
      }
      continue; // done with this event
    }

    // Parse objectType from subscriptionType (e.g. "company.propertyChange" → "companies")
    const rawType  = subscriptionType.split('.')[0]; // company, contact, deal, etc.
    const objectType = rawType.endsWith('y')
      ? rawType.slice(0, -1) + 'ies'   // company → companies
      : rawType + 's';                  // contact → contacts, deal → deals

    // ── LOOP PREVENTION (most important) ──────────────────────────────────────
    // If HubSpot tells us this change was made by our own integration, skip it.
    // This is more reliable than an in-memory cache and prevents cascade loops.
    if (changeSource === 'INTEGRATION' && String(eventSourceId) === OUR_APP_ID) {
      console.log(`[Webhooks] ⏭️  Skipping ${objectType} ${objectId} - ${propertyName} was written by our app`);
      continue;
    }

    // Also skip if this is a calculated/internal HubSpot change we don't care about
    if (changeSource === 'CALCULATED' || changeSource === 'PORTAL_USER_FORCE_SYNC') {
      if (!mappedFields.has(propertyName?.toLowerCase())) {
        console.log(`[Webhooks] ⏭️  Skipping ${objectType}.${propertyName} - not in any mapped fields`);
        continue;
      }
    }

    // Check if this property is in any mapped field
    if (propertyName && !mappedFields.has(propertyName.toLowerCase())) {
      console.log(`[Webhooks] ⏭️  Skipping ${objectType}.${propertyName} - not in any mapped fields`);
      continue;
    }

    // Find matching rules for this objectType + property
    const matchingRules = rules.filter(rule => {
      const srcMatch = rule.sourceObject === objectType &&
        (rule.mappings || []).some(m => m.source?.toLowerCase() === propertyName?.toLowerCase());
      const tgtMatch = rule.direction === 'two_way' && rule.targetObject === objectType &&
        (rule.mappings || []).some(m => m.target?.toLowerCase() === propertyName?.toLowerCase());
      return srcMatch || tgtMatch;
    });

    if (!matchingRules.length) {
      console.log(`[Webhooks] ⏭️  Skipping ${objectType}.${propertyName} - not in any mapped fields`);
      continue;
    }

    console.log(`[Webhooks] Found ${matchingRules.length} matching rule(s) for ${objectType}.${propertyName}`);
    console.log(`[Webhooks] ${objectType} ${objectId} - ${propertyName} changed to "${propertyValue}"`);

    // Tier check
    if (tierInfo.isExpired || !isObjectAllowed(objectType, tierInfo.tier)) {
      console.log(`[Webhooks] ⛔ Portal ${portalId} tier ${tierInfo.tier} - skipping ${objectType} sync`);
      await logWebhookSync(portalId, objectType, 'ALL_RULES', 'blocked',
        `Tier ${tierInfo.tier} - cannot sync`, 0, objectId, null);
      continue;
    }

    // Process each matching rule
    for (const rule of matchingRules) {
      await processWebhookRule(client, portalId, rule, objectType, objectId);
    }
  }
}

async function processWebhookRule(client, portalId, rule, objectType, sourceId) {
  let sourceObjectType = rule.sourceObject;
  let targetObjectType = rule.targetObject;

  // Handle two_way: if webhook fired on the target object, reverse the sync
  if (rule.direction === 'two_way' && rule.targetObject === objectType) {
    sourceObjectType = rule.targetObject;
    targetObjectType = rule.sourceObject;
  }

  try {
    const result = await sync(client, {
      portalId,
      sourceObjectType,
      sourceId,
      targetObjectType,
      direction:        rule.direction,
      mappings:         rule.mappings || [],
      skipIfHasValue:   rule.skipIfHasValue || false,
      associationRule:  rule.associationRule || 'all',
      associationLabel: rule.associationLabel || ''
    });

    const synced  = result.updated || 0;
    const errors  = result.errors  || [];
    const status  = errors.length > 0 && synced === 0 ? 'error' : 'success';

    console.log(`[Webhooks] Rule "${rule.name}" synced ${synced} record(s) - status: ${status}`);
    if (errors.length > 0) {
      console.error(`[Webhooks] Rule "${rule.name}" errors:`, errors);
    }

    // Log per target
    if (result.targets && result.targets.length > 0) {
      for (const target of result.targets) {
        const tStatus = target.status === 'updated' ? 'success'
                      : target.status === 'error'   ? 'error'
                      : 'blocked';
        const tErr    = target.status === 'error' ? (target.error || 'Unknown error') : null;
        await logWebhookSync(
          portalId, sourceObjectType, rule.name,
          tStatus, tErr,
          target.status === 'updated' ? 1 : 0,
          String(sourceId), String(target.id)
        );
      }
    } else {
      await logWebhookSync(portalId, sourceObjectType, rule.name, status, null, synced, String(sourceId), null);
    }

  } catch (err) {
    console.error(`[Webhooks] Rule "${rule.name}" error:`, err.message);
    await logWebhookSync(portalId, sourceObjectType, rule.name, 'error', err.message, 0, String(sourceId), null);
  }
}

module.exports = router;
