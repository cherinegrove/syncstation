// src/services/syncService.js

const axios = require('axios');

// Standard HubSpot CRM objects
const STANDARD_OBJECTS = [
  'contacts', 'companies', 'deals', 'tickets', 'leads',
  'products', 'line_items', 'quotes', 'tasks', 'calls',
  'meetings', 'notes', 'emails', 'appointments'
];

// Custom objects that need special handling
const CUSTOM_OBJECTS = [
  'projects', 'courses', 'listings', 'services',
  'invoices', 'orders', 'goals'
];

function isCustomObject(objectType) {
  return CUSTOM_OBJECTS.includes(objectType?.toLowerCase());
}

// Get properties for both standard and custom objects
async function getProperties(client, objectType, objectId, properties) {
  try {
    // For custom objects, use direct axios call to ensure proper endpoint
    if (isCustomObject(objectType)) {
      const accessToken = client.accessToken || client._accessToken;
      const propertyList = Array.isArray(properties) ? properties.join(',') : properties;
      
      const url = `https://api-eu1.hubapi.com/crm/v3/objects/${objectType}/${objectId}`;
      const response = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        params: { properties: propertyList }
      });
      
      console.log(`[Sync] Custom object ${objectType} ${objectId} fetched via direct API`);
      return response.data.properties || {};
    }
    
    // Standard objects use SDK
    const response = await client.crm.objects.basicApi.getById(
      objectType, String(objectId), properties
    );
    return response.properties || {};
    
  } catch (err) {
    console.error(`[Sync] Failed to get properties for ${objectType} ${objectId}:`, err.message);
    if (err.response?.data) {
      console.error(`[Sync] API Error Details:`, JSON.stringify(err.response.data));
    }
    return {};
  }
}

