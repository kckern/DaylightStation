/**
 * FsMidiLibrary — walks household/history/piano for .mid files and mirrors each
 * to media/audio/piano/<same rel>.mp3, returning only those whose mp3 is still
 * missing, newest-first. Owns all filesystem access.
 *
 * Layer: ADAPTER (1_adapters/pianoaudio).
 * @module adapters/pianoaudio/FsMidiLibrary
 */
import fs from 'node:fs';
import path from 'node:path';
import { IMidiLibrary } from '#apps/pianoaudio/ports/IMidiLibrary.mjs';
import { mp3RelForMidiRel } from '#domains/pianoaudio/pianoAudioPaths.mjs';
import { fileExists } from '#system/utils/FileIO.mjs';

export class FsMidiLibrary extends IMidiLibrary {
  #sourceDir; #destDir; #logger;

  constructor({ sourceDir, destDir, logger = console }) {
    super();
    if (!sourceDir) throw new Error('FsMidiLibrary requires sourceDir');
    if (!destDir) throw new Error('FsMidiLibrary requires destDir');
    this.#sourceDir = sourceDir;
    this.#destDir = destDir;
    this.#logger = logger;
  }

  async listPending() {
    const midis = this.#walk(this.#sourceDir);
    const pending = [];
    for (const m of midis) {
      const rel = path.relative(this.#sourceDir, m.abs);
      const mp3Path = path.join(this.#destDir, mp3RelForMidiRel(rel));
      if (fileExists(mp3Path)) continue;
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
