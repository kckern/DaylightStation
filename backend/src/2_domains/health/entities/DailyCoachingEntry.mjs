/**
 * DailyCoachingEntry Value Object (PRD F-001 / F2-A)
 *
 * Represents the `coaching` field inside a daily health entry. The shape is
 * declared per-user in playbook YAML under `coaching_dimensions`, so this
 * entity is now generic — it validates against whatever dimension schema is
 * passed in.
 *
 * Constructor: `new DailyCoachingEntry(raw, dimensionsSchema)`
 *
 * `dimensionsSchema` is an array of dimension declarations:
 *   [
 *     {
 *       key: 'post_workout_protein',
 *       type: 'boolean' | 'numeric' | 'text',
 *       label?: string,
 *       fields: { <fieldKey>: { type, required?, min?, max?, max_length? } },
 *       thresholds?: { ... },
 *       cta_text?: string,
 *     },
 *     ...
 *   ]
 *
 * If `dimensionsSchema` is undefined or empty, the entity falls back to
 * "trust mode" — it accepts any plain-object shape, performing only minimal
 * sanity checks. This degrades gracefully for users without a playbook.
 *
 * Validation rules (when schema is provided):
 *   - boolean type: payload must be an object; the field marked
 *     `required: true` with `type: boolean` must be present and a boolean.
 *     Other declared fields are validated by declared type.
 *   - numeric type: payload must be an object; declared numeric fields must
 *     match `type` (integer/number) and respect `min`/`max` if declared.
 *     String fields validated as strings.
 *   - text type: payload may be a bare string (taken as the single required
 *     string field's value) OR an object whose required string field
 *     matches `max_length` if declared.
 *   - Unknown top-level keys (not in `dimensionsSchema`) are rejected.
 *   - Unknown sub-keys (not in `fields`) are rejected.
 *
 * @module domains/health/entities
 */

const SUPPORTED_TYPES = new Set(['boolean', 'numeric', 'text']);

/**
 * Find the single required field marked with `type: <typeName>`. Used to
 * resolve which sub-field carries a boolean/text dimension's value when the
 * caller passes a bare scalar instead of an object.
 */
function findRequiredFieldOfType(dim, typeName) {
  if (!dim?.fields || typeof dim.fields !== 'object') return null;
  for (const [name, decl] of Object.entries(dim.fields)) {
    if (decl?.required && decl?.type === typeName) {
      return { name, decl };
    }
  }
  return null;
}

function findFirstFieldOfType(dim, typeName) {
  if (!dim?.fields || typeof dim.fields !== 'object') return null;
  for (const [name, decl] of Object.entries(dim.fields)) {
    if (decl?.type === typeName) {
      return { name, decl };
    }
  }
  return null;
}

function validateScalar(value, decl, contextLabel) {
  const type = decl?.type;
  if (type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new TypeError(`${contextLabel} must be a boolean (strict — no string coercion)`);
    }
    return value;
  }
  if (type === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new TypeError(`${contextLabel} must be an integer`);
    }
    if (typeof decl.min === 'number' && value < decl.min) {
      throw new RangeError(`${contextLabel} must be >= ${decl.min} (got ${value})`);
    }
    if (typeof decl.max === 'number' && value > decl.max) {
      throw new RangeError(`${contextLabel} must be <= ${decl.max} (got ${value})`);
    }
    return value;
  }
  if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`${contextLabel} must be a finite number`);
    }
    if (typeof decl.min === 'number' && value < decl.min) {
      throw new RangeError(`${contextLabel} must be >= ${decl.min} (got ${value})`);
    }
    if (typeof decl.max === 'number' && value > decl.max) {
      throw new RangeError(`${contextLabel} must be <= ${decl.max} (got ${value})`);
    }
    return value;
  }
  if (type === 'string') {
    if (typeof value !== 'string') {
      throw new TypeError(`${contextLabel} must be a string`);
    }
    if (decl.required && value.length === 0) {
      throw new TypeError(`${contextLabel} must be a non-empty string`);
    }
    if (typeof decl.max_length === 'number' && value.length > decl.max_length) {
      throw new RangeError(
        `${contextLabel} exceeds ${decl.max_length} chars (got ${value.length})`,
      );
    }
    return value;
  }
  // Unknown declared type — reject defensively. (Schemas should only declare
  // boolean/integer/number/string for sub-fields.)
  throw new TypeError(`${contextLabel}: unsupported declared type "${type}"`);
}

