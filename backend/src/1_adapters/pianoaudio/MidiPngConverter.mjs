/**
 * MidiPngConverter — renders a wrapped piano-roll PNG for one MIDI file.
 * Implements the IMidiConverter port (convertRecording(recording)) so it drops
 * straight into the shared ConvertPendingPianoMidi use case, just like the audio
 * converter. Reads the MIDI, parses its notes + derives a date/time title (both
 * pure domain), then calls the injected renderer (a 1_rendering function — an
 * adapter may not import 1_rendering directly, so the composition root injects
 * it). Writes atomically via `<png>.tmp` → rename; skips if the PNG exists.
 *
 * Layer: ADAPTER (1_adapters/pianoaudio).
 * @module adapters/pianoaudio/MidiPngConverter
 */
import path from 'node:path';
import { IMidiConverter } from '#apps/pianoaudio/ports/IMidiConverter.mjs';
import { mirrorRelForMidiRel } from '#domains/pianoaudio/pianoAudioPaths.mjs';
import { parseMidiNotes } from '#domains/pianoaudio/midiNotes.mjs';
import { pianoRollTitleFromRel } from '#domains/pianoaudio/pianoRollTitle.mjs';
import { deleteFile, ensureDir, fileExists, readBinaryFromPath, renameFile, writeBinary } from '#system/utils/FileIO.mjs';

export class MidiPngConverter extends IMidiConverter {
  #sourceDir; #destDir; #renderPng; #logger; #parseNotes; #titleFromPath; #renderOpts;

  constructor({
    renderPng,
    sourceDir,
    destDir,
    logger = console,
    parseNotes = parseMidiNotes,
    titleFromPath = pianoRollTitleFromRel,
    renderOpts = {},
  }) {
    super();
    if (typeof renderPng !== 'function') throw new Error('MidiPngConverter requires renderPng');
    if (!sourceDir || !destDir) throw new Error('MidiPngConverter requires sourceDir and destDir');
    this.#sourceDir = sourceDir;
    this.#destDir = destDir;
    this.#renderPng = renderPng;
    this.#logger = logger;
    this.#parseNotes = parseNotes;
    this.#titleFromPath = titleFromPath;
    this.#renderOpts = renderOpts;
  }

  async convertRecording({ recordingId } = {}) {
    const midiPath = this.#resolve(this.#sourceDir, recordingId);
    const pngPath = this.#resolve(this.#destDir, mirrorRelForMidiRel(recordingId, 'png'));
    if (!midiPath || !pngPath) throw new Error('Invalid MIDI recording id');
    if (fileExists(pngPath)) return; // already rendered

    const { notes, durationSeconds } = this.#parseNotes(readBinaryFromPath(midiPath));
    const title = this.#titleFromPath(midiPath); // regex finds the timestamp anywhere in the path
    const png = await this.#renderPng(notes, durationSeconds, { ...this.#renderOpts, title });

    ensureDir(path.dirname(pngPath));
    const tmp = `${pngPath}.tmp`;
    try {
      writeBinary(tmp, png);
      renameFile(tmp, pngPath);
    } finally {
      if (fileExists(tmp)) deleteFile(tmp); // already gone
    }
  }

  #resolve(root, relativeId) {
    const resolved = path.resolve(root, relativeId || '');
    const base = path.resolve(root);
    return resolved === base || resolved.startsWith(`${base}${path.sep}`) ? resolved : null;
  }
}

export default MidiPngConverter;
