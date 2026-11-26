/**
 * A household auth file read from disk now, not from the config cached at start: a
 * token check that missed asks again, so a rotated token works without a restart.
 * Null when the file cannot be read (the caller keeps what it had).
 *
 * Layer: ADAPTER (1_adapters/persistence/yaml).
 *
 * @module adapters/persistence/yaml/YamlHouseholdAuthReader
 */
import { readYamlFromPath } from '#system/utils/FileIO.mjs';

const SAFE_REF = /^[A-Za-z0-9_-]{1,64}$/;

export class YamlHouseholdAuthReader {
  #resolve;

  /** @param {{resolvePath:(relativePath:string)=>string}} deps the household path resolver */
  constructor({ resolvePath } = {}) {
    if (typeof resolvePath !== 'function') throw new TypeError('YamlHouseholdAuthReader requires resolvePath');
    this.#resolve = resolvePath;
  }

  /** @param {string} ref auth file name (e.g. "daylight-android") */
  read(ref) {
    if (!SAFE_REF.test(String(ref))) return null;
    try {
      return readYamlFromPath(this.#resolve(`auth/${ref}`)) ?? null;
    } catch {
      return null;
    }
  }
}

export default YamlHouseholdAuthReader;
