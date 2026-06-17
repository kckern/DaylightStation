import os from 'node:os';
import path from 'node:path';
import { Session } from '#domains/fitness/entities/Session.mjs';

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

  async execute({ sessionId, householdId }) {
    const {
      sessionDatastore, snapshotStore, frameMapper, frameRenderer,
      videoEncoder, posterProvider, avatarProvider, resolveName,
      mediaDir, config, fileIO, logger
    } = this.#d;

    const data = await sessionDatastore.findById(sessionId, householdId);
    if (!data) return { status: 'not-found' };
    if (config?.enabled === false) return { status: 'disabled' };

    const session = Session.fromJSON(data);

    const descriptors = frameMapper.buildFrames(data, {
      speedup: config.speedup ?? 10,
      outputFps: config.output_fps ?? 10,
      resolveName: resolveName || null
    });
    if (!descriptors.length) {
      session.markTimelapseSkipped('no-captures');
      await sessionDatastore.save(session, householdId);
      return { status: 'skipped' };
    }

    session.markTimelapseProcessing();
    await sessionDatastore.save(session, householdId);
    logger.info?.('fitness.timelapse.started', { sessionId, frames: descriptors.length });

    const tmpDir = fileIO.mkdtempSync(path.join(os.tmpdir(), `tl-${sessionId}-`));
    try {
      const captures = await snapshotStore.listCaptures(sessionId, householdId);
      const cameraCaps = captures.filter(c => (c.role || 'camera') === 'camera').sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
      const playerByTs = new Map(captures.filter(c => c.role === 'player').map(c => [c.timestamp, c]));
      const avatarBuffers = avatarProvider ? (await avatarProvider(uniqueParticipantIds(descriptors)) || {}) : {};
      const posterCache = new Map();
      const bufCache = new Map(); // absolutePath -> Buffer (many output frames reuse one capture)

      let written = 0;
      for (const d of descriptors) {
        const cam = pickCapture(cameraCaps, d.cameraTimestamp);
        if (!cam) continue;
        const cameraBuffer = await readCached(bufCache, snapshotStore, cam.absolutePath, householdId);
        // Player frame: a realtime UI capture stored just like the camera (role:player).
        let playerBuffer = null;
        const pcap = d.playerTimestamp != null ? playerByTs.get(d.playerTimestamp) : null;
        if (pcap) {
          try { playerBuffer = await readCached(bufCache, snapshotStore, pcap.absolutePath, householdId); }
          catch (err) { logger.warn?.('fitness.timelapse.player_frame_read_failed', { error: err.message }); }
        }
        const posterBuffer = await resolvePoster(d, posterCache, posterProvider, logger);
        const frameBuffer = await frameRenderer.renderFrame({ cameraBuffer, playerBuffer, posterBuffer, avatarBuffers, descriptor: d });
        const name = `frame_${String(written).padStart(5, '0')}.jpg`;
        fileIO.writeFileSync(path.join(tmpDir, name), frameBuffer);
        written++;
      }
      if (!written) throw new Error('no-frames-rendered');

      const fps = config.output_fps ?? 10;
      const slug = buildSlug(data);
      const outDir = path.join(mediaDir, 'video', 'fitness');
      fileIO.mkdirSync(outDir, { recursive: true });
      const outputPath = path.join(outDir, `${slug}.mp4`);
      await videoEncoder.encodeSequence({ framesDir: tmpDir, pattern: 'frame_%05d.jpg', fps, outputPath, crf: config.crf ?? 20 });

      const durationSeconds = Math.round(written / fps);
      const relPath = path.relative(mediaDir, outputPath);
      session.attachTimelapse({ videoPath: `media/${relPath}`, durationSeconds, fps, frameCount: written });
      await sessionDatastore.save(session, householdId);

      await snapshotStore.cleanup(sessionId, householdId, { archive: !!config.archive_frames });
      safeRm(fileIO, tmpDir);
      logger.info?.('fitness.timelapse.ready', { sessionId, videoPath: session.timelapse.videoPath, frames: written });
      return { status: 'ready', ...session.timelapse };
    } catch (err) {
      safeRm(fileIO, tmpDir);
      session.markTimelapseFailed(err);
      await sessionDatastore.save(session, householdId);
      logger.error?.('fitness.timelapse.failed', { sessionId, error: err.message });
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
