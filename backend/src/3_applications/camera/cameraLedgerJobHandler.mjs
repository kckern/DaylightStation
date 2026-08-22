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

import { buildLedgerRecords, writeLedger } from '#apps/camera/usecases/BuildDetectionLedger.mjs';
import { resolveCameraEndpoint } from './cameraArchiveJobHandler.mjs';

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
 * @param {Object} deps.configService - reads camera-archive config + auth
 * @param {string} [deps.householdId]
 * @param {Object} [deps.logger]
 * @returns {Function} handler
 */
/**
 * Camera adapters arrive as an INJECTED bundle, not imports (Decision D1:
 * a handler never imports a concrete adapter, no exceptions). A client is
 * built per camera at run time, so the factories are what get injected.
 */
export function createCameraLedgerJobHandler({
  configService,
  cameraAdapters,
  haGateway = null,
  householdId = null,
  logger = console,
}) {
  const { ReolinkClient, makeSource, createHaDetectionSource, parseTriggerBits } = cameraAdapters || {};
  if (!ReolinkClient || !makeSource || !createHaDetectionSource || !parseTriggerBits) {
    throw new Error('createCameraLedgerJobHandler requires cameraAdapters '
      + '{ ReolinkClient, makeSource, createHaDetectionSource, parseTriggerBits }');
  }
  return async function runCameraLedger(scopedLogger, executionId) {
    const log = scopedLogger?.info ? scopedLogger : logger;
    const config = configService.getHouseholdAppConfig(householdId, 'camera-archive');

    if (!config?.cameras?.length) {
      log.warn?.('camera.ledger.skipped', {
        executionId,
        reason: 'camera-archive config missing or has no cameras',
      });
      return { skipped: true };
    }

    // Host + credentials come from devices.yml (see cameraArchiveJobHandler.mjs
    // resolveCameraEndpoint) — archive.yml no longer restates them.
    const { authRef } = resolveCameraEndpoint(configService, 'camera-nvr', householdId);
    const auth = configService.getHouseholdAuth(authRef, householdId);
    if (!auth?.username || !auth?.password) {
      log.error?.('camera.ledger.no_auth', { executionId, ref: authRef });
      return { skipped: true, reason: 'no-auth' };
    }

    // Archive the COMPLETED day. Running for "today" from a nightly job would
    // capture only the hours elapsed so far.
    const day = localDay(config.ledger?.dayOffset ?? -1);
    const destinations = config.storage.ledgerPaths;
    const streamType = config.sources?.streamType ?? 'sub';

    // HA is the PRIMARY classifier and the only label source for the doorbell.
    // Its absence is worth shouting about, but must not stop the run — the
    // filename bits and density timeline still produce a usable ledger.
    const ha = haGateway
      ? createHaDetectionSource({
          haGateway,
          sensorsByCamera: config.classification?.sensorsByCamera ?? {},
          logger: log,
        })
      : null;
    if (!ha) log.warn?.('camera.ledger.no_ha', { executionId, impact: 'doorbell will have no labels' });

    const results = [];
    for (const cameraCfg of config.cameras) {
      try {
        const { host: cameraHost } = resolveCameraEndpoint(
          configService, cameraCfg.id, householdId,
        );
        const cameraSource = makeSource({
          kind: 'camera',
          client: new ReolinkClient({ host: cameraHost, ...auth, logger: log }),
          channel: 0,
          streamType,
        });
        const { host: nvrHost } = resolveCameraEndpoint(
          configService, 'camera-nvr', householdId,
        );
        const nvrSource = makeSource({
          kind: 'nvr',
          client: new ReolinkClient({ host: nvrHost, ...auth, logger: log }),
          channel: cameraCfg.nvrChannel,
          streamType,
        });

        const records = await buildLedgerRecords({
          camera: cameraCfg.id,
          day,
          cameraSource,
          nvrSource,
          haHistory: ha ? await ha.fetchDay(cameraCfg.id, day) : [],
          bitMap: config.classification?.filenameBits?.[cameraCfg.id] ?? {},
          parseTriggerBits,
        });

        const written = await writeLedger({ records, camera: cameraCfg.id, day, destinations });
        log.info?.('camera.ledger.written', {
          executionId,
          camera: cameraCfg.id,
          day,
          records: records.length,
          destinations: written.length,
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
