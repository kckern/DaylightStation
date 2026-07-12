/**
 * FluidSynthMp3Converter — renders one MIDI to a normalized MP3:
 *   fluidsynth (MIDI → scratch WAV) → ffmpeg loudnorm (WAV → <mp3>.tmp) → rename.
 * The scratch WAV is always cleaned up; a crash mid-ffmpeg never leaves a partial
 * final mp3 (we write .tmp then rename). The subprocess call is an injectable
 * seam (`execFile`) so the argv and file flow are unit-testable without binaries.
 *
 * Layer: ADAPTER (1_adapters/pianoaudio).
 * @module adapters/pianoaudio/FluidSynthMp3Converter
 */
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile as _execFile } from 'node:child_process';
import { IMidiConverter } from '#apps/pianoaudio/ports/IMidiConverter.mjs';
import { ensureDir, fileExists } from '#system/utils/FileIO.mjs';

const execFileAsync = promisify(_execFile);
const LOUDNORM = 'loudnorm=I=-16:TP=-1.5:LRA=11';
const MIN_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 600_000;

export class FluidSynthMp3Converter extends IMidiConverter {
  #soundfontPath; #scratchDir; #logger; #execFile; #counter = 0;

  constructor({ soundfontPath, scratchDir = '/tmp/pianoaudio', logger = console, execFile = execFileAsync }) {
    super();
    if (!soundfontPath) throw new Error('FluidSynthMp3Converter requires soundfontPath');
    this.#soundfontPath = soundfontPath;
    this.#scratchDir = scratchDir;
    this.#logger = logger;
    this.#execFile = execFile;
  }

  async convert(midiPath, mp3Path) {
    if (fileExists(mp3Path)) return; // already rendered — resumable skip

    ensureDir(this.#scratchDir);
    ensureDir(path.dirname(mp3Path));

    const base = path.basename(mp3Path, '.mp3').replace(/[^\w.-]/g, '_');
    const wavPath = path.join(this.#scratchDir, `${base}.${process.pid}.${this.#counter++}.wav`);
    const tmpMp3 = `${mp3Path}.tmp`;

    try {
      await this.#execFile(
        'fluidsynth',
        ['-ni', '-F', wavPath, '-r', '44100', this.#soundfontPath, midiPath],
        { timeout: this.#timeoutFor(midiPath) },
      );
      await this.#execFile(
        'ffmpeg',
        // -f mp3 is REQUIRED: the output path ends in `.tmp` (for atomic rename),
        // so ffmpeg cannot infer the muxer from the extension and must be told.
        ['-i', wavPath, '-af', LOUDNORM, '-codec:a', 'libmp3lame', '-qscale:a', '2', '-f', 'mp3', tmpMp3, '-y'],
        { timeout: this.#timeoutFor(wavPath) },
      );
      fs.renameSync(tmpMp3, mp3Path);
    } finally {
      this.#safeUnlink(wavPath);
      this.#safeUnlink(tmpMp3); // no-op if the rename already consumed it
    }
  }

  /** Timeout scales with input size: 60s base + 1s per 4KB, capped at 600s. */
  #timeoutFor(filePath) {
    let size = 0;
    try { size = fs.statSync(filePath).size; } catch { /* keep 0 */ }
    return Math.min(MAX_TIMEOUT_MS, MIN_TIMEOUT_MS + Math.floor(size / 4096) * 1000);
  }

  #safeUnlink(p) {
    try { fs.unlinkSync(p); } catch { /* already gone */ }
  }
}

export default FluidSynthMp3Converter;
