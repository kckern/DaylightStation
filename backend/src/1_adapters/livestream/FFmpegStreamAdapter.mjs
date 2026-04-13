import { spawn } from 'child_process';
import { PassThrough } from 'stream';
import crypto from 'crypto';

/**
 * FFmpegStreamAdapter — manages a long-lived FFmpeg AAC encoder process
 * and broadcasts output to connected HTTP clients.
 *
 * The encoder reads raw PCM (s16le, 44100Hz, stereo) from stdin and
 * outputs ADTS-framed AAC to stdout. Clients are PassThrough streams
 * that receive a copy of the encoder output.
 */
export class FFmpegStreamAdapter {
  #format;
  #bitrate;
  #logger;
  #process = null;
  #clients = new Map();
  #buffer = [];
  #bufferMaxBytes = 44100 * 2 * 2 * 30; // ~30s of PCM worth of AAC

  constructor({ format = 'aac', bitrate = 96, logger = console }) {
    this.#format = format;
    this.#bitrate = bitrate;
    this.#logger = logger;
  }

  get isRunning() { return this.#process !== null; }
  get clientCount() { return this.#clients.size; }

  /**
   * Start the FFmpeg encoder process.
   * @returns {import('stream').Writable} stdin — write raw PCM here
   */
  start() {
    if (this.#process) return this.#process.stdin;

    const args = [
      '-f', 's16le', '-ar', '44100', '-ac', '2', '-i', 'pipe:0',
      '-c:a', this.#format, '-b:a', `${this.#bitrate}k`,
      '-f', 'adts', 'pipe:1'
    ];

    this.#process = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    this.#process.stderr.on('data', (data) => {
      this.#logger.debug?.('livestream.ffmpeg.stderr', { output: data.toString().trim() });
    });

    this.#process.on('exit', (code, signal) => {
      this.#logger.info?.('livestream.ffmpeg.exit', { code, signal });
      this.#process = null;
    });

    this.#process.on('error', (err) => {
      this.#logger.error?.('livestream.ffmpeg.error', { error: err.message });
      this.#process = null;
    });

    this.#process.stdout.on('data', (chunk) => {
      this.#buffer.push(chunk);
      this.#trimBuffer();
      for (const [id, client] of this.#clients) {
        if (!client.destroyed) {
          client.write(chunk);
        } else {
          this.#clients.delete(id);
        }
      }
    });

    this.#logger.info?.('livestream.ffmpeg.started', {
      format: this.#format, bitrate: this.#bitrate, pid: this.#process.pid,
    });

    return this.#process.stdin;
  }

  /**
   * Add a client stream. Writes rolling buffer immediately.
   * @returns {string} Client ID
   */
  addClient(stream) {
    const id = crypto.randomUUID();
    for (const chunk of this.#buffer) {
      if (!stream.destroyed) stream.write(chunk);
    }
    this.#clients.set(id, stream);
    this.#logger.info?.('livestream.client.added', { clientId: id, total: this.#clients.size });
    return id;
  }

  removeClient(clientId) {
    this.#clients.delete(clientId);
    this.#logger.info?.('livestream.client.removed', { clientId, total: this.#clients.size });
  }

  stop() {
    if (this.#process) {
      this.#process.kill('SIGTERM');
      this.#process = null;
    }
    this.#clients.clear();
    this.#buffer = [];
  }

  #trimBuffer() {
    let totalBytes = this.#buffer.reduce((sum, b) => sum + b.length, 0);
    while (totalBytes > this.#bufferMaxBytes && this.#buffer.length > 1) {
      totalBytes -= this.#buffer.shift().length;
    }
  }
}

export default FFmpegStreamAdapter;
