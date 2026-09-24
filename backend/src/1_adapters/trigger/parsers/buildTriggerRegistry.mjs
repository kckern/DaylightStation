/**
 * Trigger config assembler (v2 — ECA layout). Reads the new config blobs and
 * assembles the internal registry the resolvers consume. The internal shape is
 * unchanged from v1; only the input files changed.
 *
 * Input blobs: { sources, bindingsNfc, responses, endpoints } (raw YAML objects)
 * Output: { nfc:{locations,tags}, state:{locations}, barcode:{locations}, voice:{locations}, responses, endpoints }
 *
 * Layer: ADAPTER (1_adapters/trigger). Pure (no FS).
 * @module adapters/trigger/parsers/buildTriggerRegistry
 */
import { parseSources } from './sourcesParser.mjs';
import { parseNfcTags } from './nfcTagsParser.mjs';
import { parseNamedMap } from './namedMapParser.mjs';

/**
 * @param {Object} [options]
 * @param {Function} [options.onSkip] - per-entry isolation: a bad source or tag is
 *   reported and dropped instead of failing the whole registry (see sourcesParser)
 * @param {Function} [options.onWarn] - config that loads but is probably wrong (see sourcesParser)
 */
export function buildTriggerRegistry(blobs = {}, { onSkip = null, onWarn = null } = {}) {
  const { nfc, state, barcode, voice } = parseSources(blobs.sources, { onSkip, onWarn });
  const knownNfcReaders = new Set(Object.keys(nfc.locations));
  const tags = parseNfcTags(blobs.bindingsNfc, knownNfcReaders, { onSkip });
  return {
    nfc: { locations: nfc.locations, tags },
    state: { locations: state.locations },
    barcode: { locations: barcode.locations },
    voice: { locations: voice.locations },
    responses: parseNamedMap(blobs.responses, 'responses'),
    endpoints: parseNamedMap(blobs.endpoints, 'endpoints'),
  };
}

export default buildTriggerRegistry;
