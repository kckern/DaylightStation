/**
 * ArchiveCameraDay — Pipeline A: archive one camera-day.
 *
 * Fetches the day's continuous footage once, then derives everything from it:
 *
 *   - contact sheets (event sheets where the ledger has detections, hourly
 *     sheets for the hours that had none)
 *   - full clips for the sessions that win a hard budget cap
 *   - day/night timelapses covering the WHOLE day
 *   - daylight-gated audio sidecars
 *
 * Fetching the whole day rather than only the selected sessions is deliberate.
 * An earlier version downloaded just the budget winners, which meant the
 * timelapse silently covered only those — three sessions out of a hundred — and
 * presented itself as a timelapse of the day. It also made sheets-for-every-
 * session impossible. One day-sized fetch removes both problems.
 *
 * The budget cap is what makes this safe to run unattended for years: a party,
 * a storm, or a stuck floodlight cannot blow the daily allowance.
 *
 * Design: docs/superpowers/specs/2026-07-18-camera-cold-archive-design.md
 *
 * @module 3_applications/camera/usecases/ArchiveCameraDay
 */

import { toClip, sessionize, labelSessions, selectSessions } from '#domains/camera/selection.mjs';
import { sunTimes, phaseAt } from '#domains/camera/sun.mjs';
import { planContactSheets, primaryLabel } from '#domains/camera/sheetPlan.mjs';
import { renderContactSheets } from '#apps/camera/usecases/RenderContactSheets.mjs';

export class ArchiveCameraDay {
  #deps;

  constructor(deps) {
    this.#deps = { logger: console, ...deps };
  }

  async execute({ camera, day, dryRun = false }) {
    const { metaSource, manifestStore, readLedger, policy, logger } = this.#deps;

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
    const sessions = labelSessions(sessionize(clips, policy.sessionize), ledger, {
      toleranceSeconds: policy.matchToleranceSeconds,
    });

    const plan = selectSessions(sessions, {
      ...policy.scoring,
      budgetMB: policy.fullClipsBudgetMB,
      compressionRatio: policy.compressionRatio,
    });
    const sun = sunTimes(day, policy.sun.latitude, policy.sun.longitude);

    logger.info?.('camera.archive.planned', {
      camera: camera.id,
      day,
      sessions: sessions.length,
      selected: plan.selected.length,
      projectedMB: Math.round(plan.projectedMB),
      budgetMB: plan.budgetMB,
      ledgerRecords: ledger.length,
    });

    if (dryRun) return { camera: camera.id, day, plan, sun, sessions, dryRun: true };

    await manifestStore.markInProgress(camera.id, day, 'A');
    const outputs = await this.#materialize({ camera, day, plan, sessions, sun, ledger });

    const manifest = manifestStore.build({
      camera: camera.id,
      day,
      pipeline: 'A',
      sessions: [...plan.selected, ...plan.rejected],
      outputs,
      sun,
      config: policy,
      stats: { projectedMB: Math.round(plan.projectedMB), clipCount: clips.length },
    });
    await manifestStore.write(camera.id, day, manifest);

    logger.info?.('camera.archive.complete', {
      camera: camera.id,
      day,
      clips: outputs.sessions.length,
      sheets: outputs.sheets.length,
      timelapse: Object.keys(outputs.timelapse),
    });
    return { camera: camera.id, day, outputs };
  }

  async #materialize({ camera, day, plan, sessions, sun, ledger }) {
    const { footageSource, encoder, policy, archiveArtifacts, sheetArtifacts, logger } = this.#deps;
    const dayArtifacts = await archiveArtifacts.beginDay(camera.id, day);

    const outputs = { sessions: [], sheets: [], timelapse: {}, audio: [] };

    // --- fetch the day, once -------------------------------------------------
    const segments = (await footageSource.search(day)).map((r) => toClip(r, { date: day }));
    const local = [];
    for (const [i, seg] of segments.entries()) {
      const segPath = archiveArtifacts.segment(dayArtifacts, i);
      await footageSource.fetch({ clip: seg, start: seg.start, end: seg.end, destPath: segPath });
      local.push({ start: seg.start, end: seg.end, path: segPath });
      logger.debug?.('camera.archive.segment', { camera: camera.id, day, n: i + 1, of: segments.length });
    }

