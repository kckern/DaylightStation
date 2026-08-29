/**
 * Scheduler handler for the camera archive (Pipeline A).
 *
 * Runs nightly for the completed previous day: selects that day's activity
 * sessions against a hard budget cap, encodes the winners with audio, and
 * renders separate day/night timelapses.
 *
 * Depends on the detection ledger (Pipeline C) having run — without ledger
 * records every session is unlabelled and selection falls back to duration and
 * bitrate density alone. That is why `camera-ledger` is scheduled earlier in
 * the night; the dependency is ordering, not a hard requirement.
 *
 * Design: docs/superpowers/specs/2026-07-18-camera-cold-archive-design.md
 *
 * @module 3_applications/camera/cameraArchiveJobHandler
 */

import { ArchiveCameraDay } from '#apps/camera/usecases/ArchiveCameraDay.mjs';
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
 * @param {Object} deps
 * @param {Object} deps.runtimeGateway
 * @param {string} [deps.householdId]
 * @param {Object} [deps.logger]
 * @returns {Function} (logger, executionId) => Promise
 */
/** Runtime capabilities arrive through one semantic gateway. */
export function createCameraArchiveJobHandler({
  runtimeGateway, ledgerStore, householdId = null, logger = console,
}) {
  if (!isCameraJobRuntimeGateway(runtimeGateway)) {
    throw new TypeError('createCameraArchiveJobHandler requires runtimeGateway');
  }
  if (!ledgerStore?.read) throw new TypeError('createCameraArchiveJobHandler requires ledgerStore.read');
  return async function runCameraArchive(scopedLogger, executionId) {
    const log = scopedLogger?.info ? scopedLogger : logger;
    const plan = runtimeGateway.loadArchivePlan(householdId);

    if (!plan?.cameras?.length) {
      log.warn?.('camera.archive.skipped', { executionId, reason: 'config missing or no cameras' });
      return { skipped: true };
    }
    if (!plan.enabled) {
      log.info?.('camera.archive.disabled', { executionId });
      return { skipped: true, reason: 'disabled' };
    }

    // Runtime preparation can fail when the deployment has no usable camera
    // credentials. Preserve the scheduler's historical graceful skip.
    let runtime;
    try {
      runtime = runtimeGateway.createArchiveRuntime({ householdId, logger: log });
    } catch (err) {
      if (err?.code !== 'CAMERA_AUTH_UNAVAILABLE') throw err;
      log.error?.('camera.archive.no_auth', { executionId, error: err.message });
      return { skipped: true, reason: 'no-auth' };
    }

    const day = localDay(plan.dayOffset);
    const results = [];
    for (const cameraCfg of plan.cameras) {
      try {
        const sources = runtime.createSources(cameraCfg);

        const { footage: footageSource, metadata: metaSource } = sources;
        if (!footageSource) throw new Error('No footage source configured');

        const useCase = new ArchiveCameraDay({
          metaSource,
          footageSource,
          encoder: runtime.encoder,
          manifestStore: runtime.manifestStore,
          readLedger: (camera, d) => ledgerStore.read({ camera, day: d }),
          policy: plan.policy,
          archiveArtifacts: runtime.archiveArtifacts,
          sheetArtifacts: runtime.sheetArtifacts,
          logger: log,
        });

        results.push(await useCase.execute({ camera: cameraCfg, day }));
      } catch (err) {
        // One camera's failure must not cost the other camera its day.
        log.error?.('camera.archive.camera_failed', {
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
      throw new Error(`camera archive failed for all cameras: ${failed.map((f) => f.error).join('; ')}`);
    }
    return { day, results };
  };
}

export default createCameraArchiveJobHandler;
