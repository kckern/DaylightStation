/**
 * NFC config parser + validator.
 * @module domains/nfc/NfcConfig
 */

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function parseNfcConfig(raw) {
  if (!raw) return { readers: {}, tags: {} };
  if (!isPlainObject(raw)) {
    throw new Error('nfc config must be an object');
  }

  const readers = {};
  for (const [id, entry] of Object.entries(raw.readers || {})) {
    if (!isPlainObject(entry)) {
      throw new Error(`reader "${id}" must be an object`);
    }
    if (typeof entry.target !== 'string' || entry.target.length === 0) {
      throw new Error(`reader "${id}" must declare a target device (string)`);
    }
    readers[id] = entry;
  }

  const tags = {};
  for (const [uid, entry] of Object.entries(raw.tags || {})) {
    if (!isPlainObject(entry)) {
      throw new Error(`tag "${uid}" must be an object`);
    }
    tags[uid.toLowerCase()] = entry;
  }

  return { readers, tags };
}

export default parseNfcConfig;
