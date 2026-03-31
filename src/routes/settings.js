// src/routes/settings.js
const express       = require('express');
const router        = express.Router();
const path          = require('path');
const { getClient } = require('../services/hubspotClient');
const { Pool }      = require('pg');
const { validateMapping, getCompatibleTypes } = require('../utils/fieldTypeCompatibility');

let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    pool.query(`
      CREATE TABLE IF NOT EXISTS sync_rules (
        portal_id TEXT PRIMARY KEY,
        rules JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `).catch(err => console.error('[DB] sync_rules table error:', err.message));
  }
  return pool;
}

const memRulesStore = {};

async function getRules(portalId) {
  const p = getPool();
  if (p) {
    try {
      const result = await p.query('SELECT rules FROM sync_rules WHERE portal_id = $1', [String(portalId)]);
      return result.rows[0]?.rules || [];
    } catch (err) {
      console.error('[DB] Get rules error:', err.message);
    }
  }
  return memRulesStore[portalId] || [];
}

async function saveRules(portalId, rules) {
  const p = getPool();
  if (p) {
    try {
      await p.query(`
        INSERT INTO sync_rules (portal_id, rules, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (portal_id) DO UPDATE SET rules = $2, updated_at = NOW()
      `, [String(portalId), JSON.stringify(rules)]);
      return;
    } catch (err) {
      console.error('[DB] Save rules error:', err.message);
    }
  }
  memRulesStore[portalId] = rules;
}

// All known object types to test
const OBJECTS_TO_TEST = [
  { name: 'contacts',        label: 'Contacts' },
  { name: 'companies',       label: 'Companies' },
  { name: 'deals',           label: 'Deals' },
  { name: 'tickets',         label: 'Tickets' },
  { name: 'leads',           label: 'Leads' },
  { name: 'products',        label: 'Products' },
  { name: 'line_items',      label: 'Line Items' },
  { name: 'quotes',          label: 'Quotes' },
  { name: 'invoices',        label: 'Invoices' },
  { name: 'orders',          label: 'Orders' },
  { name: 'carts',           label: 'Carts' },
  { name: 'appointments',    label: 'Appointments' },
  { name: 'courses',         label: 'Courses' },
  { name: 'listings',        label: 'Listings' },
  { name: 'services',        label: 'Services' },
  { name: 'goals',           label: 'Goals' },
  { name: 'tasks',           label: 'Tasks' },
  { name: 'calls',           label: 'Calls' },
  { name: 'emails',          label: 'Emails' },
  { name: 'meetings',        label: 'Meetings' },
  { name: 'notes',           label: 'Notes' },
  { name: 'communications',  label: 'Communications' },
  { name: 'postal_mail',     label: 'Postal Mail' },
  { name: 'subscriptions',   label: 'Subscriptions' },
  { name: 'payments',        label: 'Payments' },
  { name: 'discounts',       label: 'Discounts' },
  { name: 'marketing_events', label: 'Marketing Events' }
];

// Cache available objects per portal (5 min TTL)
const objectsCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

// GET /settings
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/settings.html'));
});

// GET /settings/rules
router.get('/rules', async (req, res) => {
  const { portalId } = req.query;
  if (!portalId) return res.status(400).json({ error: 'Missing portalId' });
  const rules = await getRules(portalId);
  res.json({ rules });
});

