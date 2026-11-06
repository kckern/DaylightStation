/**
 * FfmpegRefineMedia - deterministic media access for content-filter refinement.
 *
 * Reads a local path or an HTTP(S) URL (range seeks) with ffmpeg/ffprobe.
 * Produces frames, audio windows and shot cuts. Judges nothing.
 *
 * Frame accuracy: every frame grab decodes from a seek point before the
 * target and reports the pts of each frame it returns, so callers can check
 * they got the frame they asked for (see `frameIndexOfPts`).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { createTempDir, deleteDir, readBinaryFromPath, readDirectory } from '#system/utils/FileIO.mjs';
import { tmpdir } from 'os';
import path from 'path';

const run = promisify(execFile);

/** ffmpeg input options that survive dropped HTTP range reads (no-op for local files). */
function net(src) {
  return /^https?:/i.test(String(src))
    ? ['-reconnect', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '5', '-rw_timeout', '30000000']
    : [];
}
const MAX_BUFFER = 512 * 1024 * 1024;

export class FfmpegRefineMedia {
  /**
   * @param {{ ffmpeg?: string, ffprobe?: string, tmpRoot?: string }} [opts]
   */
  constructor({ ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', tmpRoot = tmpdir() } = {}) {
    this.ffmpeg = ffmpeg;
    this.ffprobe = ffprobe;
    this.tmpRoot = tmpRoot;
  }

  /** Stream facts needed for frame <-> time conversion. */
  async probe(src) {
    const { stdout } = await run(this.ffprobe, [
      '-v', 'error', '-show_entries',
      'stream=index,codec_type,r_frame_rate,avg_frame_rate,start_time,width,height,nb_frames,duration:format=duration',
      '-of', 'json', src,
    ], { maxBuffer: MAX_BUFFER });
    const j = JSON.parse(stdout);
    const v = (j.streams || []).find((s) => s.codec_type === 'video');
    const a = (j.streams || []).find((s) => s.codec_type === 'audio');
    if (!v) throw new Error(`no video stream in ${redact(src)}`);
    const variable = v.r_frame_rate !== v.avg_frame_rate;
    return {
      fps: v.r_frame_rate,
      avgFps: v.avg_frame_rate,
      variableFrameRate: variable,
      startTime: Number(v.start_time) || 0,
      audioStartTime: a ? Number(a.start_time) || 0 : null,
      width: v.width,
      height: v.height,
      frames: Number(v.nb_frames) || null,
      duration: Number(j.format?.duration) || Number(v.duration) || null,
    };
  }

  /**
   * Decode `count` consecutive frames starting with the frame whose pts is
   * `fromPts`. Returns PNG buffers with each frame's pts.
   * @param {string} src
   * @param {number} fromPts - pts of the first wanted frame (use timebase.frameStart)
   * @param {number} count
   * @param {{ width?: number, preroll?: number }} [opts] - width scales the output; preroll seeks earlier and decodes forward
   * @returns {Promise<Array<{ pts: number, png: Buffer }>>}
   */
  async frames(src, fromPts, count, { width = 640, preroll = 3 } = {}) {
    const dir = await createTempDir(path.join(this.tmpRoot, 'refine-frames-'));
    try {
      const seek = Math.max(0, fromPts - preroll);
      // Fast-seek to `seek`, then select frames from fromPts (1 ms tolerance;
      // frames are >= 16 ms apart). Keep
      // timestamps absolute (copyts) so pts compare with the probe's timeline.
      const vf = [
        `select='gte(t\\,${(fromPts - 0.001).toFixed(6)})'`,
        'showinfo',
        width ? `scale=${width}:-2:flags=bicubic` : null,
      ].filter(Boolean).join(',');
      const { stderr } = await run(this.ffmpeg, [
        '-hide_banner', '-nostdin', '-copyts', ...net(src), '-ss', seek.toFixed(6), '-i', src,
        '-map', '0:v:0', '-vf', vf, '-fps_mode', 'passthrough', '-frames:v', String(count),
        path.join(dir, 'f%05d.png'),
      ], { maxBuffer: MAX_BUFFER });
      const pts = parseShowinfoPts(stderr);
      const files = readDirectory(dir).filter((f) => f.endsWith('.png')).sort();
      return files.map((f, i) => ({ pts: pts[i] ?? null, png: readBinaryFromPath(path.join(dir, f)) }));
    } finally {
      deleteDir(dir);
    }
  }

  /** Mono float PCM for [t0, t1) of the first audio stream, on the media timeline. */
  async audio(src, t0, t1, { sampleRate = 16000 } = {}) {
    const start = Math.max(0, t0);
    const { stdout } = await run(this.ffmpeg, [
      '-hide_banner', '-nostdin', '-v', 'error', ...net(src), '-ss', start.toFixed(6), '-i', src,
      '-t', (t1 - start).toFixed(6), '-map', '0:a:0', '-ac', '1', '-ar', String(sampleRate),
      '-f', 'f32le', 'pipe:1',
    ], { encoding: 'buffer', maxBuffer: MAX_BUFFER });
    const samples = new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4));
    return { t0: start, sampleRate, samples: Float32Array.from(samples) };
  }

  /**
   * Shot cuts in [t0, t1): pts of the first frame of each new shot.
   * @returns {Promise<Array<{ pts: number, score: number }>>}
   */
  async shotCuts(src, t0, t1, { threshold = 0.3 } = {}) {
    const start = Math.max(0, t0);
    const { stderr } = await run(this.ffmpeg, [
      '-hide_banner', '-nostdin', '-copyts', ...net(src), '-ss', start.toFixed(6), '-t', (t1 - start).toFixed(6), '-i', src,
      '-map', '0:v:0', '-vf', `scale=320:-2,select='gt(scene\\,${threshold})',metadata=print`, '-an', '-f', 'null', '-',
    ], { maxBuffer: MAX_BUFFER });
    return parseSceneCuts(stderr);
  }

  /** Black intervals in [t0, t1). */
  async blackIntervals(src, t0, t1, { minDur = 0.08, pixTh = 0.1 } = {}) {
    const start = Math.max(0, t0);
    const { stderr } = await run(this.ffmpeg, [
      '-hide_banner', '-nostdin', '-copyts', ...net(src), '-ss', start.toFixed(6), '-t', (t1 - start).toFixed(6), '-i', src,
      '-map', '0:v:0', '-vf', `scale=320:-2,blackdetect=d=${minDur}:pix_th=${pixTh}`, '-an', '-f', 'null', '-',
    ], { maxBuffer: MAX_BUFFER });
    return [...stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)].map((m) => ({ start: Number(m[1]), end: Number(m[2]) }));
  }
}

/** pts_time values from ffmpeg showinfo lines, in output order. */
export function parseShowinfoPts(stderr) {
  return [...String(stderr).matchAll(/Parsed_showinfo.*?pts_time:\s*([-\d.]+)/g)].map((m) => Number(m[1]));
}

/** Scene cuts from `metadata=print` output following a scene `select`. */
export function parseSceneCuts(stderr) {
  const out = [];
  let pts = null;
  for (const line of String(stderr).split('\n')) {
    const p = line.match(/pts_time:([-\d.]+)/);
    if (p) pts = Number(p[1]);
    const s = line.match(/lavfi\.scene_score=([\d.]+)/);
    if (s && pts != null) { out.push({ pts, score: Number(s[1]) }); pts = null; }
  }
  return out;
}

function redact(src) {
  return String(src).replace(/([?&](X-Plex-Token|token)=)[^&]+/gi, '$1…');
}

export default FfmpegRefineMedia;
