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

import { ReolinkClient, makeSource } from '#adapters/camera/ReolinkRecordingAdapter.mjs';
import { ArchiveEncoder } from '#adapters/camera/ArchiveEncoder.mjs';
import { ArchiveManifestStore } from '#adapters/camera/ArchiveManifestStore.mjs';
import { ArchiveCameraDay } from '#apps/camera/usecases/ArchiveCameraDay.mjs';
import { readLedger } from '#apps/camera/usecases/BuildDetectionLedger.mjs';

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
 * @param {Object} deps.configService
 * @param {string} [deps.householdId]
 * @param {Object} [deps.logger]
 * @returns {Function} (logger, executionId) => Promise
 */
export function createCameraArchiveJobHandler({ configService, householdId = null, logger = console }) {
  return async function runCameraArchive(scopedLogger, executionId) {
    const log = scopedLogger?.info ? scopedLogger : logger;
    const config = configService.getHouseholdAppConfig(householdId, 'camera-archive');

    if (!config?.cameras?.length) {
      log.warn?.('camera.archive.skipped', { executionId, reason: 'config missing or no cameras' });
      return { skipped: true };
    }
    if (config.archive?.enabled === false) {
      log.info?.('camera.archive.disabled', { executionId });
      return { skipped: true, reason: 'disabled' };
    }

    const auth = configService.getHouseholdAuth(config.auth?.ref ?? 'reolink', householdId);
    if (!auth?.username || !auth?.password) {
      log.error?.('camera.archive.no_auth', { executionId });
      return { skipped: true, reason: 'no-auth' };
    }

    const day = localDay(config.archive?.dayOffset ?? -1);
    const streamType = config.sources?.streamType ?? 'sub';
    const encoder = new ArchiveEncoder({ logger: log });
    const manifestStore = new ArchiveManifestStore({ root: config.storage.hotPath, logger: log });
    const ledgerRoot = config.storage.ledgerPaths[0];

    const results = [];
    for (const cameraCfg of config.cameras) {
      try {
        const sources = {
          camera: makeSource({
            kind: 'camera',
            client: new ReolinkClient({ host: cameraCfg.host, ...auth, logger: log }),
            channel: 0,
            streamType,
          }),
          nvr: config.nvr?.host
            ? makeSource({
                kind: 'nvr',
                client: new ReolinkClient({ host: config.nvr.host, ...auth, logger: log }),
                channel: cameraCfg.nvrChannel,
                streamType,
              })
            : null,
        };

        const footageSource = sources[config.sources?.footageFrom ?? 'nvr'];
        const metaSource = sources[config.sources?.metadataFrom ?? 'camera'];
        if (!footageSource) throw new Error(`No footage source configured (${config.sources?.footageFrom})`);

        const useCase = new ArchiveCameraDay({
          metaSource,
          footageSource,
          encoder,
          manifestStore,
          readLedger: (camera, d) => readLedger(ledgerRoot, camera, d),
          config,
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
