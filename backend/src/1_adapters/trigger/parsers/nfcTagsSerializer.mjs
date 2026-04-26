/**
 * Inverse of parseNfcTags: turns the parsed { [uid]: { global, overrides } }
 * shape back into the flat on-disk YAML shape so the repository can write
 * mutations to disk.
 *
 * Layer: ADAPTER (1_adapters/trigger/parsers).
 *
 * Input shape (from parseNfcTags):
 *   { [uid]: { global: {...scalar/array fields...}, overrides: { [readerId]: {...} } } }
 *
 * Output shape (matches tags.yml):
 *   { [uid]: { ...globalFields, [readerId]: { ...overrideFields }, ... } }
 *
 * @module adapters/trigger/parsers/nfcTagsSerializer
 */

export function serializeNfcTags(parsedTags) {
  const out = {};
  for (const [uid, entry] of Object.entries(parsedTags || {})) {
    const flat = { ...(entry.global || {}) };
    for (const [readerId, overrideBlock] of Object.entries(entry.overrides || {})) {
      flat[readerId] = overrideBlock;
    }
    out[uid] = flat;
  }
  return out;
}

export default serializeNfcTags;
