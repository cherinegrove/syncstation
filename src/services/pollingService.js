// src/services/pollingService.js - WITH TIER ENFORCEMENT & ERROR LOGGING
const { getClient } = require('./hubspotClient');
const { sync } = require('./syncService');
const { getPortalTier, isObjectAllowed } = require('./tierService');
const { Pool } = require('pg');

let pool = null;
let isPolling = false;  // 🔥 CRITICAL: Mutex to prevent overlapping polling cycles

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

// ✅ NEW: Log sync results to database
async function logSyncResult(portalId, objectType, ruleName, status, errorMessage = null, recordsSynced = 0, sourceRecordId = null, targetRecordId = null) {
  const p = getPool();
  if (!p) return;
  
  try {
    await p.query(`
      INSERT INTO sync_logs (portal_id, sync_time, status, error_message, records_synced, object_type, rule_name, trigger_type, source_record_id, target_record_id)
      VALUES ($1, NOW(), $2, $3, $4, $5, $6, 'polling', $7, $8)
    `, [portalId, status, errorMessage, recordsSynced, objectType, ruleName, sourceRecordId, targetRecordId]);
  } catch (err) {
    console.error('[Polling] Error logging sync result:', err.message);
  }
}

// Track last sync time per portal
async function getLastSyncTime(portalId, objectType) {
  const p = getPool();
  if (!p) {
    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() - 24);
    return yesterday.toISOString();
  }
  
  try {
    const result = await p.query(
      'SELECT last_sync_time FROM polling_sync_times WHERE portal_id = $1 AND object_type = $2',
      [portalId, objectType]
    );
    
    if (result.rows.length > 0) {
      return result.rows[0].last_sync_time;
    }
    
    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() - 24);
    return yesterday.toISOString();
  } catch (err) {
    console.error(`[Polling] Error getting last sync time:`, err.message);
    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() - 24);
    return yesterday.toISOString();
  }
}

async function setLastSyncTime(portalId, objectType) {
  const p = getPool();
  if (!p) return;
  
  const now = new Date().toISOString();
  try {
    await p.query(
      `INSERT INTO polling_sync_times (portal_id, object_type, last_sync_time, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (portal_id, object_type) 
       DO UPDATE SET last_sync_time = $3, updated_at = NOW()`,
      [portalId, objectType, now]
    );
  } catch (err) {
    console.error(`[Polling] Error setting last sync time:`, err.message);
  }
}

// Get all portals that have active sync rules (for any object type)
async function getPortalsWithPollingRules() {
  const p = getPool();
  if (!p) {
    console.log('[Polling] No database - cannot fetch portals');
    return [];
  }
  
  try {
    // Get all portals with rules from sync_rules table
    const result = await p.query('SELECT portal_id, rules FROM sync_rules');
    
    const portalsWithPollingRules = [];
    
    // Object types we poll
    const polledObjects = ['contacts', 'companies', 'deals', 'tickets', 'leads', 'projects'];
    
    for (const row of result.rows) {
      const portalId = row.portal_id;
      const rules = row.rules || [];
      
      // Check if any rule involves any of our polled objects
      const hasPollingRule = rules.some(rule => 
        rule.enabled && 
        (polledObjects.includes(rule.sourceObject) || polledObjects.includes(rule.targetObject))
      );
      
      if (hasPollingRule) {
        portalsWithPollingRules.push(portalId);
      }
    }
    
    return portalsWithPollingRules;
  } catch (err) {
    console.error('[Polling] Error getting portals:', err.message);
    return [];
  }
}

// Get sync rules for a specific portal and object type
async function getSyncRulesForPolling(portalId, objectType) {
  const p = getPool();
  if (!p) return [];
  
  try {
    const result = await p.query('SELECT rules FROM sync_rules WHERE portal_id = $1', [portalId]);
    
    if (result.rows.length === 0) {
      return [];
    }
    
    const allRules = result.rows[0].rules || [];
    
    // Filter for rules that involve this object type
    const relevantRules = allRules.filter(rule => {
      if (!rule.enabled) return false;
      
      // Include if source matches
      if (rule.sourceObject === objectType) return true;
      
      // Include if target matches and direction is two-way
      if (rule.targetObject === objectType && rule.direction === 'two_way') return true;
      
      return false;
    });
    
    return relevantRules;
  } catch (err) {
    console.error('[Polling] Error getting sync rules:', err.message);
    return [];
  }
}

