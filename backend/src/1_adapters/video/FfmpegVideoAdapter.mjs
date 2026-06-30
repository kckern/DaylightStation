import { spawn } from 'node:child_process';
import path from 'node:path';
import { IVideoEncoder } from '#apps/fitness/ports/IVideoEncoder.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const DEFAULT_TIMEOUT_MS = 120_000;

/** Expand a {key:value} metadata map into `-metadata key=value` ffmpeg args. */
export function metadataArgs(metadata) {
  if (!metadata || typeof metadata !== 'object') return [];
  const args = [];
  for (const [k, v] of Object.entries(metadata)) {
    if (v == null || v === '') continue;
    args.push('-metadata', `${k}=${v}`);
  }
  return args;
}

/**
 * ffmpeg-backed implementation of IVideoEncoder. Stitches a frame sequence into
 * a silent MP4. (Player frames are captured client-side in realtime, so no
 * source-frame extraction is needed here.) Assumes `ffmpeg` is on $PATH.
 */
export class FfmpegVideoAdapter extends IVideoEncoder {
  #logger;
  #timeoutMs;

  constructor({ logger = console, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    super();
    this.#logger = logger;
    this.#timeoutMs = timeoutMs;
  }

  /** @param {{framesDir:string, pattern:string, fps:number, outputPath:string, crf?:number, metadata?:Record<string,string>}} params */
  async encodeSequence({ framesDir, pattern, fps, outputPath, crf = 20, metadata = null } = {}) {
    if (!framesDir || !pattern || !outputPath) {
      throw new InfrastructureError('encodeSequence missing args', { code: 'MISSING_ARGS' });
    }
    await this.#run([
      '-y',
      '-framerate', String(fps),
      '-i', path.join(framesDir, pattern),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', String(crf),
      '-an',
      ...metadataArgs(metadata),
      outputPath
    ], { capture: false });
    return { outputPath };
  }

  #run(args, { capture }) {
    return new Promise((resolve, reject) => {
      this.#logger.debug?.('ffmpeg.spawn', { args: args.join(' ') });
      const proc = spawn('ffmpeg', args, { stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe'] });
      const out = [];
      let stderr = '';
      if (capture) proc.stdout.on('data', d => out.push(d));
      proc.stderr.on('data', d => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        proc.kill();
        reject(new InfrastructureError('ffmpeg timeout', { code: 'FFMPEG_TIMEOUT' }));
      }, this.#timeoutMs);

      proc.on('error', err => {
        clearTimeout(timer);
        reject(new InfrastructureError(`ffmpeg spawn failed: ${err.message}`, { code: 'FFMPEG_SPAWN' }));
      });

      proc.on('close', code => {
        clearTimeout(timer);
        if (code === 0) {
          this.#logger.debug?.('ffmpeg.ok', { op: args.includes('image2pipe') ? 'extract' : 'encode' });
          resolve(capture ? Buffer.concat(out) : null);
        } else {
          reject(new InfrastructureError(`ffmpeg exited ${code}: ${stderr.slice(-300)}`, { code: 'FFMPEG_EXIT', exitCode: code }));
        }
      });
    });
  }
}
