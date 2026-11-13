/**
 * The low-res picture copy refine reads frames from (CachedRefineMedia.ProxiedRefineMedia).
 * Picture only, a keyframe every second, no B-frames, every frame kept at its own timestamp: a
 * frame grab seeks at most a second and decodes a few small frames instead of up to ~30 s of
 * 1080p. Measured on Terminator 2 (2026-11-12): the copy has the original's 197,294 frames and
 * the same frame at every time checked. Built once per part and file size into a cache folder that
 * outlives the worker's per-run stage (CONTENT_FILTER_PROXY_DIR).
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

export const PROXY_HEIGHT = 480;

export function proxyFileName({ partId, size = null, height = PROXY_HEIGHT }) {
  return `${partId}-${size ?? 'x'}-${height}p.mkv`;
}

export function proxyArgs(src, out, { height = PROXY_HEIGHT } = {}) {
  return [
    '-hide_banner', '-nostdin', '-v', 'error', '-y', '-i', src,
    '-map', '0:v:0', '-an', '-vf', `scale=-2:${height}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
    '-force_key_frames', 'expr:gte(t,n_forced*1)', '-sc_threshold', '0', '-bf', '0',
    '-fps_mode', 'passthrough', '-f', 'matroska', out,
  ];
}

const execFileP = promisify(execFile);
const defaultRun = (args) => execFileP('nice', ['-n', '10', 'ffmpeg', ...args], { maxBuffer: 16 * 1024 * 1024 });

/**
 * The cached copy's path, building it first when missing. Rejects when the build fails (the
 * caller reads the original instead); a failed build leaves no file behind. One builder per copy:
 * an exclusive lock file; anyone else waits for the copy (review 2026-11-12: two writers of one
 * partial file published a corrupt copy). A lock older than `staleMs` is a crashed build's.
 * @param {{ src: string, dir: string, partId: string, size?: number|null, height?: number,
 *   run?: (args: string[]) => Promise<unknown>, pollMs?: number, staleMs?: number }} p
 */
export async function ensureVideoProxy({ src, dir, partId, size = null, height = PROXY_HEIGHT, run = defaultRun, pollMs = 5000, staleMs = 3 * 3600e3 }) {
  const out = path.join(dir, proxyFileName({ partId, size, height }));
  const lock = `${out}.lock`;
  mkdirSync(dir, { recursive: true });
  for (;;) {
    if (existsSync(out)) { touch(out); return out; }
    let fd = null;
    try { fd = openSync(lock, 'wx'); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (fd == null) {
      // Someone is building it: wait, unless their lock is a crashed build's.
      let age = 0;
      try { age = Date.now() - statSync(lock).mtimeMs; } catch { continue; }
      if (age >= staleMs) { rmSync(lock, { force: true }); continue; }
      await new Promise((r) => setTimeout(r, pollMs));
      continue;
    }
    closeSync(fd);
    const partial = `${out}.${process.pid}.partial`;
    try {
      await run(proxyArgs(src, partial, { height }));
      renameSync(partial, out);
      return out;
    } catch (e) {
      rmSync(partial, { force: true });
      throw e;
    } finally {
      rmSync(lock, { force: true });
    }
  }
}

function touch(file) { try { const t = new Date(); utimesSync(file, t, t); } catch { /* read-only cache: fine */ } }

/**
 * Does the copy match its original, and by how much are its times shifted? The copy is built
 * without -copyts (an input -ss on a file that does not start at 0 seeks wrong), so it starts at
 * 0; `offset` = the original's start minus the copy's, for ProxiedRefineMedia. A copy at another
 * frame rate, more than a second shorter or longer, or with another frame count is refused and
 * refine reads the original (review 2026-11-12).
 * @returns {{ ok: true, offset: number } | { ok: false, reason: 'fps'|'duration'|'frames' }}
 */
export function proxyFit({ original, proxy }) {
  if (String(original.fps) !== String(proxy.fps)) return { ok: false, reason: 'fps' };
  const offset = Math.round(((original.startTime || 0) - (proxy.startTime || 0)) * 1e6) / 1e6;
  // Containers disagree on whether a duration counts from 0 or from the start time: accept either.
  if (original.duration != null && proxy.duration != null
    && Math.abs(original.duration - proxy.duration) > 1 && Math.abs(original.duration - offset - proxy.duration) > 1) return { ok: false, reason: 'duration' };
  if (original.frames && proxy.frames && original.frames !== proxy.frames) return { ok: false, reason: 'frames' };
  return { ok: true, offset };
}

/**
 * Keep the cache folder under `maxBytes`: remove finished copies (`*.mkv`), least recently used
 * first (a reused copy is touched), never `keep`, never a partial or a lock. Returns the names
 * removed. Each copy is ~0.5-1.5 GB at 480p (review 2026-11-12: nothing ever removed them).
 */
export function pruneProxies({ dir, maxBytes, keep = null }) {
  let entries;
  try { entries = readdirSync(dir).filter((n) => n.endsWith('.mkv')).map((n) => { const st = statSync(path.join(dir, n)); return { n, size: st.size, at: st.mtimeMs }; }); } catch { return []; }
  let total = entries.reduce((sum, e) => sum + e.size, 0);
  const removed = [];
  for (const e of entries.sort((a, b) => a.at - b.at)) {
    if (total <= maxBytes) break;
    if (keep && path.join(dir, e.n) === keep) continue;
    try { rmSync(path.join(dir, e.n), { force: true }); removed.push(e.n); total -= e.size; } catch { /* in use elsewhere: leave it */ }
  }
  return removed;
}

