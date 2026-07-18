/**
 * ffmpeg wrappers: session clips, day/night timelapses, audio sidecars.
 *
 * Every encoder setting arrives from config — nothing here hardcodes a CRF,
 * scale, or sampling rate. `extraArgs` on each profile is a deliberate escape
 * hatch so ffmpeg tuning never requires a code change.
 *
 * Exposed both as free functions (used by the backfill CLI) and as an
 * injectable `ArchiveEncoder` class (used by the scheduled job), so there is
 * one implementation behind both entry points.
 *
 * @module 1_adapters/camera/ArchiveEncoder
 */

import { spawn } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

import { localEpochSeconds, exifTimestamp } from '#domains/camera/sheetPlan.mjs';

export function runFfmpeg(args, { logger = console, timeoutMs = 3600000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`ffmpeg timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      logger.error?.('ffmpeg.failed', { code, stderr: stderr.slice(-2000) });
      reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/**
 * Build a scale filter that never distorts the image.
 *
 * A plain `scale=W:H` forces exact dimensions. That silently squashes sources
 * whose aspect ratio differs from the target — and the driveway is a dual-lens
 * panoramic at 1536x432 (3.55:1), nothing like a 16:9 box. `decrease` fits the
 * frame inside the box instead, preserving geometry; `-2` keeps dimensions
 * even, which h264 requires.
 *
 * @param {string} scale - "WxH"
 */
export function scaleFilter(scale) {
  const [w, h] = String(scale).split('x').map(Number);
  if (!w || !h) throw new Error(`Invalid scale "${scale}" (expected WxH, e.g. 1280x720)`);
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`;
}

/** Write an ffmpeg concat demuxer list. Paths are single-quote escaped. */
export async function writeConcatList(files, listPath) {
  const body = files.map((f) => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`).join('\n');
  await mkdir(path.dirname(listPath), { recursive: true });
  await writeFile(listPath, body + '\n', 'utf8');
  return listPath;
}

/**
 * Concatenate a session's clips into one output.
 *
 * Audio defaults to stream-copy: the source is already AAC 16 kHz mono 31 kbps,
 * so re-encoding would stack a second lossy codec on an already-lossy source
 * for negligible savings — and distant outdoor speech is exactly where that
 * hurts later transcription most.
 *
 * KNOWN RISK: concatenating AAC across clip boundaries can leave timestamp
 * discontinuities where the camera's recordings butt together. If that shows
 * up in practice, set audioCodec to 'aac' to force a single clean re-encode at
 * the session level.
 */
export async function encodeSession({
  files, outPath, profile, logger,
  seekSeconds = 0, durationSeconds = null, listPath: listPathOpt = null,
}) {
  // Keep the concat list out of the output directory: it is scratch, and a
  // stray .concat.txt sitting next to the archived clips looks like an artifact
  // of the archive rather than of the build.
  const listPath = listPathOpt ?? outPath + '.concat.txt';
  await writeConcatList(files, listPath);

  const args = [
    '-f', 'concat', '-safe', '0',
    ...(seekSeconds > 0 ? ['-ss', String(seekSeconds)] : []),
    '-i', listPath,
    ...(durationSeconds ? ['-t', String(durationSeconds)] : []),
  ];

  args.push('-c:v', profile.videoCodec ?? 'libx264');
  if (profile.crf != null) args.push('-crf', String(profile.crf));
  if (profile.preset) args.push('-preset', profile.preset);

  const filters = [];
  if (profile.scale) filters.push(scaleFilter(profile.scale));
  if (profile.fps) args.push('-r', String(profile.fps));
  if (filters.length) args.push('-vf', filters.join(','));

  if (profile.audioCodec === 'copy') {
    args.push('-c:a', 'copy');
  } else if (profile.audioCodec === 'opus') {
    args.push('-c:a', 'libopus', '-b:a', `${profile.opusBitrateKbps ?? 16}k`, '-ac', '1');
  } else {
    args.push('-c:a', profile.audioCodec ?? 'aac');
  }

  args.push(...(profile.extraArgs ?? []), outPath);
  await runFfmpeg(args, { logger });
  return outPath;
}

/**
 * Build a timelapse for one lighting phase.
 *
 * Day and night are separate FILES, not segments of one file: a single video
 * stream cannot change resolution mid-way, and forcing a uniform resolution
 * would either waste bits on darkness or starve the daytime footage. Separate
 * files also mean the day reel — the one anyone actually watches — is not
 * padded with hours of black frames.
 */
export async function encodeTimelapse({ files, outPath, profile, logger, listPath: listPathOpt = null }) {
  if (!files.length) return null;
  const listPath = listPathOpt ?? outPath + '.concat.txt';
  await writeConcatList(files, listPath);

  const vf = [`select='not(mod(n\\,${profile.sampleEveryNthFrame ?? 30}))'`];
  if (profile.scale) vf.push(scaleFilter(profile.scale));
  vf.push(`setpts=N/${profile.outputFps ?? 30}/TB`);

  const args = [
    '-f', 'concat', '-safe', '0', '-i', listPath,
    '-an',                                   // timelapse audio is meaningless
    '-vf', vf.join(','),
    '-r', String(profile.outputFps ?? 30),
    '-c:v', profile.videoCodec ?? 'libx264',
    '-crf', String(profile.crf ?? 30),
    ...(profile.preset ? ['-preset', profile.preset] : []),
    ...(profile.extraArgs ?? []),
    outPath,
  ];
  await runFfmpeg(args, { logger });
  return outPath;
}

/**
 * Extract audio only, defaulting to stream-copy (zero CPU, zero generation
 * loss). This is what makes "keep as much audio as possible" affordable.
 */
export async function extractAudio({ inputPath, outPath, profile, logger }) {
  const args = ['-i', inputPath, '-vn'];

  // An audio filter cannot be applied to a copied stream — filtering requires
  // decode/encode. Asking for both is a config error worth failing loudly on
  // rather than silently dropping one of them.
  if (profile.silenceRemove && profile.audioCodec === 'copy') {
    throw new Error(
      'audio.silenceRemove requires re-encoding; set audioCodec to "opus" (or "aac") or disable silenceRemove',
    );
  }

  if (profile.audioCodec === 'opus') {
    args.push('-c:a', 'libopus', '-b:a', `${profile.opusBitrateKbps ?? 16}k`, '-ac', '1');
  } else if (profile.audioCodec && profile.audioCodec !== 'copy') {
    args.push('-c:a', profile.audioCodec);
  } else {
    args.push('-c:a', 'copy');
  }

  if (profile.silenceRemove) {
    // Off by default: trimming risks clipping the onset of speech, which is
    // precisely what this tier exists to preserve.
    args.push('-af', 'silenceremove=start_periods=1:stop_periods=-1:stop_duration=2:stop_threshold=-50dB');
  }

  args.push(...(profile.extraArgs ?? []), outPath);
  await runFfmpeg(args, { logger });
  return outPath;
}

/**
 * Injectable façade over the functions above — binds a logger once so callers
 * do not thread it through every call.
 */
export class ArchiveEncoder {
  #logger;

  constructor({ logger = console } = {}) {
    this.#logger = logger;
  }

  encodeSession(args) {
    return encodeSession({ ...args, logger: this.#logger });
  }

  encodeTimelapse(args) {
    return encodeTimelapse({ ...args, logger: this.#logger });
  }

  extractAudio(args) {
    return extractAudio({ ...args, logger: this.#logger });
  }

  encodeContactSheet(args) {
    return encodeContactSheet({ ...args, logger: this.#logger });
  }

  writeSheetMetadata(args) {
    return writeSheetMetadata({ ...args, logger: this.#logger });
  }
}

export default ArchiveEncoder;

/**
 * Render a contact sheet: a grid of frames sampled across a time span.
 *
 * Purpose is at-a-glance scanning without scrubbing video. The sample rate is
 * supplied by the caller (see sampleRateFor) so it adapts to the span — a 30s
 * doorbell ring gets ~1 fps, a full hour gets 1 per 100s. A fixed rate would
 * make short events invisible.
 *
 * Timestamps are burned into each tile. Without them a sheet tells you that
 * something happened but not when, which makes it useless for finding the
 * moment in the underlying footage.
 *
 * @param {Object} args
 * @param {string} args.inputPath
 * @param {string} args.outPath
 * @param {number} args.fps - frames per second to sample (fractional)
 * @param {Date} [args.spanStart] - wall-clock time of the first frame, for labels
 * @param {Object} args.profile - { grid, tileWidth, quality, drawTimestamp, extraArgs }
 */
export async function encodeContactSheet({
  inputPath, outPath, fps, spanStart, profile, logger,
  seekSeconds = 0, durationSeconds = null,
}) {
  const grid = profile.grid ?? '6x6';
  const [cols, rows] = grid.split('x').map(Number);
  if (!cols || !rows) throw new Error(`Invalid contact sheet grid "${grid}" (expected e.g. 6x6)`);

  const tileWidth = profile.tileWidth ?? 320;
  const filters = [`fps=${fps}`, `scale=${tileWidth}:-2`];

  if (profile.drawTimestamp !== false && spanStart) {
    // gmtime against a LOCAL-shifted epoch, deliberately not ffmpeg's
    // `localtime`: that reads the TZ env var of whatever process runs it, and a
    // sheet whose burned-in clock is silently 7 hours off is easy to cause and
    // hard to notice. localEpochSeconds bakes the offset in.
    const epoch = localEpochSeconds(spanStart);
    const size = Math.max(10, Math.round(tileWidth / 18));
    filters.push(
      `drawtext=text='%{pts\\:gmtime\\:${epoch}\\:%H\\\\\\:%M\\\\\\:%S}'` +
        `:x=4:y=4:fontsize=${size}:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=3`,
    );
  }

  filters.push(`tile=${cols}x${rows}:margin=${profile.margin ?? 4}:padding=${profile.padding ?? 2}`);

  const args = [
    // -ss before -i seeks by keyframe (fast); accurate enough for a contact
    // sheet, where a second either way does not matter.
    ...(seekSeconds > 0 ? ['-ss', String(seekSeconds)] : []),
    '-i', inputPath,
    ...(durationSeconds ? ['-t', String(durationSeconds)] : []),
    '-vf', filters.join(','),
    '-frames:v', '1',
    '-q:v', String(profile.quality ?? 3),
    ...(profile.extraArgs ?? []),
    outPath,
  ];
  await runFfmpeg(args, { logger });
  return outPath;
}

/**
 * Embed forensic metadata into a rendered sheet via exiftool.
 *
 * Writes DateTimeOriginal (local), a one-line ImageDescription, and the full
 * YAML block as UserComment. EXIF UserComment holds arbitrary text up to the
 * ~64KB APP1 limit, which is ample for a span's detection records.
 *
 * Degrades gracefully: exiftool is not present in every environment (it is on
 * this host but not yet in the container image), and a sheet without metadata
 * is still a useful sheet. Never fail the archive over it.
 *
 * @returns {Promise<boolean>} whether metadata was written
 */
export async function writeSheetMetadata({ filePath, dateTaken, description, yaml, logger = console }) {
  const args = [
    '-overwrite_original',
    `-DateTimeOriginal=${exifTimestamp(dateTaken)}`,
    `-CreateDate=${exifTimestamp(dateTaken)}`,
    '-Software=DaylightStation camera-archive',
  ];
  if (description) args.push(`-ImageDescription=${description}`);
  if (yaml) args.push(`-UserComment=${yaml}`);
  args.push(filePath);

  try {
    await new Promise((resolve, reject) => {
      const proc = spawn('exiftool', args);
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`exiftool exited ${code}: ${stderr.slice(-200)}`)),
      );
    });
    return true;
  } catch (err) {
    logger.warn?.('camera.sheet.metadata_failed', {
      file: path.basename(filePath),
      error: err.message,
      hint: err.code === 'ENOENT' ? 'exiftool not installed' : undefined,
    });
    return false;
  }
}