// 🆕 HELPER: Get all mapped field names from rules for an object type
function getMappedFieldsForObjectType(rules, objectType) {
  const mappedFields = new Set();
  
  for (const rule of rules) {
    if (rule.sourceObject === objectType) {
      // This object is the source - include all source fields
      rule.mappings.forEach(m => mappedFields.add(m.source));
    }
    
    if (rule.targetObject === objectType && rule.direction === 'two_way') {
      // This object is the target in a two-way sync - include all target fields
      rule.mappings.forEach(m => mappedFields.add(m.target));
    }
  }
  
  return Array.from(mappedFields);
}

// 🆕 OPTIMIZATION 1: Fetch changed records with ONLY mapped fields
async function getChangedRecords(client, objectType, sinceTime, mappedFields) {
  try {
    // Convert sinceTime to timestamp in milliseconds
    const sinceTimestamp = new Date(sinceTime).getTime();
    
    // 🆕 Request only the fields we actually care about (plus hs_object_id and hs_lastmodifieddate)
    const propertiesToFetch = ['hs_object_id', 'hs_lastmodifieddate', ...mappedFields];
    
    // Use search API to filter by last modified date
    const searchRequest = {
      filterGroups: [{
        filters: [{
          propertyName: 'hs_lastmodifieddate',
          operator: 'GTE',
          value: sinceTimestamp.toString()
        }]
      }],
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
      properties: propertiesToFetch,
      limit: 100
    };
    
    let allChangedRecords = [];
    let after = undefined;
    
    // Paginate through all results
    do {
      const response = await client.crm.objects.searchApi.doSearch(objectType, {
        ...searchRequest,
        after
      });
      
      allChangedRecords = allChangedRecords.concat(response.results || []);
      after = response.paging?.next?.after;
      
      // Safety limit: stop after 1000 records
      if (allChangedRecords.length >= 1000) {
        console.log(`[Polling] ⚠️ Reached 1000 record limit for ${objectType}`);
        break;
      }
    } while (after);
    
    console.log(`[Polling] Found ${allChangedRecords.length} changed ${objectType} records`);
    return allChangedRecords;
    
  } catch (err) {
    console.error(`[Polling] Error fetching ${objectType}:`, err.message);
    return [];
  }
}

// 🆕 HELPER: Delay function for rate limiting
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 🔥 CRITICAL: Shared write tracker with webhooks to prevent loops
const recentPollingWrites = new Map();

function markPollingWrite(objectType, objectId, properties) {
  const key = `${objectType}:${objectId}`;
  recentPollingWrites.set(key, {
    properties: Object.keys(properties),
    timestamp: Date.now()
  });
  
  // Clean up after 15 seconds (longer than webhook cleanup)
  setTimeout(() => recentPollingWrites.delete(key), 15000);
}

// Export this so webhooks can check it
function wasWrittenByPolling(objectType, objectId, propertyName) {
  const key = `${objectType}:${objectId}`;
  const write = recentPollingWrites.get(key);
  
  if (!write) return false;
  if (Date.now() - write.timestamp > 15000) {
    recentPollingWrites.delete(key);
    return false;
  }
  
  return write.properties.includes(propertyName);
}

