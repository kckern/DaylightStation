/**
 * Trigger config assembler (v2 — ECA layout). Reads the new config blobs and
 * assembles the internal registry the resolvers consume. The internal shape is
 * unchanged from v1; only the input files changed.
 *
 * Input blobs: { sources, bindingsNfc, responses, endpoints } (raw YAML objects)
 * Output: { nfc:{locations,tags}, state:{locations}, responses, endpoints }
 *
 * Layer: ADAPTER (1_adapters/trigger). Pure (no FS).
 * @module adapters/trigger/parsers/buildTriggerRegistry
 */
import { parseSources } from './sourcesParser.mjs';
import { parseNfcTags } from './nfcTagsParser.mjs';
import { parseNamedMap } from './namedMapParser.mjs';

export function buildTriggerRegistry(blobs = {}) {
  const { nfc, state, barcode } = parseSources(blobs.sources);
  const knownNfcReaders = new Set(Object.keys(nfc.locations));
  const tags = parseNfcTags(blobs.bindingsNfc, knownNfcReaders);
  return {
    nfc: { locations: nfc.locations, tags },
    state: { locations: state.locations },
    barcode: { locations: barcode.locations },
    responses: parseNamedMap(blobs.responses, 'responses'),
    endpoints: parseNamedMap(blobs.endpoints, 'endpoints'),
  };
}

export default buildTriggerRegistry;
