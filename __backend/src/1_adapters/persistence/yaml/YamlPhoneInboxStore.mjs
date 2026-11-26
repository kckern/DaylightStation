/**
 * The phone inbox's durable state, one YAML file per device:
 * `history/devices/<deviceId>/inbox.yml` in the household tree (installs seen, keep
 * commands waiting for an ack, what the phone says it keeps).
 *
 * The read tells "no file yet" (null) from everything else, which THROWS: a file
 * that is still a cloud placeholder, half-synced, unreadable (EACCES) or damaged
 * (truncated YAML) must never read as empty, because the next save would then write
 * over what it holds. A damaged file is copied aside (`_bad/inbox.<stamp>.yml`)
 * before anything else happens. Writes are asynchronous and atomic (a staged file,
 * then a rename), so a poll never blocks the event loop on a write and a reader sees
 * the old or the new document, never half of one.
 *
 * Layer: ADAPTER (1_adapters/persistence/yaml).
 *
 * @module adapters/persistence/yaml/YamlPhoneInboxStore
 */
import path from 'node:path';
import yaml from 'js-yaml';
import {
  readYamlFromPath,
  writeTextFileAsync,
  renameFileAsync,
  copyFileOnce,
  ensureDir,
} from '#system/utils/FileIO.mjs';

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export class YamlPhoneInboxStore {
  #resolve;

  /**
   * @param {{resolvePath:(relativePath:string)=>string}} deps the household path resolver
   *   (DataService.household.resolvePath, which adds `.yml`)
   */
  constructor({ resolvePath } = {}) {
    if (typeof resolvePath !== 'function') throw new TypeError('YamlPhoneInboxStore requires resolvePath');
    this.#resolve = resolvePath;
  }

  #file(deviceId) {
    if (!SAFE_ID.test(String(deviceId))) throw new TypeError('device id is not a safe path segment');
    return this.#resolve(`history/devices/${deviceId}/inbox`);
  }

  /** The stored state, or null when there is no file yet. Throws for anything else. */
  load(deviceId) {
    const file = this.#file(deviceId);
    let data;
    try {
      data = readYamlFromPath(file);
    } catch (err) {
      if (err?.code === 'ENOENT') return null;
      throw err;
    }
    if (data === null || data === undefined || typeof data !== 'object' || Array.isArray(data)) {
      const err = new Error('inbox file is empty or not a mapping');
      err.damaged = true;
      throw err;
    }
    return data;
  }

  /** Atomic, asynchronous replace. Rejects when it could not be written. */
  async save(deviceId, data) {
    const file = this.#file(deviceId);
    const staged = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
    await writeTextFileAsync(staged, yaml.dump(data, { lineWidth: -1, quotingType: '"' }));
    await renameFileAsync(staged, file);
  }

  /** Keeps a damaged file aside (`_bad/`) so nothing it held is lost. */
  quarantine(deviceId) {
    const file = this.#file(deviceId);
    const dir = path.join(path.dirname(file), '_bad');
    ensureDir(dir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    copyFileOnce(file, path.join(dir, `inbox.${stamp}.yml`));
  }
}

export default YamlPhoneInboxStore;