// 🆕 OPTIMIZATION 2: Poll and sync with batching and rate limiting
async function pollObjectType(portalId, objectType) {
  console.log(`[Polling] Starting poll for ${objectType} in portal ${portalId}`);
  
  try {
    // ✅ TIER ENFORCEMENT: Check if portal can sync
    const tierInfo = await getPortalTier(portalId);
    
    if (!tierInfo.canSync) {
      console.log(`[Polling] ⛔ Portal ${portalId} cannot sync - tier: ${tierInfo.tier}, expired: ${tierInfo.isExpired}`);
      
      // ✅ LOG BLOCKED SYNC
      await logSyncResult(portalId, objectType, 'ALL_RULES', 'blocked', `Tier ${tierInfo.tier} - cannot sync`, 0);
      
      return { synced: 0, errors: 0 };
    }
    
    // ✅ TIER ENFORCEMENT: Check if object type is allowed for this tier
    if (!isObjectAllowed(tierInfo.tier, objectType)) {
      console.log(`[Polling] ⛔ Portal ${portalId} tier ${tierInfo.tier} doesn't allow ${objectType} - skipping`);
      
      // ✅ LOG BLOCKED OBJECT TYPE
      await logSyncResult(portalId, objectType, 'ALL_RULES', 'blocked', `Object type ${objectType} not allowed on ${tierInfo.tier}`, 0);
      
      return { synced: 0, errors: 0 };
    }
    
    const client = await getClient(portalId);
    const rules = await getSyncRulesForPolling(portalId, objectType);
    
    if (rules.length === 0) {
      console.log(`[Polling] No active rules for ${objectType} in portal ${portalId}`);
      return { synced: 0, errors: 0 };
    }
    
    // 🆕 Get only the fields that are actually mapped in our rules
    const mappedFields = getMappedFieldsForObjectType(rules, objectType);
    console.log(`[Polling] Watching ${mappedFields.length} mapped fields: ${mappedFields.join(', ')}`);
    
    const lastSync = await getLastSyncTime(portalId, objectType);
    console.log(`[Polling] Checking ${objectType} modified since ${lastSync}`);
    
    const changedRecords = await getChangedRecords(client, objectType, lastSync, mappedFields);
    
    let syncedCount = 0;
    let errorCount = 0;
    
    // 🔥 CRITICAL FIX: Aggressive rate limiting to prevent 429 errors
    // HubSpot limit: 10 calls per 10 seconds (ten_secondly_rolling)
    // With multiple rules per contact: 1 contact = ~16 API calls (fetch source + fetch targets + updates)
    // Safe rate: Process 1 record at a time with long delays between rules
    const BATCH_SIZE = 1;  // Process ONE record at a time
    const DELAY_BETWEEN_SYNCS = 1200;  // 1.2 seconds between each sync rule execution
    const DELAY_BETWEEN_BATCHES = 8000;  // 8 seconds between batches (records)
    let currentClient = client; // Track client so we can refresh mid-cycle
    
    for (let batchStart = 0; batchStart < changedRecords.length; batchStart += BATCH_SIZE) {
      const batch = changedRecords.slice(batchStart, batchStart + BATCH_SIZE);
      const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(changedRecords.length / BATCH_SIZE);

      // Refresh token every 20 batches (~2.5 min) to prevent mid-cycle 401 errors
      // HubSpot tokens expire after 30 min; this keeps them fresh
      if (batchNum > 1 && (batchNum % 20 === 1)) {
        try {
          currentClient = await getClient(portalId);
          console.log(`[Polling] ♻️  Token refreshed at batch ${batchNum}/${totalBatches} for portal ${portalId}`);
        } catch (refreshErr) {
          console.error(`[Polling] Token refresh failed at batch ${batchNum}:`, refreshErr.message);
        }
      }
      
      console.log(`[Polling] Processing batch ${batchNum}/${totalBatches} (${batch.length} records)`);
      
      // Process each record in the batch
      for (let i = 0; i < batch.length; i++) {
        const record = batch[i];
        const recordId = record.id;
        
        // Apply all matching sync rules
        for (const rule of rules) {
          try {
            let sourceObjectType = rule.sourceObject;
            let sourceId = recordId;
            let targetObjectType = rule.targetObject;
            
            // If this is a two-way rule and the record is the target object
            if (rule.direction === 'two_way' && rule.targetObject === objectType) {
              sourceObjectType = rule.targetObject;
              targetObjectType = rule.sourceObject;
            }
            
            const result = await sync(currentClient, {
              portalId,
              sourceObjectType,
              sourceId,
              targetObjectType,
              direction: rule.direction,
              mappings: rule.mappings,
              skipIfHasValue: rule.skipIfHasValue === 'true',
              associationRule: rule.assocRule || 'all',
              associationLabel: rule.assocLabel || '',
              onWrite: markPollingWrite,  // 🔥 CRITICAL: Mark writes to prevent webhook loops
              ruleSourceObject: rule.sourceObject,  // For mapping reversal
              ruleTargetObject: rule.targetObject   // For mapping reversal
            });
            
            if (result.status === 'success' || result.status === 'no_updates') {
              syncedCount += result.updated;
              console.log(`[Polling] Rule "${rule.name}" synced ${result.updated} record(s)`);
              
              // ✅ LOG PER-TARGET RECORD
              if (result.targets && result.targets.length > 0) {
                for (const target of result.targets) {
                  const targetStatus = target.status === 'updated' ? 'success' : (target.status === 'error' ? 'error' : 'blocked');
                  const targetErr    = target.status === 'error' ? (target.error || 'Unknown error') : null;
                  await logSyncResult(portalId, objectType, rule.name, targetStatus, targetErr, target.status === 'updated' ? 1 : 0, String(sourceId), String(target.id));
                }
              } else {
                await logSyncResult(portalId, objectType, rule.name, 'success', null, result.updated, String(sourceId), null);
              }
            }
            
            if (result.errors && result.errors.length > 0) {
              errorCount += result.errors.length;
              
              // ✅ LOG ERRORS
              for (const error of result.errors) {
                await logSyncResult(portalId, objectType, rule.name, 'error', error.message, 0, String(sourceId), null);
              }
            }
            
            // 🆕 Add delay between syncs to prevent rate limiting
            await delay(DELAY_BETWEEN_SYNCS);
            
          } catch (err) {
            console.error(`[Polling] Rule "${rule.name}" failed:`, err.message);
            errorCount++;
            
            // ✅ LOG ERROR
            await logSyncResult(portalId, objectType, rule.name, 'error', err.message, 0);
          }
        }
      }
      
      // 🆕 Add longer delay between batches
      if (batchStart + BATCH_SIZE < changedRecords.length) {
        console.log(`[Polling] Batch ${batchNum} complete. Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
        await delay(DELAY_BETWEEN_BATCHES);
      }
    }
    
    // Update last sync time
    await setLastSyncTime(portalId, objectType);
    
    console.log(`[Polling] ${objectType} poll complete: ${syncedCount} synced, ${errorCount} errors`);
    return { synced: syncedCount, errors: errorCount };
    
  } catch (err) {
    console.error(`[Polling] Error polling ${objectType} for portal ${portalId}:`, err.message);
    
    // ✅ LOG POLLING ERROR
    await logSyncResult(portalId, objectType, 'POLLING', 'error', err.message, 0);
    
    return { synced: 0, errors: 1 };
  }
}

// Main polling function - runs every 15 minutes
async function runPollingCycle() {
  // 🔥 CRITICAL: Prevent overlapping polling cycles
  if (isPolling) {
    console.log('[Polling] ⏭️ Skipping cycle - previous cycle still running');
    return;
  }
  
  isPolling = true;
  console.log('[Polling] ========== Starting polling cycle ==========');
  const startTime = Date.now();
  
  try {
    const portals = await getPortalsWithPollingRules();
    console.log(`[Polling] Found ${portals.length} portal(s) with polling rules`);
    
    let totalSynced = 0;
    let totalErrors = 0;
    
    for (const portalId of portals) {
      // Poll Contacts
      const contactsResult = await pollObjectType(portalId, 'contacts');
      totalSynced += contactsResult.synced;
      totalErrors += contactsResult.errors;
      
      // Poll Companies
      const companiesResult = await pollObjectType(portalId, 'companies');
      totalSynced += companiesResult.synced;
      totalErrors += companiesResult.errors;
      
      // Poll Deals
      const dealsResult = await pollObjectType(portalId, 'deals');
      totalSynced += dealsResult.synced;
      totalErrors += dealsResult.errors;
      
      // Poll Tickets
      const ticketsResult = await pollObjectType(portalId, 'tickets');
      totalSynced += ticketsResult.synced;
      totalErrors += ticketsResult.errors;
      
      // Poll Leads
      const leadsResult = await pollObjectType(portalId, 'leads');
      totalSynced += leadsResult.synced;
      totalErrors += leadsResult.errors;
      
      // Poll Projects
      const projectsResult = await pollObjectType(portalId, 'projects');
      totalSynced += projectsResult.synced;
      totalErrors += projectsResult.errors;
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[Polling] ========== Cycle complete in ${duration}s: ${totalSynced} synced, ${totalErrors} errors ==========`);
    
  } catch (err) {
    console.error('[Polling] Polling cycle error:', err.message);
  } finally {
    // 🔥 CRITICAL: Always release the mutex
    isPolling = false;
  }
}

// Initialize polling sync times table
async function initPollingTable() {
  const p = getPool();
  if (!p) {
    console.log('[Polling] No database connection - polling will work with 24hr lookback only');
    return;
  }
  
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS polling_sync_times (
        portal_id TEXT NOT NULL,
        object_type TEXT NOT NULL,
        last_sync_time TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (portal_id, object_type)
      )
    `);
    console.log('[Polling] Table ready');
  } catch (err) {
    console.error('[Polling] Table init error:', err.message);
  }
}

module.exports = {
  runPollingCycle,
  initPollingTable,
  wasWrittenByPolling  // 🔥 Export so webhooks can check for polling writes
};
