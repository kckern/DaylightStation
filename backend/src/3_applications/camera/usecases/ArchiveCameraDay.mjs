/**
 * ArchiveCameraDay — Pipeline A: archive one camera-day.
 *
 * Selects the day's activity sessions against a hard budget cap, encodes the
 * winners at watchable quality with audio, and renders separate day/night
 * timelapses. Everything not selected still appears in the timelapse.
 *
 * The budget cap is what makes this safe to run unattended for years: a party,
 * a storm, or a stuck floodlight cannot blow the daily allowance.
 *
 * Dependencies are injected so the whole use case is testable without a
 * camera, an NVR, or ffmpeg.
 *
 * Design: docs/superpowers/specs/2026-07-18-camera-cold-archive-design.md
 *
 * @module 3_applications/camera/usecases/ArchiveCameraDay
 */

import path from 'path';
import { mkdir, rm } from 'fs/promises';

import { toClip, sessionize, labelSessions, selectSessions } from '#domains/camera/selection.mjs';
import { sunTimes, phaseAt } from '#domains/camera/sun.mjs';

/**
 * @param {Object} deps
 * @param {Object} deps.metaSource   - source carrying trigger names (camera)
 * @param {Object} deps.footageSource- source carrying the bytes (NVR)
 * @param {Object} deps.encoder      - ArchiveEncoder
 * @param {Object} deps.manifestStore- ArchiveManifestStore
 * @param {Function} deps.readLedger - (camera, day) => Promise<records[]>
 * @param {Object} deps.config
 * @param {Object} [deps.logger]
 */
export class ArchiveCameraDay {
  #deps;

  constructor(deps) {
    this.#deps = { logger: console, ...deps };
  }

  /**
   * @param {{ camera: object, day: string, dryRun?: boolean }} params
   */
  async execute({ camera, day, dryRun = false }) {
    const { metaSource, footageSource, manifestStore, readLedger, config, logger } = this.#deps;

    const existing = await manifestStore.read(camera.id, day);
    if (manifestStore.isComplete(existing) && !dryRun) {
      logger.info?.('camera.archive.skipped', { camera: camera.id, day, reason: 'already-complete' });
      return { camera: camera.id, day, skipped: true };
    }

    const clips = (await metaSource.search(day)).map((r) => toClip(r, { date: day }));
    if (!clips.length) {
      logger.warn?.('camera.archive.no_recordings', { camera: camera.id, day });
      return { camera: camera.id, day, skipped: true, reason: 'no-recordings' };
    }

    const ledger = await readLedger(camera.id, day);
    const sessions = labelSessions(sessionize(clips, config.sessionize), ledger, {
      toleranceSeconds: config.classification?.matchToleranceSeconds ?? 15,
    });

    const plan = selectSessions(sessions, {
      ...config.scoring,
      budgetMB: config.budget.fullClipsMB,
      compressionRatio: config.budget.compressionRatio,
    });

    const sun = sunTimes(day, config.sun.latitude, config.sun.longitude);

    logger.info?.('camera.archive.planned', {
      camera: camera.id,
      day,
      sessions: sessions.length,
      selected: plan.selected.length,
      projectedMB: Math.round(plan.projectedMB),
      budgetMB: plan.budgetMB,
      ledgerRecords: ledger.length,
    });

    if (dryRun) return { camera: camera.id, day, plan, sun, dryRun: true };

    await manifestStore.markInProgress(camera.id, day, 'A');
    const outputs = await this.#materialize({ camera, day, plan, sun, footageSource });

    const manifest = manifestStore.build({
      camera: camera.id,
      day,
      pipeline: 'A',
      sessions: [...plan.selected, ...plan.rejected],
      outputs,
      sun,
      config,
      stats: { projectedMB: Math.round(plan.projectedMB), clipCount: clips.length },
    });
    await manifestStore.write(camera.id, day, manifest);

    logger.info?.('camera.archive.complete', {
      camera: camera.id,
      day,
      clips: outputs.sessions.length,
      timelapse: Object.keys(outputs.timelapse),
    });
    return { camera: camera.id, day, outputs };
  }

  /**
   * Fetch, encode, and write outputs.
   *
   * Source segments are deleted once consumed so peak local disk stays near one
   * segment rather than the whole day.
   */
  async #materialize({ camera, day, plan, sun, footageSource }) {
    const { encoder, config, logger } = this.#deps;

    const workDir = path.join(config.storage.workDir, camera.id, day);
    const outDir = path.join(config.storage.hotPath, camera.id, day);
    await mkdir(workDir, { recursive: true });
    await mkdir(path.join(outDir, 'audio'), { recursive: true });

    const outputs = { sessions: [], timelapse: {}, audio: [] };
    const phaseFiles = { day: [], night: [] };

    for (const [i, session] of plan.selected.entries()) {
      const localPath = path.join(workDir, `session-${i}.mp4`);
      await footageSource.fetch({
        clip: session.clips[0],
        start: session.start,
        end: session.end,
        destPath: localPath,
      });

      const label = (session.labels[0] ?? 'motion').replace(/[^a-z0-9]/gi, '');
      const stamp = hhmm(session.start);
      const outPath = path.join(outDir, `s${String(i + 1).padStart(2, '0')}-${stamp}-${label}.mp4`);

      await encoder.encodeSession({ files: [localPath], outPath, profile: config.encoding.fullClip });
      session.output = path.basename(outPath);
      outputs.sessions.push(session.output);

      phaseFiles[phaseAt(session.start, sun, config.sun.offsetMinutes)].push(localPath);
    }

    for (const [phase, profile] of Object.entries(config.timelapse.phases)) {
      if (!profile.enabled || !phaseFiles[phase]?.length) continue;
      const outPath = path.join(outDir, `timelapse-${phase}.mp4`);
      await encoder.encodeTimelapse({
        files: phaseFiles[phase],
        outPath,
        profile: { ...profile, videoCodec: config.timelapse.videoCodec },
      });
      outputs.timelapse[phase] = path.basename(outPath);
    }

    if (config.sources.deleteSourceAfterExtract) {
      await rm(workDir, { recursive: true, force: true }).catch((err) =>
        logger.warn?.('camera.archive.cleanup_failed', { camera: camera.id, day, error: err.message }),
      );
    }
    return outputs;
  }
}

function hhmm(date) {
  return `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
}

export default ArchiveCameraDay;
