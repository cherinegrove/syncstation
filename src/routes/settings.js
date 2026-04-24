// src/routes/settings.js
const express       = require('express');
const router        = express.Router();
const path          = require('path');
const { getClient } = require('../services/hubspotClient');
const { Pool }      = require('pg');
const { validateMapping, getCompatibleTypes } = require('../utils/fieldTypeCompatibility');
const { getPortalTier } = require('../services/tierService');

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
  { name: 'contacts',  label: 'Contacts' },
  { name: 'companies', label: 'Companies' },
  { name: 'deals',     label: 'Deals' },
  { name: 'tickets',   label: 'Tickets' },
  { name: 'leads',     label: 'Leads' },
  { name: 'projects',  label: 'Projects', objectTypeId: '0-970' },  // Hardcoded for portal 26123886
  { name: 'services',  label: 'Services' },
  { name: 'courses',   label: 'Courses' },
  { name: 'listings',  label: 'Listings' }
];

// Cache available objects per portal (5 min TTL)
const objectsCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

// GET /settings
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/settings.html'));
});

// GET /settings/errors - Return sync errors for a portal
router.get('/errors', async (req, res) => {
  const { portalId } = req.query;
  if (!portalId) return res.status(400).json({ error: 'Missing portalId' });
  
  // Prevent browser caching
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  // TODO: Implement actual error fetching from sync_logs table
  // For now, return empty errors to prevent frontend crashes
  res.json({ errors: [] });
});

// DELETE /settings/errors - Clear all errors for a portal
router.delete('/errors', async (req, res) => {
  const { portalId } = req.query;
  if (!portalId) return res.status(400).json({ error: 'Missing portalId' });
  
  // TODO: Implement actual error clearing
  res.json({ ok: true });
});

// GET /settings/rules
router.get('/rules', async (req, res) => {
  const { portalId } = req.query;
  if (!portalId) return res.status(400).json({ error: 'Missing portalId' });
  
  // Prevent browser caching of portal-specific data
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  const rules = await getRules(portalId);
  res.json({ rules });
});

