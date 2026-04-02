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

// Error types for user-friendly messages
const ERROR_TYPES = {
  PERMISSION_DENIED: 'permission_denied',
  CUSTOM_OBJECT_UNAVAILABLE: 'custom_object_unavailable',
  PROPERTY_NOT_FOUND: 'property_not_found',
  RATE_LIMIT: 'rate_limit',
  ASSOCIATION_FAILED: 'association_failed',
  OBJECT_NOT_FOUND: 'object_not_found',
  UNKNOWN: 'unknown'
};

// Parse HubSpot API errors into user-friendly messages
function parseApiError(err, objectType) {
  const status = err.response?.status;
  const errorData = err.response?.data;
  const message = errorData?.message || err.message;
  
  // 403 Forbidden - Permission/scope issues
  if (status === 403) {
    if (isCustomObject(objectType)) {
      return {
        type: ERROR_TYPES.CUSTOM_OBJECT_UNAVAILABLE,
        userMessage: `Custom object "${objectType}" is not available on your HubSpot plan. Upgrade to Enterprise or use standard objects (Contacts, Companies, Deals, Tickets).`,
        technicalMessage: message
      };
    }
    return {
      type: ERROR_TYPES.PERMISSION_DENIED,
      userMessage: `Permission denied for "${objectType}". Your HubSpot app may need additional scopes or your plan doesn't support this feature.`,
      technicalMessage: message
    };
  }
  
  // 404 Not Found - Object or property doesn't exist
  if (status === 404) {
    if (message?.toLowerCase().includes('property')) {
      return {
        type: ERROR_TYPES.PROPERTY_NOT_FOUND,
        userMessage: `Property not found on "${objectType}". The property may have been deleted or doesn't exist on this object type.`,
        technicalMessage: message
      };
    }
    return {
      type: ERROR_TYPES.OBJECT_NOT_FOUND,
      userMessage: `"${objectType}" object not found or not accessible in your HubSpot portal.`,
      technicalMessage: message
    };
  }
  
  // 429 Rate Limit
  if (status === 429) {
    return {
      type: ERROR_TYPES.RATE_LIMIT,
      userMessage: `HubSpot API rate limit reached. Sync will retry automatically in a few minutes.`,
      technicalMessage: message
    };
  }
  
  // 400 Bad Request - Often association issues
  if (status === 400 && message?.toLowerCase().includes('association')) {
    return {
      type: ERROR_TYPES.ASSOCIATION_FAILED,
      userMessage: `Association between objects failed. Check if these object types can be associated in HubSpot.`,
      technicalMessage: message
    };
  }
  
  // Generic error
  return {
    type: ERROR_TYPES.UNKNOWN,
    userMessage: `Sync failed: ${message}`,
    technicalMessage: message
  };
}

// Get properties for both standard and custom objects
async function getProperties(client, objectType, objectId, properties, portalId) {
  try {
    // For custom objects, use direct axios call to ensure proper endpoint
    if (isCustomObject(objectType)) {
      // Get access token from tokenStore, not from client
      const tokenStore = require('./tokenStore');
      const tokens = await tokenStore.get(portalId);
      
      if (!tokens?.access_token) {
        throw new Error('No access token found for portal');
      }
      
      const accessToken = tokens.access_token;
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
    const errorInfo = parseApiError(err, objectType);
    console.error(`[Sync] Failed to get properties for ${objectType} ${objectId}:`, errorInfo.userMessage);
    
    // Throw with enhanced error info
    const enhancedError = new Error(errorInfo.userMessage);
    enhancedError.type = errorInfo.type;
    enhancedError.technicalMessage = errorInfo.technicalMessage;
    enhancedError.objectType = objectType;
    throw enhancedError;
  }
}

// Update properties for both standard and custom objects
async function updateProperties(client, objectType, objectId, properties, portalId) {
  try {
    // For custom objects, use direct axios call
    if (isCustomObject(objectType)) {
      // Get access token from tokenStore, not from client
      const tokenStore = require('./tokenStore');
      const tokens = await tokenStore.get(portalId);
      
      if (!tokens?.access_token) {
        throw new Error('No access token found for portal');
      }
      
      const accessToken = tokens.access_token;
      
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
      return { success: true };
    }
    
    // Standard objects use SDK
    await client.crm.objects.basicApi.update(
      objectType, String(objectId), { properties }
    );
    return { success: true };
    
  } catch (err) {
    const errorInfo = parseApiError(err, objectType);
    console.error(`[Sync] Failed to update ${objectType} ${objectId}:`, errorInfo.userMessage);
    
    return { 
      success: false, 
      error: errorInfo.userMessage,
      errorType: errorInfo.type,
      technicalMessage: errorInfo.technicalMessage
    };
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
      const errorInfo = parseApiError(err2, toObjectType);
      console.error(`[Sync] Association lookup failed:`, errorInfo.userMessage);
      
      // Don't throw - just return empty array and log the issue
      // This allows partial sync to continue
      return [];
    }
  }
}

