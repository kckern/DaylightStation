/**
 * FsMidiLibrary — walks household/history/piano for .mid files and mirrors each
 * to media/audio/piano/<same rel>.mp3, returning only those whose mp3 is still
 * missing, newest-first. Owns all filesystem access.
 *
 * Junk guardrail: a MIDI with NO notes, or one that is both long and note-sparse
 * (a genuinely stuck note / idle recording), is skipped — it would render a
 * multi-GB scratch WAV of silence or a single held tone. A merely LONG file
 * (real multi-hour practice session, tens of thousands of notes) is NOT junk and
 * IS rendered. Note count + duration are read cheaply from the SMF via an
 * injectable seam (default the pure `analyzeMidi`), long before any fluidsynth
 * render.
 *
 * Layer: ADAPTER (1_adapters/pianoaudio).
 * @module adapters/pianoaudio/FsMidiLibrary
 */
import fs from 'node:fs';
import path from 'node:path';
import { IMidiLibrary } from '#apps/pianoaudio/ports/IMidiLibrary.mjs';
import { mp3RelForMidiRel } from '#domains/pianoaudio/pianoAudioPaths.mjs';
import { analyzeMidi, isLikelyJunkMidi } from '#domains/pianoaudio/midiDuration.mjs';
import { fileExists } from '#system/utils/FileIO.mjs';

const DEFAULT_JUNK_MIN_SECONDS = 1800; // 30 min — the "long" half of the long-AND-sparse junk test
const DEFAULT_JUNK_MIN_NOTES = 200;    // the "sparse" half

/** Read a .mid file and return its {durationSeconds, noteCount} (throws on unparseable input). */
export function readMidiStats(absPath) {
  return analyzeMidi(fs.readFileSync(absPath));
}

export class FsMidiLibrary extends IMidiLibrary {
  #sourceDir; #destDir; #logger; #junkMinSeconds; #junkMinNotes; #midiStats;

  constructor({
    sourceDir,
    destDir,
    logger = console,
    junkMinSeconds = DEFAULT_JUNK_MIN_SECONDS,
    junkMinNotes = DEFAULT_JUNK_MIN_NOTES,
    midiStats = readMidiStats,
  }) {
    super();
    if (!sourceDir) throw new Error('FsMidiLibrary requires sourceDir');
    if (!destDir) throw new Error('FsMidiLibrary requires destDir');
    this.#sourceDir = sourceDir;
    this.#destDir = destDir;
    this.#logger = logger;
    this.#junkMinSeconds = junkMinSeconds;
    this.#junkMinNotes = junkMinNotes;
    this.#midiStats = midiStats;
  }

  async listPending() {
    const midis = this.#walk(this.#sourceDir);
    const pending = [];
    for (const m of midis) {
      const rel = path.relative(this.#sourceDir, m.abs);
      const mp3Path = path.join(this.#destDir, mp3RelForMidiRel(rel));
      if (fileExists(mp3Path)) continue; // already rendered

      // Junk guardrail: drop note-less / long-AND-sparse (stuck note / idle) files.
      let stats = null;
      try {
        stats = this.#midiStats(m.abs);
      } catch (err) {
        // Unparseable → don't silently drop a possibly-valid file; let the
        // converter attempt it (its per-file timeout is the backstop).
        this.#logger.warn?.('pianoaudio.stats.unparsed', { midiPath: m.abs, error: err.message });
      }
      if (stats && isLikelyJunkMidi(stats, { minSeconds: this.#junkMinSeconds, minNotes: this.#junkMinNotes })) {
        this.#logger.warn?.('pianoaudio.skip.junk', {
          midiPath: m.abs,
          seconds: Math.round(stats.durationSeconds),
          notes: stats.noteCount,
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
