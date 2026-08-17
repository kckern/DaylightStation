/**
 * FsJamCorderArchive — persists JamCorder .mid recordings under
 * media/apps/piano/log/jamcorder/<relPath> and maintains a dedup index
 * (device listPath → archive relPath) at .../piano/jamcorder/_index.yml.
 * Layer: ADAPTER (1_adapters/jamcorder). All FS via FileIO.
 * @module adapters/jamcorder/FsJamCorderArchive
 */
import path from 'node:path';
import { IJamCorderArchive } from '#apps/jamcorder/ports/IJamCorderArchive.mjs';
import { writeBinary, fileExists, loadYamlSafe, saveYaml } from '#system/utils/FileIO.mjs';

const REL_ROOT = path.join('apps', 'piano', 'log', 'jamcorder');

export class FsJamCorderArchive extends IJamCorderArchive {
  #configService; #logger; #index;

  constructor({ configService, logger = console }) {
    super();
    if (!configService) throw new Error('FsJamCorderArchive requires configService');
    this.#configService = configService;
    this.#logger = logger;
    const loaded = loadYamlSafe(this.#indexBase());
    this.#index = (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) ? loaded : {};
  }

  has(ref) {
    return Object.prototype.hasOwnProperty.call(this.#index, ref.listPath);
  }

  async save(relPath, buffer) {
    const full = path.join(this.#baseDir(), relPath);
    if (fileExists(full)) return; // idempotent
    writeBinary(full, buffer);
  }

  async markProcessed(ref, relPath) {
    this.#index[ref.listPath] = relPath;
    saveYaml(this.#indexBase(), this.#index);
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
