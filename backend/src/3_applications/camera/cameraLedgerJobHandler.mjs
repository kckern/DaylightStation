/**
 * Scheduler handler for the camera detection ledger (Pipeline C).
 *
 * The ledger is an independent, append-only, text-only record of what the
 * cameras detected, kept separately from any video. It exists because the
 * detections are the perishable part of the system: Home Assistant history
 * ages out at ~10 days and the driveway's AI trigger bits at ~14, while the
 * NVR keeps the footage for years but records no detections at all. Every day
 * this does not run is a day of footage that survives but can no longer be
 * classified.
 *
 * Deliberately cheap: no downloads, no ffmpeg, no NAS dependency — a few
 * hundred KB of JSONL per day. That is what makes it safe to schedule ahead of
 * the archiving pipelines.
 *
 * Design: docs/superpowers/specs/2026-07-18-camera-cold-archive-design.md
 *
 * @module 3_applications/camera/cameraLedgerJobHandler
 */

import { buildLedgerRecords } from '#apps/camera/usecases/BuildDetectionLedger.mjs';
import { isCameraJobRuntimeGateway } from './ports/ICameraJobRuntimeGateway.mjs';

/** Local calendar date offset by N days — recordings are searched by local day. */
function localDay(offsetDays = 0, now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() + offsetDays);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Build a scheduler-compatible handler: (logger, executionId) => Promise.
 *
 * @param {Object} deps
 * @param {Object} deps.runtimeGateway - typed camera plan/runtime gateway
 * @param {string} [deps.householdId]
 * @param {Object} [deps.logger]
 * @returns {Function} handler
 */
/**
 * Runtime capabilities arrive through one semantic gateway. Concrete clients,
 * endpoint/auth resolution, and transport-specific factories stay outside the
 * application layer.
 */
export function createCameraLedgerJobHandler({
  runtimeGateway,
  ledgerStore,
  householdId = null,
  logger = console,
}) {
  if (!isCameraJobRuntimeGateway(runtimeGateway)) {
    throw new TypeError('createCameraLedgerJobHandler requires runtimeGateway');
  }
  if (!ledgerStore?.write) throw new TypeError('createCameraLedgerJobHandler requires ledgerStore.write');
  return async function runCameraLedger(scopedLogger, executionId) {
    const log = scopedLogger?.info ? scopedLogger : logger;
    const plan = runtimeGateway.loadLedgerPlan(householdId);

    if (!plan?.cameras?.length) {
      log.warn?.('camera.ledger.skipped', {
        executionId,
        reason: 'camera-archive config missing or has no cameras',
      });
      return { skipped: true };
    }

    // Runtime preparation can fail when the deployment has no usable camera
    // credentials. Preserve the scheduler's historical graceful skip.
    let runtime;
    try {
      runtime = runtimeGateway.createLedgerRuntime({ householdId, logger: log });
    } catch (err) {
      if (err?.code !== 'CAMERA_AUTH_UNAVAILABLE') throw err;
      log.error?.('camera.ledger.no_auth', { executionId, error: err.message });
      return { skipped: true, reason: 'no-auth' };
    }

    // Archive the COMPLETED day. Running for "today" from a nightly job would
    // capture only the hours elapsed so far.
    const day = localDay(plan.dayOffset);
    const ha = runtime.detectionSource;
    if (!ha) log.warn?.('camera.ledger.no_ha', { executionId, impact: 'doorbell will have no labels' });

    const results = [];
    for (const cameraCfg of plan.cameras) {
      try {
        const { camera: cameraSource, nvr: nvrSource } = runtime.createSources(cameraCfg);

        const records = await buildLedgerRecords({
          camera: cameraCfg.id,
          day,
          cameraSource,
          nvrSource,
          haHistory: ha ? await ha.fetchDay(cameraCfg.id, day) : [],
          bitMap: plan.filenameBitsByCamera?.[cameraCfg.id] ?? {},
          parseTriggerBits: runtime.decodeTriggerBits,
        });

        const written = await ledgerStore.write({ records, camera: cameraCfg.id, day });
        log.info?.('camera.ledger.written', {
          executionId,
          camera: cameraCfg.id,
          day,
          records: records.length,
          destinations: written.copies,
        });
        results.push({ camera: cameraCfg.id, day, records: records.length });
      } catch (err) {
        // One unreachable camera must not lose the other camera's day.
        log.error?.('camera.ledger.camera_failed', {
          executionId,
          camera: cameraCfg.id,
          day,
          error: err.message,
        });
        results.push({ camera: cameraCfg.id, day, error: err.message });
      }
    }

    const failed = results.filter((r) => r.error);
    if (failed.length === results.length) {
      throw new Error(`camera ledger failed for all cameras: ${failed.map((f) => f.error).join('; ')}`);
    }
    return { day, results };
  };
}

export default createCameraLedgerJobHandler;
