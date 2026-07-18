/**
 * ffmpeg wrappers: session clips, day/night timelapses, audio sidecars.
 *
 * Every encoder setting arrives from config — nothing here hardcodes a CRF,
 * scale, or sampling rate. `extraArgs` on each profile is a deliberate escape
 * hatch so ffmpeg tuning never requires a code change.
 */

import { spawn } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

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
export async function encodeSession({ files, outPath, profile, logger }) {
  const listPath = outPath + '.concat.txt';
  await writeConcatList(files, listPath);

  const args = ['-f', 'concat', '-safe', '0', '-i', listPath];

  args.push('-c:v', profile.videoCodec ?? 'libx264');
  if (profile.crf != null) args.push('-crf', String(profile.crf));
  if (profile.preset) args.push('-preset', profile.preset);

  const filters = [];
  if (profile.scale) filters.push(`scale=${profile.scale.replace('x', ':')}`);
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
export async function encodeTimelapse({ files, outPath, profile, logger }) {
  if (!files.length) return null;
  const listPath = outPath + '.concat.txt';
  await writeConcatList(files, listPath);

  const vf = [`select='not(mod(n\\,${profile.sampleEveryNthFrame ?? 30}))'`];
  if (profile.scale) vf.push(`scale=${profile.scale.replace('x', ':')}`);
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
