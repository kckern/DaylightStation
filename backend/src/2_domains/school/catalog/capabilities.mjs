/**
 * Learning-client capability identifiers are published contracts, not feature
 * flags. `name@version` names one exact schema/behavior version; a future
 * incompatible version is a different capability and is never guessed to be
 * backward compatible.
 */
export const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9.-]{0,63}@[1-9][0-9]*$/;

/**
 * Parse one exact capability identifier.
 *
 * @param {*} value
 * @returns {{id: string, name: string, version: number}|null}
 */
export function parseCapabilityId(value) {
  if (typeof value !== 'string' || !CAPABILITY_ID_PATTERN.test(value)) return null;
  const separator = value.lastIndexOf('@');
  return Object.freeze({
    id: value,
    name: value.slice(0, separator),
    version: Number.parseInt(value.slice(separator + 1), 10),
  });
}

/**
 * Validate and deduplicate a capability list while retaining authored order.
 *
 * @param {*} raw
 * @param {{path?: string, required?: boolean}} options
 * @returns {{errors: string[], capabilities: string[]}}
 */
export function validateCapabilityList(raw, { path = 'capabilities', required = false } = {}) {
  if (raw === undefined && !required) return { errors: [], capabilities: [] };
  if (!Array.isArray(raw) || (required && raw.length === 0)) {
    return { errors: [`${path}: must be ${required ? 'a non-empty' : 'an'} array of capability identifiers`], capabilities: [] };
  }

  const errors = [];
  const capabilities = [];
  const seen = new Set();
  raw.forEach((value, index) => {
    if (!parseCapabilityId(value)) {
      errors.push(`${path}[${index}]: must look like name@version`);
      return;
    }
    if (seen.has(value)) {
      errors.push(`${path}[${index}]: duplicate capability '${value}'`);
      return;
    }
    seen.add(value);
    capabilities.push(value);
  });
  return { errors, capabilities };
}

/** Exact capability-set comparison used by every calculator-family adapter. */
export function missingCapabilities(required = [], available = []) {
  const offered = new Set(available);
  return [...new Set(required)].filter((capability) => !offered.has(capability));
}