// POST /settings/rules - WITH FIELD TYPE VALIDATION
router.post('/rules', async (req, res) => {
  const { portalId, rules } = req.body;
  if (!portalId) return res.status(400).json({ error: 'Missing portalId' });
  
  // Validate each rule's mappings for field type compatibility
  try {
    const client = await getClient(portalId);
    const validationErrors = [];
    const validationWarnings = [];
    
    for (const rule of rules || []) {
      if (!rule.mappings || rule.mappings.length === 0) continue;
      
      // Fetch properties for source and target objects
      let sourceProperties = [];
      let targetProperties = [];
      
      try {
        const sourceRes = await client.crm.properties.coreApi.getAll(rule.sourceObject);
        sourceProperties = sourceRes.results || [];
      } catch (err) {
        console.log(`[Validation] Could not fetch ${rule.sourceObject} properties:`, err.message);
      }
      
      try {
        const targetRes = await client.crm.properties.coreApi.getAll(rule.targetObject);
        targetProperties = targetRes.results || [];
      } catch (err) {
        console.log(`[Validation] Could not fetch ${rule.targetObject} properties:`, err.message);
      }
      
      // Validate each mapping in the rule
      for (const mapping of rule.mappings) {
        const sourceProp = sourceProperties.find(p => p.name === mapping.source);
        const targetProp = targetProperties.find(p => p.name === mapping.target);
        
        if (!sourceProp || !targetProp) {
          validationErrors.push({
            rule: rule.name,
            mapping: `${mapping.source} → ${mapping.target}`,
            error: 'Property not found'
          });
          continue;
        }
        
        // Validate field type compatibility
        const validation = validateMapping(
          {
            name: sourceProp.name,
            label: sourceProp.label,
            type: sourceProp.type,
            options: sourceProp.options || []
          },
          {
            name: targetProp.name,
            label: targetProp.label,
            type: targetProp.type,
            options: targetProp.options || []
          }
        );
        
        if (!validation.valid) {
          validationErrors.push({
            rule: rule.name,
            mapping: `${sourceProp.label} → ${targetProp.label}`,
            error: validation.error || 'Incompatible field types'
          });
        }
        
        if (validation.warning) {
          validationWarnings.push({
            rule: rule.name,
            mapping: `${sourceProp.label} → ${targetProp.label}`,
            warning: validation.warning
          });
        }
      }
    }
    
    // If there are validation errors, reject the save
    if (validationErrors.length > 0) {
      console.log(`[Settings] Validation failed for portal ${portalId}:`, validationErrors);
      return res.status(400).json({
        error: 'Field type validation failed',
        validationErrors,
        validationWarnings
      });
    }
    
    // If only warnings (no errors), save but return warnings
    if (validationWarnings.length > 0) {
      console.log(`[Settings] Validation warnings for portal ${portalId}:`, validationWarnings);
    }
    
    await saveRules(portalId, rules || []);
    console.log(`[Settings] Saved ${rules?.length || 0} rules for portal ${portalId}`);
    res.json({ 
      ok: true,
      validationWarnings: validationWarnings.length > 0 ? validationWarnings : undefined
    });
    
  } catch (err) {
    console.error('[Settings] Error saving rules:', err.message);
    // Fall back to saving without validation if validation fails
    await saveRules(portalId, rules || []);
    res.json({ 
      ok: true,
      warning: 'Rules saved but validation could not be performed'
    });
  }
});

// GET /settings/objects — test each object type and return only accessible ones
router.get('/objects', async (req, res) => {
  const { portalId, refresh } = req.query;
  if (!portalId) return res.status(400).json({ error: 'Missing portalId' });

  // Check cache first
  const cacheKey   = `objects-${portalId}`;
  const cached     = objectsCache.get(cacheKey);
  if (cached && !refresh && Date.now() - cached.ts < CACHE_TTL_MS) {
    console.log(`[Settings] Returning cached objects for portal ${portalId}`);
    return res.json({ objects: cached.objects, source: 'cache' });
  }

  try {
    const axios      = require('axios');
    const tokenStore = require('../services/tokenStore');
    const tokens     = await tokenStore.get(portalId);

    if (!tokens?.access_token) {
      return res.json({ objects: OBJECTS_TO_TEST.slice(0, 5), source: 'fallback' });
    }

    const accessToken = tokens.access_token;

    // Test each object type in parallel by trying to fetch 1 property
    const testObject = async (obj) => {
      try {
        const res = await axios.get(
          `https://api-eu1.hubapi.com/crm/v3/properties/${obj.name}?limit=1`,
          {
            headers:        { Authorization: `Bearer ${accessToken}` },
            timeout:        5000,
            validateStatus: (s) => s < 500 // Don't throw on 4xx
          }
        );
        if (res.status === 200) {
          return { ...obj, accessible: true };
        }
        console.log(`[Settings] ${obj.name} not accessible (${res.status})`);
        return null;
      } catch (err) {
        console.log(`[Settings] ${obj.name} test failed:`, err.message);
        return null;
      }
    };

    // Test all objects in parallel with concurrency limit
    const BATCH_SIZE = 5;
    const accessible = [];

    for (let i = 0; i < OBJECTS_TO_TEST.length; i += BATCH_SIZE) {
      const batch   = OBJECTS_TO_TEST.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(testObject));
      accessible.push(...results.filter(Boolean));
    }

    // Also fetch custom objects
    try {
      const schemasRes = await axios.get(
        'https://api-eu1.hubapi.com/crm/v3/schemas',
        { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 5000 }
      );
      const knownNames    = new Set(OBJECTS_TO_TEST.map(o => o.name));
      const customObjects = (schemasRes.data?.results || [])
        .filter(s => !knownNames.has(s.name))
        .map(s => ({
          name:   s.objectTypeId || s.name,
          label:  s.labels?.singular || s.name,
          custom: true
        }));
      accessible.push(...customObjects);
    } catch (err) {
      console.log('[Settings] Could not fetch custom object schemas:', err.message);
    }

    console.log(`[Settings] Portal ${portalId} has access to ${accessible.length} object types`);

    // Cache result
    objectsCache.set(cacheKey, { objects: accessible, ts: Date.now() });

    res.json({ objects: accessible, source: 'dynamic' });

  } catch (err) {
    console.error('[Settings] Objects error:', err.message);
    res.json({ objects: OBJECTS_TO_TEST.slice(0, 5), source: 'fallback' });
  }
});

