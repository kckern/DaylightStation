/**
 * YAML-backed trigger config repository. Public adapter entry — bootstrap
 * calls this. Owns the I/O boundary; delegates schema validation and
 * registry assembly to the parsers module.
 *
 * Layer: ADAPTER (1_adapters/trigger). The dependency-injected `loadFile`
 * helper handles YAML file resolution + parsing (already provided by app.mjs);
 * this class only knows the file-path layout.
 *
 * @module adapters/trigger/YamlTriggerConfigRepository
 */

import { buildTriggerRegistry } from './parsers/buildTriggerRegistry.mjs';

const PATHS = {
  nfcLocations: 'config/triggers/nfc/locations',
  nfcTags: 'config/triggers/nfc/tags',
  stateLocations: 'config/triggers/state/locations',
};

export class YamlTriggerConfigRepository {
  /**
   * Load all per-modality YAML blobs and assemble the unified trigger registry.
   *
   * @param {Object} args
   * @param {(relativePath: string) => Object|null} args.loadFile  — injected helper
   *   that loads a YAML file relative to the household dir, returning the parsed
   *   object or null if the file is missing.
   * @returns {Object} unified registry: { nfc: { locations, tags }, state: { locations } }
   * @throws {ValidationError} if any YAML is malformed.
   */
  loadRegistry({ loadFile }) {
    const blobs = {
      nfcLocations: loadFile(PATHS.nfcLocations),
      nfcTags: loadFile(PATHS.nfcTags),
      stateLocations: loadFile(PATHS.stateLocations),
    };
    return buildTriggerRegistry(blobs);
  }
}

export default YamlTriggerConfigRepository;
