import path from 'node:path';
import { IPlaybackBudgetStore } from '../../application/ports/IPlaybackBudgetStore.mjs';
import { readYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

const SCHEMA = 'fitness.playback-budgets/v1';
export class YamlPlaybackBudgetStore extends IPlaybackBudgetStore {
  #config;
  constructor({ configService }) { super(); this.#config = configService; }
  #path({ householdId, localDate }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new TypeError('Invalid playback budget date');
    return path.join(this.#config.getHouseholdPath('fitness/playback-budgets', householdId), `${localDate}.yml`);
  }
  #read(key) {
    let data;
    try { data = readYamlFromPath(this.#path(key)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (data?.schema !== SCHEMA || data.localDate !== key.localDate || !data.devices || typeof data.devices !== 'object' || Array.isArray(data.devices)) {
      throw new Error('Corrupt playback budget document');
    }
    return data;
  }
  async load(key) {
    const data = this.#read(key);
    if (!data || !Object.hasOwn(data.devices, key.deviceId)) return null;
    const device = data.devices[key.deviceId];
    if (!device || typeof device !== 'object' || Array.isArray(device)) throw new Error('Corrupt playback budget device');
    return device;
  }
  async save({ value, ...key }) {
    const data = this.#read(key) ?? { schema: SCHEMA, localDate: key.localDate, devices: {} };
    data.devices[key.deviceId] = value;
    saveYamlToPathAtomic(this.#path(key), data, { durable: true });
  }
}
