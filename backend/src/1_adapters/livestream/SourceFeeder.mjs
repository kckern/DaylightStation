import { spawn } from 'child_process';

/**
 * SourceFeeder — orchestrates what audio gets fed into the FFmpeg encoder.
 *
 * - Spawns short-lived FFmpeg decoder per track (any format → PCM)
 * - Pipes decoder PCM output to encoder stdin
 * - Kills decoder on force-play / skip
 * - Generates silence when nothing is playing
 * - Notifies when track ends so ChannelManager can pull next from queue
 */
export class SourceFeeder {
  #encoderStdin;
  #onTrackEnd;
  #onNeedTrack;
  #logger;
  #activeDecoder = null;
  #currentFile = null;
  #silenceInterval = null;
  #stopped = false;

  constructor({ encoderStdin, onTrackEnd, onNeedTrack, logger = console }) {
    this.#encoderStdin = encoderStdin;
    this.#onTrackEnd = onTrackEnd;
    this.#onNeedTrack = onNeedTrack;
    this.#logger = logger;
  }

  get currentFile() { return this.#currentFile; }

  playFile(filePath) {
    this.#stopSilence();
    this.#killDecoder();
    this.#stopped = false;
    this.#currentFile = filePath;

    const args = ['-i', filePath, '-f', 's16le', '-ar', '44100', '-ac', '2', 'pipe:1'];
    this.#activeDecoder = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    this.#activeDecoder.stdout.on('data', (chunk) => {
      if (!this.#stopped && !this.#encoderStdin.destroyed) {
        this.#encoderStdin.write(chunk);
      }
    });

    this.#activeDecoder.stderr.on('data', (data) => {
      this.#logger.debug?.('livestream.decoder.stderr', { file: filePath, output: data.toString().trim() });
    });

    this.#activeDecoder.on('exit', (code, signal) => {
      if (this.#stopped) return;
      this.#logger.info?.('livestream.decoder.exit', { file: filePath, code, signal });
      this.#activeDecoder = null;
      this.#currentFile = null;
      this.#onTrackEnd();
      this.#onNeedTrack();
    });

    this.#activeDecoder.on('error', (err) => {
      this.#logger.error?.('livestream.decoder.error', { file: filePath, error: err.message });
      this.#activeDecoder = null;
      this.#currentFile = null;
      this.#onNeedTrack();
    });

    this.#logger.info?.('livestream.decoder.started', { file: filePath, pid: this.#activeDecoder.pid });
  }

  playAmbientLoop(filePath) {
    this.#stopSilence();
    this.#killDecoder();

    const playOnce = () => {
      if (this.#stopped) return;
      this.#currentFile = filePath;
      const args = ['-i', filePath, '-f', 's16le', '-ar', '44100', '-ac', '2', 'pipe:1'];
      this.#activeDecoder = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      this.#activeDecoder.stdout.on('data', (chunk) => {
        if (!this.#stopped && !this.#encoderStdin.destroyed) this.#encoderStdin.write(chunk);
      });
      this.#activeDecoder.stderr.on('data', () => {});
      this.#activeDecoder.on('exit', () => { if (!this.#stopped) playOnce(); });
      this.#activeDecoder.on('error', () => { if (!this.#stopped) setTimeout(playOnce, 1000); });
    };
    playOnce();
  }

  playSilence() {
    this.#killDecoder();
    this.#stopSilence();
    this.#stopped = false;
    const frame = Buffer.alloc(44100 * 2 * 2 / 10); // 100ms of silence
    this.#silenceInterval = setInterval(() => {
      if (!this.#stopped && !this.#encoderStdin.destroyed) this.#encoderStdin.write(frame);
    }, 100);
  }

  stop() {
    this.#stopped = true;
    this.#killDecoder();
    this.#stopSilence();
    this.#currentFile = null;
  }

  #killDecoder() {
    if (this.#activeDecoder) {
      this.#activeDecoder.kill('SIGKILL');
      this.#activeDecoder = null;
    }
  }

  #stopSilence() {
    if (this.#silenceInterval) {
      clearInterval(this.#silenceInterval);
      this.#silenceInterval = null;
    }
  }
}

export default SourceFeeder;
