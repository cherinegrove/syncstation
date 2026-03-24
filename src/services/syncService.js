// src/services/syncService.js
const axios = require('axios');

// Map object types to HubSpot API object type IDs
const OBJECT_TYPE_MAP = {
  contacts:  'contacts',
  companies: 'companies',
  deals:     'deals',
  tickets:   'tickets',
  leads:     'leads',
  products:  'products',
  projects:  'projects'
};

async function getProperties(client, objectType, objectId, properties) {
  try {
    // Use the generic objects API which works for all object types
    const propsParam = properties.join(',');
    const response = await client.crm.objects.basicApi.getById(
      objectType, String(objectId), properties
    );
    return response.properties || {};
  } catch (err) {
    console.error(`[Sync] Failed to get properties for ${objectType} ${objectId}:`, err.message);
    return {};
  }
}

async function updateProperties(client, objectType, objectId, properties) {
  try {
    await client.crm.objects.basicApi.update(
      objectType, String(objectId), { properties }
    );
    return true;
  } catch (err) {
    console.error(`[Sync] Failed to update ${objectType} ${objectId}:`, err.message);
    return false;
  }
}

async function getAssociations(client, fromObjectType, fromObjectId, toObjectType) {
  try {
    // Try v4 associations API
    const response = await client.crm.associations.v4.basicApi.getPage(
      fromObjectType, String(fromObjectId), toObjectType, undefined, 500
    );
    return response?.results || [];
  } catch (err) {
    console.error(`[Sync] Associations error:`, err.message);
    // Try v3 as fallback
    try {
      const response = await client.crm.associations.basicApi.getAll(
        fromObjectType, String(fromObjectId), toObjectType
      );
      return (response?.results || []).map(r => ({ toObjectId: r.id }));
    } catch (err2) {
      console.error(`[Sync] Associations v3 fallback error:`, err2.message);
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
  associationLabel
}) {
  console.log(`[Sync] Starting: ${sourceObjectType} ${sourceId} -> ${targetObjectType}`);
  console.log(`[Sync] Mappings: ${mappings.length}, Direction: ${direction}, Rule: ${associationRule}`);

  // Always fetch fresh source properties from API (fixes stale value bug)
  const srcPropNames = mappings.map(m => m.source);
  const sourceProps = await getProperties(client, sourceObjectType, sourceId, srcPropNames);
  console.log(`[Sync] Source properties fetched:`, JSON.stringify(sourceProps));

  // Get ALL associated target records
  const associations = await getAssociations(client, sourceObjectType, sourceId, targetObjectType);
  console.log(`[Sync] Found ${associations.length} associated ${targetObjectType} records`);

  let targets = associations;

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
  // 'all' — use all targets

  console.log(`[Sync] Processing ${targets.length} target records after association rule`);

  if (targets.length === 0) {
    return { status: 'no_targets', updated: 0, targets: [] };
  }

  const results = [];
  let updatedCount = 0;

  for (const target of targets) {
    const targetId = target.toObjectId || target.id || target.objectId;
    if (!targetId) {
      console.log('[Sync] Skipping target with no ID:', JSON.stringify(target));
      continue;
    }

    try {
      let targetProps = {};

      // Fetch target properties if needed
      if (direction === 'two_way' || skipIfHasValue) {
        const tgtPropNames = mappings.map(m => m.target);
        targetProps = await getProperties(client, targetObjectType, targetId, tgtPropNames);
      }

      const propsToUpdate = {};

      for (const mapping of mappings) {
        const srcVal = sourceProps[mapping.source];
        const tgtVal = targetProps[mapping.target];

        if (direction === 'two_way') {
          // Always sync source to target (most recent wins since we fetch fresh)
          propsToUpdate[mapping.target] = srcVal !== undefined ? srcVal : '';
        } else {
          // One-way: source → target
          if (skipIfHasValue && tgtVal) {
            console.log(`[Sync] Skipping ${mapping.target} - target already has value`);
            continue;
          }
          propsToUpdate[mapping.target] = srcVal !== undefined ? srcVal : '';
        }
      }

      if (Object.keys(propsToUpdate).length > 0) {
        const success = await updateProperties(client, targetObjectType, targetId, propsToUpdate);
        if (success) {
          updatedCount++;
          results.push({ id: targetId, status: 'updated', properties: Object.keys(propsToUpdate) });
          console.log(`[Sync] Updated ${targetObjectType} ${targetId}:`, Object.keys(propsToUpdate));
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
