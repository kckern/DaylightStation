/**
 * Trigger config assembler. Combines per-modality parsers into a unified
 * in-memory registry consumed by TriggerDispatchService.
 *
 * Layer: ADAPTER (1_adapters/trigger). Pure function (no FS) — the I/O
 * boundary lives in YamlTriggerConfigRepository. This file is split out so
 * the assembly logic is independently testable without filesystem mocking.
 *
 * Output shape:
 *   {
 *     nfc:   { locations: { ... }, tags: { ... } },
 *     state: { locations: { ... } }
 *   }
 *
 * @module adapters/trigger/parsers/buildTriggerRegistry
 */

import { parseNfcLocations } from './nfcLocationsParser.mjs';
import { parseNfcTags } from './nfcTagsParser.mjs';
import { parseStateLocations } from './stateLocationsParser.mjs';

/**
 * @param {Object} blobs
 * @param {Object} [blobs.nfcLocations]   raw YAML object from triggers/nfc/locations.yml
 * @param {Object} [blobs.nfcTags]        raw YAML object from triggers/nfc/tags.yml
 * @param {Object} [blobs.stateLocations] raw YAML object from triggers/state/locations.yml
 * @returns {{ nfc: { locations, tags }, state: { locations } }}
 */
export function buildTriggerRegistry(blobs = {}) {
  const nfcLocations = parseNfcLocations(blobs.nfcLocations);
  const knownNfcReaders = new Set(Object.keys(nfcLocations));
  const nfcTags = parseNfcTags(blobs.nfcTags, knownNfcReaders);
  const stateLocations = parseStateLocations(blobs.stateLocations);

  return {
    nfc: { locations: nfcLocations, tags: nfcTags },
    state: { locations: stateLocations },
  };
}

export default buildTriggerRegistry;