// Update properties for both standard and custom objects
async function updateProperties(client, objectType, objectId, properties) {
  try {
    // For custom objects, use direct axios call
    if (isCustomObject(objectType)) {
      const accessToken = client.accessToken || client._accessToken;
      
      const url = `https://api-eu1.hubapi.com/crm/v3/objects/${objectType}/${objectId}`;
      await axios.patch(url, {
        properties
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log(`[Sync] Custom object ${objectType} ${objectId} updated via direct API`);
      return true;
    }
    
    // Standard objects use SDK
    await client.crm.objects.basicApi.update(
      objectType, String(objectId), { properties }
    );
    return true;
    
  } catch (err) {
    console.error(`[Sync] Failed to update ${objectType} ${objectId}:`, err.message);
    if (err.response?.data) {
      console.error(`[Sync] API Error Details:`, JSON.stringify(err.response.data));
    }
    return false;
  }
}

// Get associations between objects (works for both standard and custom)
async function getAssociations(client, fromObjectType, fromObjectId, toObjectType) {
  try {
    // Try v4 associations API first (supports custom objects)
    const response = await client.crm.associations.v4.basicApi.getPage(
      fromObjectType, String(fromObjectId), toObjectType, undefined, 500
    );
    console.log(`[Sync] Found ${response?.results?.length || 0} associations from ${fromObjectType} ${fromObjectId} to ${toObjectType}`);
    return response?.results || [];
    
  } catch (err) {
    console.log(`[Sync] v4 associations failed, trying v3 fallback...`);
    
    // Try v3 fallback
    try {
      const response = await client.crm.associations.basicApi.getAll(
        fromObjectType, String(fromObjectId), toObjectType
      );
      const results = (response?.results || []).map(r => ({ toObjectId: r.id }));
      console.log(`[Sync] v3 fallback: Found ${results.length} associations`);
      return results;
      
    } catch (err2) {
      console.error(`[Sync] All association methods failed for ${fromObjectType} ${fromObjectId} -> ${toObjectType}:`, err2.message);
      return [];
    }
  }
}

async function sync(client, {
  sourceObjectType,
  sourceId,
  targetObjectType,
  direction,
  mappings,
  skipIfHasValue,
  associationRule,
  associationLabel,
  onWrite // callback to mark our writes (prevents bidirectional loops)
}) {
  console.log(`[Sync] Starting: ${sourceObjectType} ${sourceId} -> ${targetObjectType} (${direction})`);
  console.log(`[Sync] Source is ${isCustomObject(sourceObjectType) ? 'CUSTOM' : 'STANDARD'} object`);
  console.log(`[Sync] Target is ${isCustomObject(targetObjectType) ? 'CUSTOM' : 'STANDARD'} object`);

  // Always fetch fresh source properties (fixes stale value bug)
  const srcPropNames = mappings.map(m => m.source);
  const sourceProps  = await getProperties(client, sourceObjectType, sourceId, srcPropNames);
  console.log(`[Sync] Source properties:`, JSON.stringify(sourceProps));

  if (Object.keys(sourceProps).length === 0) {
    console.error(`[Sync] Could not fetch source properties - aborting sync`);
    return { status: 'error', updated: 0, targets: [], error: 'Could not fetch source properties' };
  }

  // Get ALL associated target records
  const associations = await getAssociations(client, sourceObjectType, sourceId, targetObjectType);
  console.log(`[Sync] Found ${associations.length} associated ${targetObjectType} records`);

  let targets = [...associations];

  // Apply association rule
  if (associationRule === 'first') {
    targets = targets.slice(0, 1);
  } else if (associationRule === 'recent') {
    targets = targets.slice(-1);
  } else if (associationRule === 'labeled' && associationLabel) {
    targets = targets.filter(t =>
      t.associationTypes?.some(a =>
        a.label?.toLowerCase() === associationLabel.toLowerCase()
      )
    );
  }

  console.log(`[Sync] Processing ${targets.length} target(s) after association rule "${associationRule}"`);

  if (!targets.length) {
    return { status: 'no_targets', updated: 0, targets: [] };
  }

  const results = [];
  let updatedCount = 0;

  for (const target of targets) {
    const targetId = target.toObjectId || target.id || target.objectId;
    if (!targetId) continue;

    try {
      let targetProps = {};
      if (direction === 'two_way' || skipIfHasValue) {
        const tgtPropNames = mappings.map(m => m.target);
        targetProps = await getProperties(client, targetObjectType, targetId, tgtPropNames);
      }

      const propsToUpdate = {};

      for (const mapping of mappings) {
        const srcVal = sourceProps[mapping.source];
        const tgtVal = targetProps[mapping.target];

        if (skipIfHasValue && tgtVal) {
          console.log(`[Sync] Skipping ${mapping.target} — target already has value "${tgtVal}"`);
          continue;
        }

        propsToUpdate[mapping.target] = srcVal !== undefined ? srcVal : '';
      }

      if (Object.keys(propsToUpdate).length > 0) {
        // Mark these writes BEFORE updating so webhooks can be ignored
        if (onWrite) {
          onWrite(targetObjectType, String(targetId), propsToUpdate);
        }

        const success = await updateProperties(client, targetObjectType, targetId, propsToUpdate);
        if (success) {
          updatedCount++;
          results.push({ id: targetId, status: 'updated', properties: Object.keys(propsToUpdate) });
          console.log(`[Sync] ✅ Updated ${targetObjectType} ${targetId}:`, Object.keys(propsToUpdate));
        } else {
          results.push({ id: targetId, status: 'error', error: 'Update failed' });
        }
      } else {
        results.push({ id: targetId, status: 'skipped' });
      }
    } catch (err) {
      console.error(`[Sync] Failed for target ${targetId}:`, err.message);
      results.push({ id: targetId, status: 'error', error: err.message });
    }
  }

  const status = updatedCount > 0 ? 'success' : 'no_updates';
  console.log(`[Sync] Complete: ${updatedCount}/${targets.length} updated`);
  return { status, updated: updatedCount, targets: results };
}

module.exports = { sync };