function parseBooleanDimension(raw, dim) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`DailyCoachingEntry.${dim.key} must be an object`);
  }
  const fieldDecls = dim.fields || {};
  const validKeys = new Set(Object.keys(fieldDecls));
  for (const key of Object.keys(raw)) {
    if (!validKeys.has(key)) {
      throw new Error(`DailyCoachingEntry.${dim.key}: unknown key "${key}"`);
    }
  }

  // Find the required boolean field. If schema doesn't declare one, accept
  // the object as-is (trusting the caller's shape).
  const required = findRequiredFieldOfType(dim, 'boolean');
  if (required && (raw[required.name] === undefined || raw[required.name] === null)) {
    throw new TypeError(
      `DailyCoachingEntry.${dim.key}.${required.name} is required and must be a boolean`,
    );
  }

  const out = {};
  for (const [fieldName, decl] of Object.entries(fieldDecls)) {
    const value = raw[fieldName];
    if (value === undefined || value === null) {
      if (decl.required) {
        throw new TypeError(`DailyCoachingEntry.${dim.key}.${fieldName} is required`);
      }
      continue;
    }
    out[fieldName] = validateScalar(
      value,
      decl,
      `DailyCoachingEntry.${dim.key}.${fieldName}`,
    );
  }
  return out;
}

function parseNumericDimension(raw, dim) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`DailyCoachingEntry.${dim.key} must be an object`);
  }
  const fieldDecls = dim.fields || {};
  const validKeys = new Set(Object.keys(fieldDecls));
  for (const key of Object.keys(raw)) {
    if (!validKeys.has(key)) {
      throw new Error(`DailyCoachingEntry.${dim.key}: unknown key "${key}"`);
    }
  }

  const out = {};
  for (const [fieldName, decl] of Object.entries(fieldDecls)) {
    const value = raw[fieldName];
    if (value === undefined || value === null) {
      if (decl.required) {
        throw new TypeError(`DailyCoachingEntry.${dim.key}.${fieldName} is required`);
      }
      continue;
    }
    out[fieldName] = validateScalar(
      value,
      decl,
      `DailyCoachingEntry.${dim.key}.${fieldName}`,
    );
  }
  return out;
}

/**
 * For text dimensions, accept either:
 *   - a bare string (mapped to the required string field's value); OR
 *   - an object with the required string field
 * Returns either a trimmed string (when only one required field is declared
 * and the input is bare) or an object payload. An empty/whitespace-only
 * value collapses to `null` (treated as absent).
 */
function parseTextDimension(raw, dim) {
  if (raw === undefined || raw === null) return null;

  const fieldDecls = dim.fields || {};
  const required = findRequiredFieldOfType(dim, 'string')
    || findFirstFieldOfType(dim, 'string');

  if (typeof raw === 'string') {
    if (!required) {
      // Schema didn't declare a string field — this is a malformed schema,
      // but we don't reject the caller's value. Treat it as-is.
      const trimmed = raw.trim();
      return trimmed.length === 0 ? null : trimmed;
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    validateScalar(trimmed, required.decl, `DailyCoachingEntry.${dim.key}`);
    // For ergonomic backward-compat, return the bare string when the
    // declaration is a single-field text shape. Object shape is preserved
    // when the caller explicitly passes an object.
    return trimmed;
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`DailyCoachingEntry.${dim.key} must be a string or object`);
  }

  const validKeys = new Set(Object.keys(fieldDecls));
  for (const key of Object.keys(raw)) {
    if (!validKeys.has(key)) {
      throw new Error(`DailyCoachingEntry.${dim.key}: unknown key "${key}"`);
    }
  }

  const out = {};
  for (const [fieldName, decl] of Object.entries(fieldDecls)) {
    const value = raw[fieldName];
    if (value === undefined || value === null) {
      if (decl.required) {
        throw new TypeError(`DailyCoachingEntry.${dim.key}.${fieldName} is required`);
      }
      continue;
    }
    if (decl.type === 'string') {
      const trimmed = typeof value === 'string' ? value.trim() : value;
      if (typeof trimmed === 'string' && trimmed.length === 0) {
        if (decl.required) {
          throw new TypeError(`DailyCoachingEntry.${dim.key}.${fieldName} must be non-empty`);
        }
        continue;
      }
      out[fieldName] = validateScalar(
        trimmed,
        decl,
        `DailyCoachingEntry.${dim.key}.${fieldName}`,
      );
    } else {
      out[fieldName] = validateScalar(
        value,
        decl,
        `DailyCoachingEntry.${dim.key}.${fieldName}`,
      );
    }
  }
  // If every required field was empty/absent, treat as null.
  if (Object.keys(out).length === 0) return null;
  return out;
}

