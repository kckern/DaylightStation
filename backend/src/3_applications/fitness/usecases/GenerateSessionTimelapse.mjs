import os from 'node:os';
import path from 'node:path';
import { Session } from '#domains/fitness/entities/Session.mjs';
import { evaluateRecapReadiness, SESSION_RESUME_MERGE_WINDOW_MS } from '../sessionConsolidationPolicy.mjs';

/**
 * Use case: render a session's silent time-lapse recap.
 *
 * Orchestrates pure domain mapping + rendering with adapter-backed I/O (snapshot
 * store, ffmpeg frame extraction + encoding, content/poster/avatar resolution).
 * Status transitions go through the Session aggregate root; adapter failures mark
 * the session failed without deleting the raw frames (so a manual re-run can retry).
 */
export class GenerateSessionTimelapse {
  #d;
  constructor(deps) { this.#d = deps; }

  async execute({ sessionId, householdId, force = false }) {
    const {
      sessionDatastore, snapshotStore, frameMapper, frameRenderer,
      videoEncoder, posterProvider, avatarProvider, resolveName, resolveColor,
      mediaDir, config, fileIO, logger
    } = this.#d;

    const startedAt = Date.now();
    logger.info?.('fitness.timelapse.requested', { sessionId, householdId: householdId || null });

    const data = await sessionDatastore.findById(sessionId, householdId);
    if (!data) {
      logger.warn?.('fitness.timelapse.not_found', { sessionId, householdId: householdId || null });
      return { status: 'not-found' };
    }
    if (config?.enabled === false) {
      logger.info?.('fitness.timelapse.disabled', { sessionId });
      return { status: 'disabled' };
    }

    const session = Session.fromJSON(data);

    // Idempotency guard (critical for the recap-sweep + multi-instance safety).
    // A `ready` recap has already deleted its raw frames (cleanup), so a re-run
    // would render zero frames and flip a good recap to `failed`. A `processing`
    // recap is in flight on another path. Skip both unless explicitly forced
    // (the manual re-gen endpoint passes force:true). `failed`/`skipped` are NOT
    // skipped — their frames survive, so an automatic retry is safe and wanted.
    const priorStatus = session.timelapse?.status || null;
    if (!force && (priorStatus === 'ready' || priorStatus === 'processing')) {
      logger.info?.('fitness.timelapse.already', { sessionId, status: priorStatus });
      return { status: 'already', priorStatus };
    }

    // Don't jump the gun on an unsettled session. Rendering deletes the raw
    // captures (cleanup, below), so a recap generated while the session could
    // still be resumed/merged would destroy the frames the consolidated session
    // needs. Defer using the SAME window findResumable/mergeSessions assume:
    // render only once finalized (a clean split) or past the resume/merge window.
    // A re-trigger after the session settles (or an explicit end) will succeed.
    const readiness = evaluateRecapReadiness({ finalized: session.finalized, endTime: session.endTime });
    if (!readiness.settled) {
      logger.info?.('fitness.timelapse.deferred', {
        sessionId, reason: readiness.reason, msSinceEnd: readiness.msSinceEnd,
        windowMs: SESSION_RESUME_MERGE_WINDOW_MS
      });
      return { status: 'deferred', reason: readiness.reason };
    }

    const speedup = config.speedup ?? 10;
    const fps = config.output_fps ?? 10;
    const allCaptures = data?.snapshots?.captures || [];
    const cameraCount = allCaptures.filter(c => (c.role || 'camera') === 'camera').length;
    const playerCount = allCaptures.filter(c => c.role === 'player').length;

    const descriptors = frameMapper.buildFrames(data, { speedup, outputFps: fps, resolveName: resolveName || null, resolveColor: resolveColor || null });
    if (!descriptors.length) {
      session.markTimelapseSkipped('no-captures');
      await sessionDatastore.save(session, householdId);
      // The single most likely "why is there no recap?" cause — make it loud.
      logger.warn?.('fitness.timelapse.skipped', {
        sessionId, reason: 'no-captures', cameraCaptures: cameraCount, playerCaptures: playerCount
      });
      return { status: 'skipped' };
    }

    session.markTimelapseProcessing();
    await sessionDatastore.save(session, householdId);
    logger.info?.('fitness.timelapse.started', {
      sessionId, speedup, fps, frames: descriptors.length,
      cameraCaptures: cameraCount, playerCaptures: playerCount,
      durationMs: session.getDurationMs?.() ?? null
    });

    let stage = 'init';
    const tmpDir = fileIO.mkdtempSync(path.join(os.tmpdir(), `tl-${sessionId}-`));
    try {
      stage = 'gather-captures';
      const captures = await snapshotStore.listCaptures(sessionId, householdId);
      const cameraCaps = captures.filter(c => (c.role || 'camera') === 'camera').sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
      const playerByTs = new Map(captures.filter(c => c.role === 'player').map(c => [c.timestamp, c]));

      stage = 'avatars';
      const avatarBuffers = avatarProvider ? (await avatarProvider(uniqueParticipantIds(descriptors)) || {}) : {};
      const posterCache = new Map();
      const bufCache = new Map(); // absolutePath -> Buffer (many output frames reuse one capture)

      stage = 'render';
      let written = 0;
      let playerFramesUsed = 0;
      let cameraMissing = 0;
      let posterUsed = false;
      for (const d of descriptors) {
        const cam = pickCapture(cameraCaps, d.cameraTimestamp);
        if (!cam) { cameraMissing++; continue; }
        const cameraBuffer = await readCached(bufCache, snapshotStore, cam.absolutePath, householdId);
        // Player frame: a realtime UI capture stored just like the camera (role:player).
        let playerBuffer = null;
        const pcap = d.playerTimestamp != null ? playerByTs.get(d.playerTimestamp) : null;
        if (pcap) {
          try { playerBuffer = await readCached(bufCache, snapshotStore, pcap.absolutePath, householdId); playerFramesUsed++; }
          catch (err) { logger.warn?.('fitness.timelapse.player_frame_read_failed', { sessionId, error: err.message }); }
        }
        const posterBuffer = await resolvePoster(d, posterCache, posterProvider, logger);
        if (posterBuffer) posterUsed = true;
        const frameBuffer = await frameRenderer.renderFrame({ cameraBuffer, playerBuffer, posterBuffer, avatarBuffers, descriptor: d });
        const name = `frame_${String(written).padStart(5, '0')}.jpg`;
        fileIO.writeFileSync(path.join(tmpDir, name), frameBuffer);
        written++;
      }
      if (!written) throw new Error('no-frames-rendered');
      logger.info?.('fitness.timelapse.frames_rendered', {
        sessionId, written, requested: descriptors.length, cameraMissing,
        playerFramesUsed, playerCoveragePct: Math.round((playerFramesUsed / written) * 100),
        avatars: Object.keys(avatarBuffers).length, posterUsed, renderMs: Date.now() - startedAt
      });

      stage = 'encode';
      const slug = buildSlug(data);
      const outDir = path.join(mediaDir, 'video', 'fitness');
      fileIO.mkdirSync(outDir, { recursive: true });
      const outputPath = path.join(outDir, `${slug}.mp4`);
      const encodeStart = Date.now();
      await videoEncoder.encodeSequence({ framesDir: tmpDir, pattern: 'frame_%05d.jpg', fps, outputPath, crf: config.crf ?? 20 });
      const encodeMs = Date.now() - encodeStart;

      stage = 'persist';
      const durationSeconds = Math.round(written / fps);
      const relPath = path.relative(mediaDir, outputPath);
      let sizeBytes = null;
      try { sizeBytes = fileIO.statSync(outputPath)?.size ?? null; } catch { /* best-effort */ }
      session.attachTimelapse({ videoPath: `media/${relPath}`, durationSeconds, fps, frameCount: written });
      await sessionDatastore.save(session, householdId);

      stage = 'cleanup';
      await snapshotStore.cleanup(sessionId, householdId, { archive: !!config.archive_frames });
      safeRm(fileIO, tmpDir);
      logger.info?.('fitness.timelapse.ready', {
        sessionId, videoPath: session.timelapse.videoPath, frames: written,
        durationSeconds, fps, sizeBytes, encodeMs, totalMs: Date.now() - startedAt,
        archivedFrames: !!config.archive_frames
      });
      return { status: 'ready', ...session.timelapse };
    } catch (err) {
      safeRm(fileIO, tmpDir);
      session.markTimelapseFailed(err);
      await sessionDatastore.save(session, householdId);
      logger.error?.('fitness.timelapse.failed', {
        sessionId, stage, error: err.message, code: err.code || null, totalMs: Date.now() - startedAt
      });
      return { status: 'failed', error: err.message };
    }
  }
}

async function readCached(cache, store, absolutePath, householdId) {
  if (!cache.has(absolutePath)) cache.set(absolutePath, await store.readCapture(absolutePath, householdId));
  return cache.get(absolutePath);
}

async function resolvePoster(d, cache, provider, logger) {
  if (!provider || !d.playerContentId) return null;
  const key = d.showTitle || d.playerContentId;
  try {
    if (!cache.has(key)) cache.set(key, await provider(d.playerContentId, d.showTitle));
    return cache.get(key) || null;
  } catch (err) {
    logger.warn?.('fitness.timelapse.poster_failed', { contentId: d.playerContentId, error: err.message });
    return null;
  }
}

function uniqueParticipantIds(descriptors) {
  const s = new Set();
  descriptors.forEach(d => (d.participants || []).forEach(p => s.add(p.id)));
  return [...s];
}
function pickCapture(sorted, ts) {
  if (!sorted.length) return null;
  if (ts == null) return sorted[0];
  let best = sorted[0], bestD = Math.abs((sorted[0].timestamp ?? 0) - ts);
  for (const c of sorted) {
    const d = Math.abs((c.timestamp ?? 0) - ts);
    if (d < bestD) { best = c; bestD = d; }
  }
  return best;
}
function buildSlug(data) {
  const title = data?.summary?.media?.[0]?.showTitle
    || data?.summary?.media?.[0]?.title
    || data?.strava?.name
    || 'workout';
  const date = String(data.sessionId || '').slice(0, 8);
  const clean = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${date}_${data.sessionId}_${clean || 'workout'}`;
}
function safeRm(fileIO, dir) {
  try { fileIO.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}
