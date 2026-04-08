// src/services/pollingService.js - OPTIMIZED VERSION
const { getClient } = require('./hubspotClient');
const { sync } = require('./syncService');
const { Pool } = require('pg');

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

// 🆕 OPTIMIZATION 2: Poll and sync with batching and rate limiting
async function pollObjectType(portalId, objectType) {
  console.log(`[Polling] Starting poll for ${objectType} in portal ${portalId}`);
  
  try {
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
    
    // 🆕 OPTIMIZATION 3: Process in batches of 20 with delays
    const BATCH_SIZE = 20;
    const DELAY_BETWEEN_SYNCS = 150; // 150ms between each sync
    const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds between batches
    
    for (let batchStart = 0; batchStart < changedRecords.length; batchStart += BATCH_SIZE) {
      const batch = changedRecords.slice(batchStart, batchStart + BATCH_SIZE);
      const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(changedRecords.length / BATCH_SIZE);
      
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
            
            const result = await sync(client, {
              portalId,
              sourceObjectType,
              sourceId,
              targetObjectType,
              direction: rule.direction,
              mappings: rule.mappings,
              skipIfHasValue: rule.skipIfHasValue === 'true',
              associationRule: rule.assocRule || 'all',
              associationLabel: rule.assocLabel || '',
              ruleSourceObject: rule.sourceObject,  // ADDED
              ruleTargetObject: rule.targetObject   // ADDED
            });
            });
            
            if (result.status === 'success') {
              syncedCount += result.updated;
              console.log(`[Polling] Rule "${rule.name}" synced ${result.updated} record(s)`);
            }
            
            if (result.errors && result.errors.length > 0) {
              errorCount += result.errors.length;
            }
            
            // 🆕 Add delay between syncs to prevent rate limiting
            await delay(DELAY_BETWEEN_SYNCS);
            
          } catch (err) {
            console.error(`[Polling] Rule "${rule.name}" failed:`, err.message);
            errorCount++;
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
    return { synced: 0, errors: 1 };
  }
}

// Main polling function - runs every 15 minutes
async function runPollingCycle() {
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
  initPollingTable
};
