/**
 * FsJamCorderArchive — persists JamCorder .mid recordings under
 * media/midi/piano/log/jamcorder/<relPath> and maintains a dedup index
 * (device listPath → archive relPath) at .../piano/jamcorder/_index.yml.
 * Layer: ADAPTER (1_adapters/jamcorder). All FS via FileIO.
 * @module adapters/jamcorder/FsJamCorderArchive
 */
import path from 'node:path';
import { IMidiRecordingArchive } from '#apps/midi/ports/IMidiRecordingArchive.mjs';
import { archiveRelPathForStone, parseMidiRecordingStone } from './MidiRecordingStoneCodec.mjs';
import { writeBinary, fileExists, loadYamlSafe, saveYaml } from '#system/utils/FileIO.mjs';

const REL_ROOT = path.join('midi', 'piano', 'log', 'jamcorder');

export class FsJamCorderArchive extends IMidiRecordingArchive {
  #configService; #logger; #index;

  constructor({ configService, logger = console }) {
    super();
    if (!configService) throw new Error('FsJamCorderArchive requires configService');
    this.#configService = configService;
    this.#logger = logger;
    const loaded = loadYamlSafe(this.#indexBase());
    this.#index = (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) ? loaded : {};
  }

  hasRecording(recordingId) {
    return Object.prototype.hasOwnProperty.call(this.#index, recordingId);
  }

  async archiveRecording(recording, artifact) {
    const relPath = archiveRelPathForStone(parseMidiRecordingStone(artifact));
    const full = path.join(this.#baseDir(), relPath);
    if (!fileExists(full)) writeBinary(full, artifact);
    this.#index[recording.recordingId] = relPath;
    saveYaml(this.#indexBase(), this.#index);
    return { archiveId: relPath };
  }

  #baseDir() {
    return path.join(this.#configService.getMediaDir(), REL_ROOT);
  }

  #indexBase() {
    // saveYaml/loadYamlSafe append `.yml` to this base path
    return path.join(this.#baseDir(), '_index');
  }
}

export default FsJamCorderArchive;
