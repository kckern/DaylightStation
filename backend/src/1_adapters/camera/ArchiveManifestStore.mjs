/**
 * day.json — the per-camera-day archive manifest.
 *
 * Serves two roles: the lookup index for the archive, and the resumption
 * ledger. An interrupted run continues from the first day lacking a complete
 * manifest, and a completed day is never re-fetched — which is what makes a
 * multi-hour backfill safe to kill and restart.
 *
 * @module 1_adapters/camera/ArchiveManifestStore
 */

import { mkdir, writeFile, readFile } from 'fs/promises';
import path from 'path';

export const MANIFEST_VERSION = 1;

export class ArchiveManifestStore {
  #root;
  #logger;

  constructor({ root, logger = console }) {
    if (!root) throw new Error('ArchiveManifestStore requires a root path');
    this.#root = root;
    this.#logger = logger;
  }

  pathFor(camera, day) {
    return path.join(this.#root, camera, day, 'day.json');
  }

  async read(camera, day) {
    try {
      return JSON.parse(await readFile(this.pathFor(camera, day), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      // A corrupt manifest must not read as "already complete" — treat it as
      // absent so the day is redone rather than silently skipped forever.
      this.#logger.warn?.('camera.manifest.unreadable', { camera, day, error: err.message });
      return null;
    }
  }

  async write(camera, day, manifest) {
    const file = this.pathFor(camera, day);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(manifest, null, 2), 'utf8');
    return file;
  }

  /** A day is resumable-complete only if it finished cleanly at this version. */
  isComplete(manifest) {
    return Boolean(manifest && manifest.status === 'complete' && manifest.version === MANIFEST_VERSION);
  }

  /** Marker written before work begins, so a crash is distinguishable from a skip. */
  async markInProgress(camera, day, pipeline) {
    return this.write(camera, day, {
      version: MANIFEST_VERSION,
      camera,
      day,
      pipeline,
      status: 'in-progress',
      startedAt: new Date().toISOString(),
    });
  }

  build({ camera, day, pipeline, sessions, outputs, sun, config, stats }) {
    return {
      version: MANIFEST_VERSION,
      camera,
      day,
      pipeline,
      status: 'complete',
      generatedAt: new Date().toISOString(),
      sun: sun
        ? {
            sunrise: sun.sunrise?.toISOString() ?? null,
            sunset: sun.sunset?.toISOString() ?? null,
            polar: sun.polar ?? null,
          }
        : null,
      // Recorded so a later run can tell what rules produced this day, and
      // re-select without re-downloading if the heuristics change.
      selection: config
        ? {
            budgetMB: config.budget?.fullClipsMB ?? null,
            triggerWeights: config.scoring?.triggerWeights ?? null,
            densityFloorMBPerMin: config.scoring?.densityFloorMBPerMin ?? null,
            maxGapSeconds: config.sessionize?.maxGapSeconds ?? null,
          }
        : null,
      sessions: (sessions ?? []).map((s) => ({
        start: s.start.toISOString(),
        end: s.end.toISOString(),
        durationSec: Math.round(s.durationSec),
        clipCount: s.clips?.length ?? 0,
        sizeBytes: s.sizeBytes,
        densityMBPerMin: Math.round(s.densityMBPerMin * 100) / 100,
        labels: s.labels ?? [],
        classificationSource: s.classificationSource ?? 'none',
        score: s.score != null ? Math.round(s.score) : null,
        selected: Boolean(s.selected),
        reason: s.reason ?? null,
        output: s.output ?? null,
      })),
      outputs: outputs ?? {},
      stats: stats ?? {},
    };
  }
}

export default ArchiveManifestStore;
