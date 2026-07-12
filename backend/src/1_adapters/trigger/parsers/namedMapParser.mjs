/**
 * Parser for shallow name->object config maps (responses.yml, endpoints.yml).
 * Validated pass-through; deep spec validation happens where consumed.
 * Layer: ADAPTER (1_adapters/trigger/parsers).
 * @module adapters/trigger/parsers/namedMapParser
 */
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

export function parseNamedMap(raw, label = 'named map') {
  if (!raw) return {};
  if (!isPlainObject(raw)) {
    throw new ValidationError(`${label} root must be an object`, { code: 'INVALID_CONFIG_ROOT' });
  }
  const out = {};
  for (const [name, spec] of Object.entries(raw)) {
    if (!isPlainObject(spec)) {
      throw new ValidationError(`${label} entry "${name}" must be an object`, { code: 'INVALID_NAMED_ENTRY', field: name });
    }
    out[name] = spec;
  }
  return out;
}

export default parseNamedMap;
