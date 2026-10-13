import { spawn as spawnProcess } from 'node:child_process';

/** Process adapter for generating a representative JPEG video frame. */
export class FfmpegVideoThumbnailGenerator {
  #spawn;
  #timeoutMs;

  constructor({ spawn = spawnProcess, timeoutMs = 30_000 } = {}) {
    this.#spawn = spawn;
    this.#timeoutMs = timeoutMs;
  }

  generate(sourcePath, outputPath) {
    return new Promise((resolve, reject) => {
      const ffmpeg = this.#spawn('ffmpeg', [
        '-ss', '3',
        '-i', sourcePath,
        '-vf', 'thumbnail=100,scale=300:-1',
        '-frames:v', '1',
        '-update', '1',
        '-y',
        outputPath,
      ], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      let stderr = '';
      let settled = false;
      let timeout;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback();
      };

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      ffmpeg.on('close', (code) => finish(() => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-200)}`));
      }));
      ffmpeg.on('error', (error) => finish(() => reject(error)));

      timeout = setTimeout(() => {
        ffmpeg.kill();
        finish(() => reject(new Error('ffmpeg timeout')));
      }, this.#timeoutMs);
    });
  }
}

export default FfmpegVideoThumbnailGenerator;