export class DailyCoachingEntry {
  /**
   * @param {Object} [raw] - Raw object as parsed from YAML / API body.
   * @param {Array<Object>|null} [dimensionsSchema] - Playbook's
   *   `coaching_dimensions` array. When omitted/empty, the entity runs in
   *   trust mode (accepts any plain-object shape after a basic check).
   * @param {Object} [opts]
   * @param {Object} [opts.logger] - Logger for trust-mode warning.
   */
  constructor(raw = {}, dimensionsSchema = null, opts = {}) {
    if (raw === null || raw === undefined) raw = {};
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError('DailyCoachingEntry expects an object');
    }

    this.dimensions = {};
    this.schema = Array.isArray(dimensionsSchema) ? dimensionsSchema : [];

    if (!this.schema.length) {
      // Trust mode — no schema available. Accept the input as-is so users
      // without a playbook can still persist coaching entries.
      const logger = opts.logger || (typeof console !== 'undefined' ? console : null);
      logger?.warn?.('daily_coaching_entry.trust_mode', {
        reason: 'no_dimensions_schema',
        keys: Object.keys(raw),
      });
      // Shallow clone to preserve the input shape under serialize().
      for (const [key, value] of Object.entries(raw)) {
        this.dimensions[key] = (value === null || value === undefined)
          ? null
          : (typeof value === 'object' ? { ...value } : value);
      }
      return;
    }

    const declaredKeys = new Set(this.schema.map(d => d.key));
    for (const key of Object.keys(raw)) {
      if (!declaredKeys.has(key)) {
        throw new Error(`DailyCoachingEntry: unknown top-level key "${key}"`);
      }
    }

    for (const dim of this.schema) {
      if (!dim || !dim.key) continue;
      if (!SUPPORTED_TYPES.has(dim.type)) {
        throw new TypeError(
          `DailyCoachingEntry: unsupported dimension type "${dim.type}" for key "${dim.key}"`,
        );
      }
      const rawValue = raw[dim.key];
      let parsed;
      if (dim.type === 'boolean') parsed = parseBooleanDimension(rawValue, dim);
      else if (dim.type === 'numeric') parsed = parseNumericDimension(rawValue, dim);
      else if (dim.type === 'text') parsed = parseTextDimension(rawValue, dim);
      this.dimensions[dim.key] = parsed === undefined ? null : parsed;
    }
  }

  /**
   * Look up the parsed value for a declared dimension. Returns null when the
   * dimension was not present in the raw input.
   */
  get(key) {
    if (!Object.prototype.hasOwnProperty.call(this.dimensions, key)) return null;
    const value = this.dimensions[key];
    return value === undefined ? null : value;
  }

  /**
   * Convert to a YAML-shaped plain object for persistence.
   * Only present (non-null, non-undefined) dimensions are included.
   * @returns {Object}
   */
  serialize() {
    const out = {};
    for (const [key, value] of Object.entries(this.dimensions)) {
      if (value === null || value === undefined) continue;
      if (typeof value === 'object') {
        // Skip objects that ended up empty (e.g. all optional fields absent).
        if (Object.keys(value).length === 0) continue;
        out[key] = { ...value };
      } else {
        out[key] = value;
      }
    }
    return out;
  }
}

export default DailyCoachingEntry;
