// src/routes/action.js
const express       = require("express");
const router        = express.Router();
const verifyHubSpot = require("../middleware/verifyHubSpot");
const { getClient } = require("../services/hubspotClient");
const { sync }      = require("../services/syncService");
const axios         = require("axios");

// Cache properties for 10 minutes to avoid hammering HubSpot API
const propCache = {};
const CACHE_TTL = 10 * 60 * 1000;

async function getProperties(objectType, accessToken) {
  const cacheKey = objectType;
  const now = Date.now();
  if (propCache[cacheKey] && (now - propCache[cacheKey].ts) < CACHE_TTL) {
    return propCache[cacheKey].data;
  }
  try {
    const url = "https://api.hubapi.com/crm/v3/properties/" + objectType;
    const { data } = await axios.get(url, {
      headers: { Authorization: "Bearer " + accessToken }
    });
    const options = data.results
      .filter(p => !p.hidden)
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(p => ({ label: p.label + " (" + p.name + ")", value: p.name }));
    propCache[cacheKey] = { data: options, ts: now };
    return options;
  } catch (err) {
    console.error("[Fields] Failed to load properties for", objectType, err.message);
    return [{ label: "Could not load properties", value: "" }];
  }
}

// ── GET /action/fields ─────────────────────────────────────────
// HubSpot calls this to populate dynamic dropdowns.
// We use a shared app token stored from the most recent install.
router.get("/fields", async (req, res) => {
  const name = req.query.name || "";
  console.log("[Fields] Request for:", name);

  const OBJECT_OPTIONS = [
    { label: "Contacts",  value: "contacts"  },
    { label: "Companies", value: "companies" },
    { label: "Deals",     value: "deals"     },
    { label: "Tickets",   value: "tickets"   },
    { label: "Leads",     value: "leads"     },
    { label: "Projects",  value: "projects"  }
  ];

  if (name === "source_object_type" || name === "target_object_type") {
    return res.json({ options: OBJECT_OPTIONS });
  }

  // For property dropdowns, load from HubSpot using stored token
  if (name === "source_properties" || name === "target_properties") {
    const tokenStore = require("../services/tokenStore");
    const allTokens  = tokenStore.getAll ? tokenStore.getAll() : {};
    const portalIds  = Object.keys(allTokens);

    if (portalIds.length === 0) {
      return res.json({ options: [{ label: "App not installed — please install first", value: "" }] });
    }

    // Use the first installed portal's token
    const tokens = allTokens[portalIds[0]];
    // Default to contacts properties — HubSpot will pass context in future
    const objectType = name === "source_properties" ? "contacts" : "contacts";
    const options = await getProperties(objectType, tokens.access_token);
    return res.json({ options });
  }

  res.json({ options: [] });
});

// Also handle POST for backwards compatibility
router.post("/fields", (req, res) => {
  const name = req.body?.name || req.query?.name || "";
  const OBJECT_OPTIONS = [
    { label: "Contacts",  value: "contacts"  },
    { label: "Companies", value: "companies" },
    { label: "Deals",     value: "deals"     },
    { label: "Tickets",   value: "tickets"   },
    { label: "Leads",     value: "leads"     },
    { label: "Projects",  value: "projects"  }
  ];
  res.json({ options: OBJECT_OPTIONS });
});

// ── POST /action/execute ───────────────────────────────────────
// Shared log function for webhook-triggered syncs
async function logWebhookSync(portalId, objectType, ruleName, status, errorMessage, recordsSynced, sourceRecordId = null, targetRecordId = null) {
  const { Pool } = require('pg');
  if (!process.env.DATABASE_URL) return;
  const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await p.query(
      `INSERT INTO sync_logs (portal_id, sync_time, status, error_message, records_synced, object_type, rule_name, trigger_type, source_record_id, target_record_id)
       VALUES ($1, NOW(), $2, $3, $4, $5, $6, 'webhook', $7, $8)`,
      [String(portalId), status, errorMessage || null, recordsSynced || 0, objectType || 'unknown', ruleName || 'webhook', sourceRecordId ? String(sourceRecordId) : null, targetRecordId ? String(targetRecordId) : null]
    );
  } catch (e) {
    console.log('[Action] Log error:', e.message);
  } finally {
    await p.end().catch(() => {});
  }
}

router.post("/execute", verifyHubSpot, async (req, res) => {
  const { portalId, object, inputFields } = req.body;
  console.log("[Action] Execute for portal", portalId, "object:", object?.objectId);

  try {
    const client = await getClient(portalId);

    const sourceObjectType  = inputFields.source_object_type;
    const targetObjectType  = inputFields.target_object_type;
    const associationRule   = inputFields.association_rule  || "all";
    const associationLabel  = inputFields.association_label || "";
    const direction         = inputFields.sync_direction;
    const skipIfHasValue    = inputFields.skip_if_has_value === "true";
    const sourceId          = object.objectId;

    if (!sourceObjectType || !targetObjectType || !direction) {
      return res.status(400).json({
        outputFields: { sync_status: "error", sync_error: "Missing required fields" }
      });
    }

    // Build property mappings from the 10 pairs
    const mappings = [];
    for (let i = 1; i <= 10; i++) {
      const src = inputFields["src_prop_" + i];
      const tgt = inputFields["tgt_prop_" + i];
      if (src && tgt && src.trim() && tgt.trim()) {
        mappings.push({ source: src.trim(), target: tgt.trim() });
      }
    }

    if (mappings.length === 0) {
      return res.status(400).json({
        outputFields: { sync_status: "error", sync_error: "No property mappings configured" }
      });
    }

    const result = await sync(client, {
      sourceObjectType,
      sourceId,
      targetObjectType,
      direction,
      mappings,
      skipIfHasValue,
      associationRule,
      associationLabel
    });

    // Log per-target record with IDs
    if (result.targets && result.targets.length > 0) {
      for (const target of result.targets) {
        const tStatus = target.status === 'updated' ? 'success' : (target.status === 'error' ? 'error' : 'blocked');
        const tErr    = target.status === 'error' ? (target.error || 'Unknown error') : null;
        await logWebhookSync(portalId, sourceObjectType, `${sourceObjectType}->${targetObjectType}`, tStatus, tErr, target.status === 'updated' ? 1 : 0, object?.objectId, target.id);
      }
    } else {
      await logWebhookSync(portalId, sourceObjectType, `${sourceObjectType}->${targetObjectType}`, result.status === 'ok' ? 'success' : 'error', null, result.updated || 0, object?.objectId, null);
    }

    res.json({
      outputFields: {
        sync_status:     result.status,
        targets_updated: String(result.updated),
        sync_summary:    JSON.stringify(result.targets)
      }
    });
  } catch (err) {
    console.error("[Action] Error:", err.message);
    const pid = req.body?.portalId;
    if (pid) await logWebhookSync(pid, 'unknown', 'webhook', 'error', err.message, 0);
    res.status(500).json({
      outputFields: { sync_status: "error", sync_error: err.message }
    });
  }
});

module.exports = router;
