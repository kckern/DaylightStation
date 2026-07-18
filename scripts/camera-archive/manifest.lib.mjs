/**
 * day.json — the per-camera-day manifest.
 *
 * This is both the lookup index for the archive and the resumption ledger: an
 * interrupted overnight run continues from the first day lacking a complete
 * manifest, and a completed day is never re-fetched.
 */

import { mkdir, writeFile, readFile } from 'fs/promises';
import path from 'path';

export const MANIFEST_VERSION = 1;

export function manifestPath(root, camera, day) {
  return path.join(root, camera, day, 'day.json');
}

export async function readManifest(root, camera, day) {
  try {
    return JSON.parse(await readFile(manifestPath(root, camera, day), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeManifest(root, camera, day, manifest) {
  const file = manifestPath(root, camera, day);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(manifest, null, 2), 'utf8');
  return file;
}

/** A day is resumable-complete only if it finished cleanly at this version. */
export function isComplete(manifest) {
  return Boolean(manifest && manifest.status === 'complete' && manifest.version === MANIFEST_VERSION);
}

export function buildManifest({ camera, day, pipeline, sessions, outputs, sun, config, stats }) {
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
    // Recorded so a future run can tell what rules produced this day, and
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
      output: s.output ?? null,
    })),
    outputs: outputs ?? {},
    stats: stats ?? {},
  };
}

/** Marker written before work begins so a crash is distinguishable from a skip. */
export async function markInProgress(root, camera, day, pipeline) {
  return writeManifest(root, camera, day, {
    version: MANIFEST_VERSION,
    camera,
    day,
    pipeline,
    status: 'in-progress',
    startedAt: new Date().toISOString(),
  });
}
