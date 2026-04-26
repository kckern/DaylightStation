/**
 * Parser for triggers/nfc/tags.yml. Tags are universal — defined once and
 * recognized at any NFC reader. The disambiguation rule for a tag's top-level
 * keys: scalar values (or arrays) are tag-global fields; object values are
 * per-reader override blocks and the key MUST match a registered reader ID
 * (passed in as `knownReaders`). Unknown reader-id object keys throw —
 * this catches typos like `livingrm` instead of `livingroom`.
 *
 * Layer: ADAPTER (1_adapters/trigger).
 *
 * Output shape:
 *   {
 *     [tagUid]: {
 *       global: { ...tagGlobalFields },
 *       overrides: { [readerId]: { ...overrideFields } }
 *     }
 *   }
 *
 * @module adapters/trigger/parsers/nfcTagsParser
 */

import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function parseNfcTags(raw, knownReaders) {
  if (!raw) return {};
  if (!isPlainObject(raw)) {
    throw new ValidationError('nfc/tags.yml root must be an object', { code: 'INVALID_CONFIG_ROOT' });
  }
  if (!(knownReaders instanceof Set)) {
    throw new ValidationError('parseNfcTags requires a Set of known reader IDs', { code: 'INVALID_KNOWN_READERS' });
  }

  const out = {};
  for (const [rawUid, entry] of Object.entries(raw)) {
    if (!isPlainObject(entry)) {
      throw new ValidationError(`tag "${rawUid}" must be an object`, { code: 'INVALID_TAG', field: rawUid });
    }
    const uid = rawUid.toLowerCase();
    const global = {};
    const overrides = {};
    for (const [k, v] of Object.entries(entry)) {
      if (isPlainObject(v)) {
        // Object value -> reader-override block. Key MUST be a registered reader.
        if (!knownReaders.has(k)) {
          throw new ValidationError(
            `tag "${rawUid}": reader-override block "${k}" is not registered (known: ${[...knownReaders].join(', ') || 'none'})`,
            { code: 'UNKNOWN_READER_OVERRIDE', field: rawUid, override: k }
          );
        }
        overrides[k] = v;
      } else {
        // Scalar (or array, or null) -> tag-global field.
        global[k] = v;
      }
    }
    out[uid] = { global, overrides };
  }
  return out;
}

export default parseNfcTags;
