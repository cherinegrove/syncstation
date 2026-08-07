// src/services/syncNowService.js
// Manual "Sync Now" backfill for a single rule, triggered on demand from the
// settings UI. Reuses pollingService's exact fetch/pacing/logging logic (same
// rate-limit safety, same per-record client refresh) but ignores the
// last-sync-time cutoff so it processes every currently-matching record, not
// just recent changes.
//
// Jobs are tracked in memory only — this is a manual, occasional, one-off
// action, not critical background infrastructure, so losing in-flight
// progress on a deploy/restart is an acceptable tradeoff for the simplicity
// of not needing a DB-backed job table. The user can just click it again.
const { getClient } = require('./hubspotClient');
const { sync } = require('./syncService');
const { getPortalTier, isObjectAllowed } = require('./tierService');
const {
  getChangedRecords,
  getMappedFieldsForObjectType,
  logSyncResult,
  markPollingWrite
} = require('./pollingService');

const jobs = new Map(); // `${portalId}:${ruleId}` -> job state

const RECORD_DELAY_MS = 800;   // same pacing as pollingService's DELAY_BETWEEN_SYNCS
const BATCH_DELAY_MS  = 3000;  // same pacing as pollingService's DELAY_BETWEEN_BATCHES
const EPOCH = '1970-01-01T00:00:00.000Z'; // "since" cutoff that matches every record

function jobKey(portalId, ruleId) {
  return `${portalId}:${ruleId}`;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getStatus(portalId, ruleId) {
  return jobs.get(jobKey(portalId, ruleId)) || { status: 'idle' };
}

// Backfills one direction of a rule (source→target, or target→source for the
// reverse leg of a two-way rule) against every record of objectType.
async function backfillDirection(portalId, rule, objectType, job) {
  let client = await getClient(portalId);
  const mappedFields = getMappedFieldsForObjectType([rule], objectType);
  const records = await getChangedRecords(client, objectType, EPOCH, mappedFields);

  job.total += records.length;

  for (const record of records) {
    let sourceObjectType = rule.sourceObject;
    let targetObjectType = rule.targetObject;
    if (rule.direction === 'two_way' && rule.targetObject === objectType) {
      sourceObjectType = rule.targetObject;
      targetObjectType = rule.sourceObject;
    }

    try {
      // Refresh right before use — same fix as pollingService, in case this
      // backfill runs long enough to outlive the token fetched at the start
      client = await getClient(portalId);

      const result = await sync(client, {
        portalId,
        sourceObjectType,
        sourceId: record.id,
        targetObjectType,
        direction: rule.direction,
        mappings: rule.mappings,
        skipIfHasValue: rule.skipIfHasValue === 'true',
        associationRule: rule.assocRule || 'all',
        associationLabel: rule.assocLabel || '',
        onWrite: markPollingWrite,
        ruleSourceObject: rule.sourceObject,
        ruleTargetObject: rule.targetObject
      });

      if (result.status === 'success') {
        job.synced += result.updated;
        if (result.targets?.length) {
          for (const target of result.targets) {
            if (target.status === 'updated') {
              await logSyncResult(portalId, objectType, rule.name, 'success', null, 1, record.id, target.id, 'manual');
            }
          }
        }
      }
      if (result.errors?.length) {
        job.errors += result.errors.length;
        for (const error of result.errors) {
          await logSyncResult(portalId, objectType, rule.name, 'error', error.message, 0, record.id, null, 'manual');
        }
      }
    } catch (err) {
      job.errors++;
      await logSyncResult(portalId, objectType, rule.name, 'error', err.message, 0, record.id, null, 'manual');
    }

    job.processed++;
    await delay(RECORD_DELAY_MS);
    await delay(BATCH_DELAY_MS);
  }
}

async function runJob(portalId, rule, job) {
  try {
    const tierInfo = await getPortalTier(portalId);
    if (!tierInfo.canSync) {
      job.status = 'error';
      job.message = `Your ${tierInfo.tier} plan can't sync right now${tierInfo.isExpired ? ' (trial expired)' : ''} — upgrade to run this.`;
      job.finishedAt = Date.now();
      return;
    }
    if (!isObjectAllowed(tierInfo.tier, rule.sourceObject) || !isObjectAllowed(tierInfo.tier, rule.targetObject)) {
      job.status = 'error';
      job.message = `Your ${tierInfo.tier} plan doesn't include ${rule.sourceObject} → ${rule.targetObject} syncs.`;
      job.finishedAt = Date.now();
      return;
    }

    await backfillDirection(portalId, rule, rule.sourceObject, job);
    if (rule.direction === 'two_way') {
      await backfillDirection(portalId, rule, rule.targetObject, job);
    }

    job.status = 'complete';
    job.finishedAt = Date.now();
  } catch (err) {
    console.error(`[SyncNow] Job failed for portal ${portalId} rule ${rule.id}:`, err.message);
    job.status = 'error';
    job.message = err.message;
    job.finishedAt = Date.now();
  }
}

function startSyncNow(portalId, rule) {
  const key = jobKey(portalId, rule.id);
  const existing = jobs.get(key);
  if (existing && existing.status === 'running') {
    return { alreadyRunning: true };
  }

  const job = {
    status: 'running',
    total: 0,
    processed: 0,
    synced: 0,
    errors: 0,
    message: null,
    startedAt: Date.now(),
    finishedAt: null
  };
  jobs.set(key, job);

  runJob(portalId, rule, job); // fire-and-forget — progress is polled via getStatus

  return { started: true };
}

module.exports = { startSyncNow, getStatus };
