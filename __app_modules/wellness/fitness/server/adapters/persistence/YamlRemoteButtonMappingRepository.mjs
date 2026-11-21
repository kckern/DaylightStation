import path from 'node:path';
import { IRemoteButtonMappingRepository } from '../../application/ports/IRemoteButtonMappingRepository.mjs';
import { readYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

/**
 * What each Bluetooth remote's buttons do, written by the app (Bluetooth
 * screen → Edit buttons). One file per household:
 * household[-{hid}]/fitness/remote-buttons.yml. Not input.yml: that file is
 * hand-commented and code never writes it.
 */
export const REMOTE_BUTTONS_SCHEMA = 'fitness.remote-buttons/v1';
const FILE = 'remote-buttons.yml';

export class YamlRemoteButtonMappingRepository extends IRemoteButtonMappingRepository {
  #config;
  constructor({ configService }) {
    super();
    if (typeof configService?.getHouseholdPath !== 'function') throw new Error('YamlRemoteButtonMappingRepository: configService with getHouseholdPath() is required');
    this.#config = configService;
  }
  #path(householdId) { return path.join(this.#config.getHouseholdPath('fitness', householdId), FILE); }
  async load(householdId) {
    let data;
    try { data = readYamlFromPath(this.#path(householdId)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (data == null) return null;
    if (data.schema !== REMOTE_BUTTONS_SCHEMA || !data.remotes || typeof data.remotes !== 'object' || Array.isArray(data.remotes)) {
      throw new Error('Corrupt remote buttons document');
    }
    return data;
  }
  async save(householdId, document) {
    saveYamlToPathAtomic(this.#path(householdId), { schema: REMOTE_BUTTONS_SCHEMA, ...document }, { durable: true });
  }
}
export default YamlRemoteButtonMappingRepository;
