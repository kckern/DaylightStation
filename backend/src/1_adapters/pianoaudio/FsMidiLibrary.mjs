/**
 * FsMidiLibrary — walks household/history/piano for .mid files and mirrors each
 * to media/audio/piano/<same rel>.mp3, returning only those whose mp3 is still
 * missing, newest-first. Owns all filesystem access.
 *
 * Guardrail: a MIDI whose rendered duration exceeds `maxRenderSeconds` (default
 * 20 min) is skipped — a stuck note or an idle device recording can span hours,
 * rendering a multi-GB scratch WAV that eats disk and stalls the run. Duration is
 * read cheaply from the SMF header/events via an injectable seam (default
 * `@tonejs/midi`), long before any expensive fluidsynth render.
 *
 * Layer: ADAPTER (1_adapters/pianoaudio).
 * @module adapters/pianoaudio/FsMidiLibrary
 */
import fs from 'node:fs';
import path from 'node:path';
import { IMidiLibrary } from '#apps/pianoaudio/ports/IMidiLibrary.mjs';
import { mp3RelForMidiRel } from '#domains/pianoaudio/pianoAudioPaths.mjs';
import { estimateMidiDurationSeconds } from '#domains/pianoaudio/midiDuration.mjs';
import { fileExists } from '#system/utils/FileIO.mjs';

const DEFAULT_MAX_RENDER_SECONDS = 3600; // 60 min — a longer single take is almost certainly an idle/stuck recorder

/** Read a .mid file and estimate its rendered duration in seconds (throws on unparseable input). */
export function readMidiDurationSeconds(absPath) {
  return estimateMidiDurationSeconds(fs.readFileSync(absPath));
}

export class FsMidiLibrary extends IMidiLibrary {
  #sourceDir; #destDir; #logger; #maxRenderSeconds; #midiDurationSeconds;

  constructor({
    sourceDir,
    destDir,
    logger = console,
    maxRenderSeconds = DEFAULT_MAX_RENDER_SECONDS,
    midiDurationSeconds = readMidiDurationSeconds,
  }) {
    super();
    if (!sourceDir) throw new Error('FsMidiLibrary requires sourceDir');
    if (!destDir) throw new Error('FsMidiLibrary requires destDir');
    this.#sourceDir = sourceDir;
    this.#destDir = destDir;
    this.#logger = logger;
    this.#maxRenderSeconds = maxRenderSeconds;
    this.#midiDurationSeconds = midiDurationSeconds;
  }

  async listPending() {
    const midis = this.#walk(this.#sourceDir);
    const pending = [];
    for (const m of midis) {
      const rel = path.relative(this.#sourceDir, m.abs);
      const mp3Path = path.join(this.#destDir, mp3RelForMidiRel(rel));
      if (fileExists(mp3Path)) continue; // already rendered

      // Guardrail: drop pathological over-long renders (stuck note / idle recording).
      let seconds = null;
      try {
        seconds = this.#midiDurationSeconds(m.abs);
      } catch (err) {
        // Unparseable → don't silently drop a possibly-valid file; let the
        // converter attempt it (its per-file timeout is the backstop).
        this.#logger.warn?.('pianoaudio.duration.unparsed', { midiPath: m.abs, error: err.message });
      }
      if (seconds != null && seconds > this.#maxRenderSeconds) {
        this.#logger.warn?.('pianoaudio.skip.too_long', {
          midiPath: m.abs,
          seconds: Math.round(seconds),
          capSeconds: this.#maxRenderSeconds,
        });
        continue;
      }

      pending.push({ midiPath: m.abs, mp3Path, mtimeMs: m.mtimeMs });
    }
    pending.sort((a, b) => b.mtimeMs - a.mtimeMs); // newest-first
    return pending.map(({ midiPath, mp3Path }) => ({ midiPath, mp3Path }));
  }

  /** @returns {Array<{abs:string, mtimeMs:number}>} */
  #walk(dir) {
    const out = [];
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return out; // missing/unreadable dir → nothing
    }
    for (const e of entries) {
      if (e.name.startsWith('._')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        out.push(...this.#walk(abs));
      } else if (e.isFile() && /\.mid$/i.test(e.name)) {
        let mtimeMs = 0;
        try { mtimeMs = fs.statSync(abs).mtimeMs; } catch { /* keep 0 */ }
        out.push({ abs, mtimeMs });
      }
    }
    return out;
  }
}

export default FsMidiLibrary;