// GET /settings/tier - Get portal tier info
router.get('/tier', async (req, res) => {
  const { portalId } = req.query;
  if (!portalId) return res.status(400).json({ error: 'Missing portalId' });
  
  try {
    const tierInfo = await getPortalTier(portalId);
    console.log('[Settings] GET /tier for portal', portalId, '- returning:', tierInfo.tier);
    // Prevent caching of tier information
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json(tierInfo);
  } catch (err) {
    console.error('[Settings] Error getting tier:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /settings/rules - WITH FIELD TYPE VALIDATION
router.post('/rules', async (req, res) => {
  const { portalId, rules } = req.body;
  if (!portalId) return res.status(400).json({ error: 'Missing portalId' });
  
  // CHECK TIER MAPPING LIMIT FIRST
  try {
    const tierInfo = await getPortalTier(portalId);
    const tier = tierInfo.tier || 'trial';
    
    // Define tier limits (must match frontend)
    const tierLimits = {
      free: 999999,
      trial: 30,
      starter: 10,
      pro: 30,
      business: 100
    };
    
    const limit = tierLimits[tier] || 30;
    
    // Count total mappings across ALL rules
    const totalMappings = (rules || []).reduce((sum, rule) => {
      return sum + (rule.mappings?.length || 0);
    }, 0);
    
    // Block if over limit
    if (totalMappings > limit) {
      const tierNames = {
        trial: 'Trial',
        starter: 'Starter',
        pro: 'Pro',
        business: 'Business'
      };
      
      return res.status(400).json({ 
        error: `Mapping limit exceeded`,
        message: `You have ${totalMappings} property mappings but your ${tierNames[tier]} plan allows ${limit}.\n\nPlease remove ${totalMappings - limit} mapping(s) or upgrade your plan.`,
        limit: limit,
        current: totalMappings,
        tier: tier
      });
    }
  } catch (err) {
    console.error('[Settings] Error checking tier limit:', err.message);
    // Continue even if tier check fails (don't block legitimate saves)
  }
  
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

    // Auto-sync webhooks after saving rules
    try {
      const webhookManager = require('../services/webhookManager');
      const tokenStore     = require('../services/tokenStore');
      const allTokens      = await tokenStore.getAll();
      const allRules       = {};
      for (const pid of Object.keys(allTokens)) {
        allRules[pid] = await getRules(pid);
      }
      await webhookManager.syncSubscriptions(allRules);
      console.log(`[Settings] Webhooks synced for portal ${portalId}`);
    } catch (webhookErr) {
      console.error('[Settings] Webhook sync error (non-fatal):', webhookErr.message);
    }

    res.json({ 
      ok: true,
      validationWarnings: validationWarnings.length > 0 ? validationWarnings : undefined
    });
    
  } catch (err) {
    console.error('[Settings] Error saving rules:', err.message);
    // Fall back to saving without validation if validation fails
    await saveRules(portalId, rules || []);

    // Auto-sync webhooks after saving rules
    try {
      const webhookManager = require('../services/webhookManager');
      const tokenStore     = require('../services/tokenStore');
      const allTokens      = await tokenStore.getAll();
      const allRules       = {};
      for (const pid of Object.keys(allTokens)) {
        allRules[pid] = await getRules(pid);
      }
      await webhookManager.syncSubscriptions(allRules);
      console.log(`[Settings] Webhooks synced for portal ${portalId}`);
    } catch (webhookErr) {
      console.error('[Settings] Webhook sync error (non-fatal):', webhookErr.message);
    }

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

  // Prevent browser caching of portal-specific data
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

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

    // First, fetch custom object schemas to get correct objectTypeId for projects
    let projectsObjectTypeId = 'projects'; // fallback
    try {
      console.log('[Settings] Attempting to fetch schemas from /crm/v3/schemas...');
      console.log('[Settings] Using access token:', accessToken ? `${accessToken.substring(0, 20)}...` : 'MISSING');
      
      const schemasRes = await axios.get(
        'https://api-eu1.hubapi.com/crm/v3/schemas',
        { 
          headers: { Authorization: `Bearer ${accessToken}` }, 
          timeout: 10000  // Increased timeout
        }
      );
      
      console.log('[Settings] Schemas API response status:', schemasRes.status);
      console.log('[Settings] Schemas API returned:', schemasRes.data?.results?.length || 0, 'schemas');
      console.log('[Settings] All schemas:', JSON.stringify(schemasRes.data?.results || [], null, 2));
      
      const projectSchema = (schemasRes.data?.results || []).find(s => 
        s.name?.toLowerCase() === 'projects' || 
        s.labels?.singular?.toLowerCase() === 'project'
      );
      
      if (projectSchema) {
        projectsObjectTypeId = projectSchema.objectTypeId || projectSchema.name;
        console.log(`[Settings] ✅ Found Projects with objectTypeId: ${projectsObjectTypeId}`);
      } else {
        console.log('[Settings] ⚠️ Projects not found in schemas API response');
      }
    } catch (err) {
      console.error('[Settings] ❌ Schemas API error:', err.message);
      console.error('[Settings] Error details:', err.response?.status, err.response?.data);
      console.error('[Settings] This means the OAuth token likely does not have crm.schemas.* scopes');
    }

    // Add custom objects from schemas to the test list
    let customFromSchemas = [];
    try {
      const schemasForCustom = await axios.get(
        'https://api-eu1.hubapi.com/crm/v3/schemas',
        { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000 }
      );
      customFromSchemas = (schemasForCustom.data?.results || [])
        .filter(s => !OBJECTS_TO_TEST.find(o => o.name === s.name))
        .map(s => ({
          name:         s.objectTypeId || s.name,
          label:        s.labels?.singular || s.name,
          objectTypeId: s.objectTypeId || s.name
        }));
      console.log(`[Settings] Found ${customFromSchemas.length} custom objects from schemas`);
    } catch (err) {
      console.log('[Settings] Could not fetch custom schemas:', err.message);
    }

    // Build final objects list: standard objects + custom objects from schemas
    const objectsToTest = [
      ...OBJECTS_TO_TEST.map(obj => {
        if (obj.name === 'projects') {
          return { ...obj, objectTypeId: projectsObjectTypeId };
        }
        return obj;
      }),
      ...customFromSchemas
    ];

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
          return { 
            name: obj.name,
            objectTypeId: obj.objectTypeId || obj.name, // Use objectTypeId if available, else name
            label: obj.label,
            accessible: true 
          };
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

    for (let i = 0; i < objectsToTest.length; i += BATCH_SIZE) {
      const batch   = objectsToTest.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(testObject));
      accessible.push(...results.filter(Boolean));
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

// GET /settings/test-object-access - Test if we can write to a specific object
router.get('/test-object-access', async (req, res) => {
  const { portalId, objectType } = req.query;
  
  if (!portalId || !objectType) {
    return res.status(400).json({ error: 'Missing portalId or objectType' });
  }

  try {
    const client = await getClient(portalId);
    
    // Custom objects that commonly have write restrictions
    const customObjects = ['projects', 'courses', 'listings', 'services', 'invoices', 'orders', 'goals'];
    const isCustom = customObjects.includes(objectType.toLowerCase());
    
    // Try to fetch records to test read access
    try {
      await client.crm.objects.basicApi.getPage(objectType, 1);
      
      // We can read - but can we write?
      // For custom objects on Pro plans, read works but write often doesn't
      res.json({
        objectType,
        canRead: true,
        canWrite: !isCustom, // Assume standard objects are fully writable
        isCustom,
        warning: isCustom ? 'Custom objects may have limited write access on Sales Hub Pro' : null,
        recommendation: isCustom ? 'Consider one-way sync rules (read-only from this object)' : null
      });
      
    } catch (err) {
      if (err.message && (err.message.includes('credentials') || err.message.includes('auth') || err.message.includes('not found'))) {
        res.json({
          objectType,
          canRead: false,
          canWrite: false,
          error: 'No API access to this object',
          recommendation: 'This object may require Enterprise plan or may not exist'
        });
      } else {
        throw err;
      }
    }

  } catch (err) {
    console.error('[Settings] Error testing object access:', err.message);
    res.status(500).json({ 
      error: err.message,
      canRead: false,
      canWrite: false
    });
  }
});

module.exports = router;
module.exports.getRules = getRules;