async function sync(client, {
  portalId, // ADDED: Need portalId to fetch tokens for custom objects
  sourceObjectType,
  sourceId,
  targetObjectType,
  direction,
  mappings,
  skipIfHasValue,
  associationRule,
  associationLabel,
  onWrite, // callback to mark our writes (prevents bidirectional loops)
  ruleSourceObject, // The original rule's source object (for reversing mappings)
  ruleTargetObject  // The original rule's target object (for reversing mappings)
}) {
  console.log(`[Sync] Starting: ${sourceObjectType} ${sourceId} -> ${targetObjectType} (${direction})`);
  console.log(`[Sync] Source is ${isCustomObject(sourceObjectType) ? 'CUSTOM' : 'STANDARD'} object`);
  console.log(`[Sync] Target is ${isCustomObject(targetObjectType) ? 'CUSTOM' : 'STANDARD'} object`);

  const syncResult = {
    status: 'unknown',
    updated: 0,
    targets: [],
    errors: [],
    warnings: []
  };

  // REVERSE MAPPINGS if we're syncing in the opposite direction of the rule definition
  let effectiveMappings = mappings;
  if (ruleSourceObject && ruleTargetObject) {
    const syncingInReverse = (sourceObjectType === ruleTargetObject && targetObjectType === ruleSourceObject);
    if (syncingInReverse) {
      console.log(`[Sync] Reversing mappings for bidirectional sync`);
      effectiveMappings = mappings.map(m => ({
        source: m.target,  // Swap source and target
        target: m.source
      }));
    }
  }

  // Always fetch fresh source properties (fixes stale value bug)
  const srcPropNames = effectiveMappings.map(m => m.source);
  let sourceProps;
  
  try {
    sourceProps = await getProperties(client, sourceObjectType, sourceId, srcPropNames, portalId);
    console.log(`[Sync] Source properties:`, JSON.stringify(sourceProps));
  } catch (err) {
    syncResult.status = 'error';
    syncResult.errors.push({
      stage: 'fetch_source',
      message: err.message,
      type: err.type,
      objectType: sourceObjectType
    });
    return syncResult;
  }

  if (Object.keys(sourceProps).length === 0) {
    syncResult.status = 'error';
    syncResult.errors.push({
      stage: 'fetch_source',
      message: `Could not fetch properties from ${sourceObjectType}. The object may not exist or you don't have permission.`,
      objectType: sourceObjectType
    });
    return syncResult;
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
    syncResult.status = 'no_targets';
    syncResult.warnings.push(`No associated ${targetObjectType} records found for ${sourceObjectType} ${sourceId}`);
    return syncResult;
  }

  let updatedCount = 0;
  const results = [];

  for (const target of targets) {
    const targetId = target.toObjectId || target.id || target.objectId;
    if (!targetId) continue;

    try {
      let targetProps = {};
      if (direction === 'two_way' || skipIfHasValue) {
        const tgtPropNames = effectiveMappings.map(m => m.target);
        try {
          targetProps = await getProperties(client, targetObjectType, targetId, tgtPropNames, portalId);
        } catch (err) {
          // Log but continue - we can still try to update
          console.error(`[Sync] Warning: Could not fetch target properties for ${targetObjectType} ${targetId}`);
          syncResult.warnings.push({
            targetId,
            message: err.message,
            type: err.type
          });
        }
      }

      const propsToUpdate = {};

      for (const mapping of effectiveMappings) {
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

        const updateResult = await updateProperties(client, targetObjectType, targetId, propsToUpdate, portalId);
        
        if (updateResult.success) {
          updatedCount++;
          results.push({ 
            id: targetId, 
            status: 'updated', 
            properties: Object.keys(propsToUpdate) 
          });
          console.log(`[Sync] ✅ Updated ${targetObjectType} ${targetId}:`, Object.keys(propsToUpdate));
        } else {
          results.push({ 
            id: targetId, 
            status: 'error', 
            error: updateResult.error,
            errorType: updateResult.errorType
          });
          syncResult.errors.push({
            stage: 'update_target',
            targetId,
            message: updateResult.error,
            type: updateResult.errorType,
            technicalMessage: updateResult.technicalMessage
          });
        }
      } else {
        results.push({ id: targetId, status: 'skipped' });
      }
    } catch (err) {
      console.error(`[Sync] Failed for target ${targetId}:`, err.message);
      results.push({ 
        id: targetId, 
        status: 'error', 
        error: err.message 
      });
      syncResult.errors.push({
        stage: 'process_target',
        targetId,
        message: err.message
      });
    }
  }

  syncResult.status = updatedCount > 0 ? 'success' : 'no_updates';
  syncResult.updated = updatedCount;
  syncResult.targets = results;
  
  console.log(`[Sync] Complete: ${updatedCount}/${targets.length} updated`);
  
  if (syncResult.errors.length > 0) {
    console.log(`[Sync] Encountered ${syncResult.errors.length} error(s)`);
  }
  if (syncResult.warnings.length > 0) {
    console.log(`[Sync] Encountered ${syncResult.warnings.length} warning(s)`);
  }
  
  return syncResult;
}

// Validation function to check if a sync rule can be created
async function validateSyncRule(client, sourceObjectType, targetObjectType, mappings) {
  const validation = {
    valid: true,
    errors: [],
    warnings: []
  };

  // Test source object access
  try {
    await client.crm.objects.basicApi.getById(sourceObjectType, '1', ['hs_object_id']);
  } catch (err) {
    if (err.response?.status === 403) {
      validation.valid = false;
      const errorInfo = parseApiError(err, sourceObjectType);
      validation.errors.push({
        field: 'sourceObject',
        message: errorInfo.userMessage,
        type: errorInfo.type
      });
    }
  }

  // Test target object access
  try {
    await client.crm.objects.basicApi.getById(targetObjectType, '1', ['hs_object_id']);
  } catch (err) {
    if (err.response?.status === 403) {
      validation.valid = false;
      const errorInfo = parseApiError(err, targetObjectType);
      validation.errors.push({
        field: 'targetObject',
        message: errorInfo.userMessage,
        type: errorInfo.type
      });
    }
  }

  return validation;
}

module.exports = { 
  sync, 
  validateSyncRule,
  ERROR_TYPES,
  isCustomObject
};
