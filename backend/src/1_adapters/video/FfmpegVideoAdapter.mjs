import { spawn } from 'node:child_process';
import path from 'node:path';
import { IVideoEncoder } from '#apps/fitness/ports/IVideoEncoder.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * ffmpeg-backed implementation of IVideoFrameExtractor + IVideoEncoder.
 * Mirrors the existing spawn pattern (stderr capture, close/error, timeout).
 * Assumes `ffmpeg` is on $PATH.
 */
export class FfmpegVideoAdapter extends IVideoEncoder { // also fulfils IVideoFrameExtractor (duck-typed)
  #logger;
  #timeoutMs;

  constructor({ logger = console, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    super();
    this.#logger = logger;
    this.#timeoutMs = timeoutMs;
  }

  /** @param {{source:string, offsetMs:number}} params @returns {Promise<Buffer>} JPEG */
  async extractFrame({ source, offsetMs } = {}) {
    if (!source) throw new InfrastructureError('extractFrame requires source', { code: 'MISSING_SOURCE' });
    const ss = (Math.max(0, offsetMs || 0) / 1000).toFixed(3);
    // -ss before -i = fast input seek; emit a single mjpeg frame to stdout
    return this.#run([
      '-ss', ss, '-i', source,
      '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'
    ], { capture: true });
  }

  /** @param {{framesDir:string, pattern:string, fps:number, outputPath:string, crf?:number}} params */
  async encodeSequence({ framesDir, pattern, fps, outputPath, crf = 20 } = {}) {
    if (!framesDir || !pattern || !outputPath) {
      throw new InfrastructureError('encodeSequence missing args', { code: 'MISSING_ARGS' });
    }
    await this.#run([
      '-y',
      '-framerate', String(fps),
      '-i', path.join(framesDir, pattern),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', String(crf),
      '-an', outputPath
    ], { capture: false });
    return { outputPath };
  }

  #run(args, { capture }) {
    return new Promise((resolve, reject) => {
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