    // --- contact sheets ------------------------------------------------------
    if (policy.contactSheets?.enabled !== false) {
      const sheetPlan = planContactSheets(sessions, day, {
        maxSpanMs: (policy.contactSheets?.maxSpanMinutes ?? 60) * 60_000,
      });
      const profile = {
        ...(policy.contactSheets ?? {}),
        ...(policy.contactSheets?.byCamera?.[camera.id] ?? {}),
      };
      const res = await renderContactSheets({
        segments: local,
        plan: sheetPlan,
        camera: camera.id,
        outDir: archiveArtifacts.sheetCollection(dayArtifacts),
        encoder,
        detections: ledger,
        profile,
        provenance: {
          pipeline: 'A',
          source: policy.provenance.source,
          channel: camera.nvrChannel,
          streamType: policy.provenance.streamType,
        },
        sheetArtifacts,
        logger,
      });
      outputs.sheets = res.written;
    }

    // --- selected session clips ---------------------------------------------
    for (const [i, session] of plan.selected.entries()) {
      const label = primaryLabel(session.labels);
      const output = archiveArtifacts.sessionClip(dayArtifacts, { index: i, time: hhmm(session.start), label });
      const cut = await this.#cutSpan({ local, start: session.start, end: session.end, outPath: output.locator, dayArtifacts, i });
      if (!cut) continue;
      session.output = output.name;
      outputs.sessions.push(session.output);
    }

    // --- audio sidecars, daylight-gated -------------------------------------
    const active = policy.activeAudioHours;
    for (const seg of local) {
      const h = seg.start.getHours();
      if (active && (h < active.start || h >= active.end)) continue;
      const output = archiveArtifacts.audioSidecar(dayArtifacts, { time: hhmm(seg.start), container: policy.audioEncoding.container });
      await encoder.extractAudio({
        inputPath: seg.path,
        outPath: output.locator,
        profile: policy.audioEncoding,
      });
      outputs.audio.push(output.name);
    }

    // --- timelapses, over the WHOLE day -------------------------------------
    const phaseFiles = { day: [], night: [] };
    for (const seg of local) {
      phaseFiles[phaseAt(seg.start, sun, policy.sun.offsetMinutes)].push(seg.path);
    }
    for (const [phase, profile] of Object.entries(policy.timelapse.phases)) {
      if (!profile.enabled || !phaseFiles[phase]?.length) continue;
      const output = archiveArtifacts.timelapse(dayArtifacts, phase);
      await encoder.encodeTimelapse({
        files: phaseFiles[phase],
        outPath: output.locator,
        profile: { ...profile, videoCodec: policy.timelapse.videoCodec },
      });
      outputs.timelapse[phase] = output.name;
    }

    if (policy.discardSourceAfterExtract) {
      await archiveArtifacts.discard(dayArtifacts).catch((err) =>
        logger.warn?.('camera.archive.cleanup_failed', { camera: camera.id, day, error: err.message }),
      );
    }
    return outputs;
  }

  /**
   * Cut a wall-clock span out of the downloaded segments.
   *
   * A session usually sits inside one segment; when it straddles a boundary the
   * overlapping segments are concatenated first, so a clip is never silently
   * truncated at an arbitrary hour mark.
   */
  async #cutSpan({ local, start, end, outPath, dayArtifacts, i }) {
    const { encoder, policy, archiveArtifacts, logger } = this.#deps;
    const overlapping = local.filter((s) => s.start < end && s.end > start);
    if (!overlapping.length) {
      logger.warn?.('camera.archive.session_no_footage', { at: start.toISOString() });
      return null;
    }

    const seekSeconds = Math.max(0, (start - overlapping[0].start) / 1000);
    const durationSeconds = Math.max(1, (end - start) / 1000);

    try {
      await encoder.encodeSession({
        files: overlapping.map((s) => s.path),
        outPath,
        profile: policy.fullClipEncoding,
        seekSeconds,
        durationSeconds,
        listPath: archiveArtifacts.concatManifest(dayArtifacts, i),
      });
      return outPath;
    } catch (err) {
      logger.warn?.('camera.archive.session_failed', { at: start.toISOString(), error: err.message });
      return null;
    }
  }
}

function hhmm(date) {
  return `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
}

export default ArchiveCameraDay;
