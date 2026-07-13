/**
 * MidiPngConverter — renders a wrapped piano-roll PNG for one MIDI file.
 * Implements the IMidiConverter port (convert(midiPath, outputPath)) so it drops
 * straight into the shared ConvertPendingPianoMidi use case, just like the audio
 * converter. Reads the MIDI, parses its notes + derives a date/time title (both
 * pure domain), then calls the injected renderer (a 1_rendering function — an
 * adapter may not import 1_rendering directly, so the composition root injects
 * it). Writes atomically via `<png>.tmp` → rename; skips if the PNG exists.
 *
 * Layer: ADAPTER (1_adapters/pianoaudio).
 * @module adapters/pianoaudio/MidiPngConverter
 */
import fs from 'node:fs';
import path from 'node:path';
import { IMidiConverter } from '#apps/pianoaudio/ports/IMidiConverter.mjs';
import { parseMidiNotes } from '#domains/pianoaudio/midiNotes.mjs';
import { pianoRollTitleFromRel } from '#domains/pianoaudio/pianoRollTitle.mjs';
import { ensureDir, fileExists, writeBinary } from '#system/utils/FileIO.mjs';

export class MidiPngConverter extends IMidiConverter {
  #renderPng; #logger; #parseNotes; #titleFromPath; #renderOpts;

  constructor({
    renderPng,
    logger = console,
    parseNotes = parseMidiNotes,
    titleFromPath = pianoRollTitleFromRel,
    renderOpts = {},
  }) {
    super();
    if (typeof renderPng !== 'function') throw new Error('MidiPngConverter requires renderPng');
    this.#renderPng = renderPng;
    this.#logger = logger;
    this.#parseNotes = parseNotes;
    this.#titleFromPath = titleFromPath;
    this.#renderOpts = renderOpts;
  }

  async convert(midiPath, pngPath) {
    if (fileExists(pngPath)) return; // already rendered

    const { notes, durationSeconds } = this.#parseNotes(fs.readFileSync(midiPath));
    const title = this.#titleFromPath(midiPath); // regex finds the timestamp anywhere in the path
    const png = await this.#renderPng(notes, durationSeconds, { ...this.#renderOpts, title });

    ensureDir(path.dirname(pngPath));
    const tmp = `${pngPath}.tmp`;
    try {
      writeBinary(tmp, png);
      fs.renameSync(tmp, pngPath);
    } finally {
      if (fileExists(tmp)) { try { fs.unlinkSync(tmp); } catch { /* already gone */ } }
    }
  }
}

export default MidiPngConverter;