// GET /settings/properties/:objectType - NOW WITH FULL TYPE INFO
router.get('/properties/:objectType', async (req, res) => {
  const { objectType } = req.params;
  const { portalId }   = req.query;

  if (!portalId) return res.status(400).json({ error: 'Missing portalId', properties: [] });

  try {
    const client = await getClient(portalId);

    let properties = [];

    try {
      const response = await client.crm.properties.coreApi.getAll(objectType);
      properties = (response.results || [])
        .filter(p => !p.hidden && !p.calculated)
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(p => ({
          name: p.name,
          label: p.label,
          type: p.type,              // string, number, enumeration, bool, date, datetime
          fieldType: p.fieldType,    // text, textarea, select, number, date, etc.
          options: p.options || []   // For dropdowns/enumerations
        }));
    } catch (crmErr) {
      // Fallback to axios for non-standard objects
      const axios      = require('axios');
      const tokenStore = require('../services/tokenStore');
      const tokens     = await tokenStore.get(portalId);

      if (tokens?.access_token) {
        const propsRes = await axios.get(
          `https://api-eu1.hubapi.com/crm/v3/properties/${objectType}`,
          { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        );
        properties = (propsRes.data?.results || [])
          .filter(p => !p.hidden && !p.calculated)
          .sort((a, b) => a.label.localeCompare(b.label))
          .map(p => ({
            name: p.name,
            label: p.label,
            type: p.type,
            fieldType: p.fieldType,
            options: p.options || []
          }));
      }
    }

    res.json({ properties });

  } catch (err) {
    console.error('[Settings] Properties error for', objectType, ':', err.message);
    if (err.message.includes('not installed') || err.message.includes('token')) {
      return res.status(401).json({
        error: 'App not connected. Please reinstall.',
        reinstallUrl: `${process.env.APP_BASE_URL}/oauth/install`,
        properties: []
      });
    }
    res.status(500).json({ error: err.message, properties: [] });
  }
});

// NEW ENDPOINT: Validate a single mapping
router.post('/validate-mapping', async (req, res) => {
  const { portalId, sourceObject, targetObject, sourceProperty, targetProperty } = req.body;
  
  if (!portalId || !sourceObject || !targetObject || !sourceProperty || !targetProperty) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  try {
    const client = await getClient(portalId);
    
    // Fetch source and target properties
    const sourceRes = await client.crm.properties.coreApi.getAll(sourceObject);
    const targetRes = await client.crm.properties.coreApi.getAll(targetObject);
    
    const sourceProp = (sourceRes.results || []).find(p => p.name === sourceProperty);
    const targetProp = (targetRes.results || []).find(p => p.name === targetProperty);
    
    if (!sourceProp || !targetProp) {
      return res.json({ 
        valid: false, 
        error: 'Property not found' 
      });
    }
    
    // Validate the mapping
    const validation = validateMapping(
      {
        name: sourceProp.name,
        label: sourceProp.label,
        type: sourceProp.type,
        options: sourceProp.options || []
      },
      {
        name: targetProp.name,
        label: targetProp.label,
        type: targetProp.type,
        options: targetProp.options || []
      }
    );
    
    res.json(validation);
    
  } catch (err) {
    console.error('[Validation] Error:', err.message);
    res.status(500).json({ 
      valid: false, 
      error: 'Validation failed: ' + err.message 
    });
  }
});

// GET /settings/sync-webhooks
router.get('/sync-webhooks', async (req, res) => {
  try {
    const webhookManager = require('../services/webhookManager');
    const tokenStore     = require('../services/tokenStore');
    const allTokens      = await tokenStore.getAll();
    const allRules       = {};
    for (const pid of Object.keys(allTokens)) {
      allRules[pid] = await getRules(pid);
    }
    await webhookManager.syncSubscriptions(allRules);
    res.json({ ok: true, portals: Object.keys(allTokens), message: 'Webhook subscriptions synced!' });
  } catch (err) {
    console.error('[Settings] Webhook sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /settings/rules/sync-webhooks
router.post('/rules/sync-webhooks', async (req, res) => {
  try {
    const webhookManager = require('../services/webhookManager');
    const tokenStore     = require('../services/tokenStore');
    const allTokens      = await tokenStore.getAll();
    const allRules       = {};
    for (const portalId of Object.keys(allTokens)) {
      allRules[portalId] = await getRules(portalId);
    }
    await webhookManager.syncSubscriptions(allRules);
    res.json({ ok: true, message: 'Webhook subscriptions synced' });
  } catch (err) {
    console.error('[Settings] Webhook sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.getRules = getRules;
