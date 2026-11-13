/**
 * The low-res picture copy refine reads frames from (CachedRefineMedia.ProxiedRefineMedia).
 * Picture only, a keyframe every second, no B-frames, every frame kept at its own timestamp: a
 * frame grab seeks at most a second and decodes a few small frames instead of up to ~30 s of
 * 1080p. Measured on Terminator 2 (2026-11-12): the copy has the original's 197,294 frames and
 * the same frame at every time checked. Built once per part and file size into a cache folder that
 * outlives the worker's per-run stage (CONTENT_FILTER_PROXY_DIR).
 */
import { existsSync, mkdirSync, renameSync, rmSync } from 'fs';
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
 * caller reads the original instead); a failed build leaves no file behind.
 * @param {{ src: string, dir: string, partId: string, size?: number|null, height?: number, run?: (args: string[]) => Promise<unknown> }} p
 */
export async function ensureVideoProxy({ src, dir, partId, size = null, height = PROXY_HEIGHT, run = defaultRun }) {
  const out = path.join(dir, proxyFileName({ partId, size, height }));
  if (existsSync(out)) return out;
  mkdirSync(dir, { recursive: true });
  const partial = `${out}.partial`;
  try {
    await run(proxyArgs(src, partial, { height }));
    renameSync(partial, out);
    return out;
  } catch (e) {
    rmSync(partial, { force: true });
    throw e;
  }
}
