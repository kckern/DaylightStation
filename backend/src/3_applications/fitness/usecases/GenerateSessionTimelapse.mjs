import { Session } from '#domains/fitness/entities/Session.mjs';
import { reconstituteSession } from '../sessionRecords.mjs';
import { evaluateRecapReadiness, SESSION_RESUME_MERGE_WINDOW_MS } from '../sessionConsolidationPolicy.mjs';
import { buildSlug, buildPlexMeta, participantSlug, durationMinutes } from '#domains/fitness/services/recapNaming.mjs';

// Re-exported for callers/tests that imported these from the use case.
export { buildSlug, participantSlug, durationMinutes };

// A 'processing' status left behind by a container restart / crash mid-render
// never gets an endTime and would otherwise stick forever (idempotency guard
// below would skip it on every future trigger). Anything older than this is
// treated as abandoned and re-rendered rather than skipped.
const STALE_PROCESSING_MS = 30 * 60 * 1000;

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
      posterProvider, avatarProvider, equipmentProvider,
      resolveName, resolveColor, resolveGroupLabel, cadenceDevices, cadenceColors,
      artifactStore, config, logger
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

    const session = reconstituteSession(data);

    // Idempotency guard (critical for the recap-sweep + multi-instance safety).
    // A `ready` recap has already deleted its raw frames (cleanup), so a re-run
    // would render zero frames and flip a good recap to `failed`. A `processing`
    // recap is in flight on another path. Skip both unless explicitly forced
    // (the manual re-gen endpoint passes force:true). `failed`/`skipped` are NOT
    // skipped — their frames survive, so an automatic retry is safe and wanted.
    const priorStatus = session.timelapse?.status || null;
    if (!force && priorStatus === 'processing') {
      const startedAt = session.timelapse?.startedAt ?? null;
      const ageMs = startedAt != null ? Date.now() - startedAt : Infinity;
      if (ageMs < STALE_PROCESSING_MS) {
        logger.info?.('fitness.timelapse.already', { sessionId, status: priorStatus });
        return { status: 'already', priorStatus };
      }
      // Abandoned in-flight render (e.g. container restart mid-encode) — fall
      // through and re-render instead of leaving the session stuck forever.
      logger.warn?.('fitness.timelapse.stale_reprocess', { sessionId, ageMs });
    } else if (!force && priorStatus === 'ready') {
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

    const descriptors = frameMapper.buildFrames(data, {
      speedup, outputFps: fps,
      resolveName: resolveName || null, resolveColor: resolveColor || null,
      resolveGroupLabel: resolveGroupLabel || null,
      cadenceDevices: cadenceDevices || null, cadenceColors: cadenceColors || null
    });
    if (!descriptors.length) {
      session.markTimelapseSkipped('no-captures', Date.now());
      await sessionDatastore.save(session, householdId);
      // The single most likely "why is there no recap?" cause — make it loud.
      logger.warn?.('fitness.timelapse.skipped', {
        sessionId, reason: 'no-captures', cameraCaptures: cameraCount, playerCaptures: playerCount
      });
      return { status: 'skipped' };
    }

    session.markTimelapseProcessing(Date.now());
    await sessionDatastore.save(session, householdId);
    logger.info?.('fitness.timelapse.started', {
      sessionId, speedup, fps, frames: descriptors.length,
      cameraCaptures: cameraCount, playerCaptures: playerCount,
      durationMs: session.getDurationMs?.() ?? null
    });

    let stage = 'init';
    const workspace = await artifactStore.createWorkspace(sessionId);
    try {
      stage = 'gather-captures';
      const captures = await snapshotStore.listCaptures(sessionId, householdId);
      const cameraCaps = captures.filter(c => (c.role || 'camera') === 'camera').sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
      const playerByTs = new Map(captures.filter(c => c.role === 'player').map(c => [c.timestamp, c]));

      stage = 'avatars';
      const avatarBuffers = avatarProvider ? (await avatarProvider(uniqueParticipantIds(descriptors)) || {}) : {};
      const equipmentBuffers = equipmentProvider ? (await equipmentProvider(uniqueEquipment(descriptors)) || {}) : {};
      const posterCache = new Map();
      const captureCache = new Map(); // captureId -> opaque image artifact

      stage = 'render';
      let written = 0;
      let playerFramesUsed = 0;
      let cameraMissing = 0;
      let posterUsed = false;
      for (const d of descriptors) {
        const cam = pickCapture(cameraCaps, d.cameraTimestamp);
        if (!cam) { cameraMissing++; continue; }
        const cameraBuffer = await readCached(captureCache, snapshotStore, cam.captureId);
        // Player frame: a realtime UI capture stored just like the camera (role:player).
        let playerBuffer = null;
        const pcap = d.playerTimestamp != null ? playerByTs.get(d.playerTimestamp) : null;
        if (pcap) {
          try { playerBuffer = await readCached(captureCache, snapshotStore, pcap.captureId); playerFramesUsed++; }
          catch (err) { logger.warn?.('fitness.timelapse.player_frame_read_failed', { sessionId, error: err.message }); }
        }
        const posterBuffer = await resolvePoster(d, posterCache, posterProvider, logger);
        if (posterBuffer) posterUsed = true;
        const frameBuffer = await frameRenderer.renderFrame({ cameraBuffer, playerBuffer, posterBuffer, avatarBuffers, equipmentBuffers, descriptor: d });
        await artifactStore.writeFrame(workspace, { index: written, bytes: frameBuffer });
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
      const plexMeta = buildPlexMeta(data, { resolveName: resolveName || null });
      const encodeStart = Date.now();
      const encoded = await artifactStore.encode(workspace, {
        slug, fps,
        crf: config.crf ?? 26,
        ...(config.preset ? { preset: config.preset } : {}),
        metadata: plexMeta.tags
      });
      const encodeMs = Date.now() - encodeStart;

      stage = 'persist';
      const durationSeconds = Math.round(written / fps);
      const { artifact, videoPath, sizeBytes } = encoded;
      // Confirm the MP4 actually landed BEFORE we touch the source frames. If the
      // encode silently produced nothing, fail here — the catch leaves the captures
      // untouched (it only removes the temp dir), so a re-run can retry instead of
      // destroying the only copy of the screenshots.
      if (!(Number(sizeBytes) > 0)) throw new Error('mp4-not-written');
      session.attachTimelapse({ videoPath, durationSeconds, fps, frameCount: written, now: Date.now() });
      await sessionDatastore.save(session, householdId);

      // Plex-library copy: a TV-convention hardlink (`Family Fitness - SxxExx - …`)
      // in a `plex/` subfolder so a Plex TV library ingests recaps as episodes,
      // while the slug file stays the human-readable source of truth. Best-effort —
      // a link failure must never fail the recap (the slug MP4 already landed).
      stage = 'plex-link';
      try {
        const plexPath = await artifactStore.publishPlexCopy(artifact, { plexFileBase: plexMeta.plexFileBase });
        logger.info?.('fitness.timelapse.plex_linked', { sessionId, plexPath });
      } catch (err) {
        logger.warn?.('fitness.timelapse.plex_link_failed', { sessionId, error: err.message });
      }

      stage = 'cleanup';
      // Default to ARCHIVING the source frames (screenshots -> screenshots_archive)
      // so a recap can always be regenerated later; set `archive_frames: false` to
      // hard-delete (saves disk, but the recap can never be re-rendered).
      const archiveFrames = config.archive_frames !== false;
      await snapshotStore.cleanup(sessionId, householdId, { archive: archiveFrames });
      await artifactStore.discardWorkspace(workspace);
      logger.info?.('fitness.timelapse.ready', {
        sessionId, videoPath: session.timelapse.videoPath, frames: written,
        durationSeconds, fps, sizeBytes, encodeMs, totalMs: Date.now() - startedAt,
        archivedFrames: archiveFrames
      });
      return { status: 'ready', ...session.timelapse };
    } catch (err) {
      await artifactStore.discardWorkspace(workspace);
      session.markTimelapseFailed(err, Date.now());
      await sessionDatastore.save(session, householdId);
      logger.error?.('fitness.timelapse.failed', {
        sessionId, stage, error: err.message, code: err.code || null, totalMs: Date.now() - startedAt
      });
      return { status: 'failed', error: err.message };
    }
  }
}

async function readCached(cache, store, captureId) {
  if (!cache.has(captureId)) cache.set(captureId, await store.readCapture(captureId));
  return cache.get(captureId);
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
function uniqueEquipment(descriptors) {
  const s = new Set();
  descriptors.forEach(d => (d.cadence || []).forEach(c => { if (c.equipment) s.add(c.equipment); }));
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
