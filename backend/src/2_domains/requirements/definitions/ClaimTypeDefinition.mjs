import {
  PERIOD_KINDS, SUBJECT_KINDS, deepFreeze, fail, requireNamespacedId, requirePositiveInteger,
} from '../support.mjs';

const VALUE_KINDS = new Set(['boolean', 'integer', 'number', 'string', 'enum', 'duration']);

function nonEmptySet(values, field, allowed = null) {
  const result = [...new Set(values ?? [])];
  if (!result.length) fail(`${field} must not be empty`, 'EMPTY_SET', field);
  if (allowed && result.some(value => !allowed.includes(value))) fail(`${field} contains an unsupported value`, 'UNSUPPORTED_VALUE', field);
  return result;
}

export function validateTypedValue(schema, value, field = 'value') {
  switch (schema.type) {
    case 'boolean':
      if (typeof value !== 'boolean') fail(`${field} must be boolean`, 'VALUE_TYPE_MISMATCH', field);
      break;
    case 'integer':
      if (!Number.isInteger(value)) fail(`${field} must be an integer`, 'VALUE_TYPE_MISMATCH', field);
      break;
    case 'number':
    case 'duration':
      if (!Number.isFinite(value)) fail(`${field} must be a finite number`, 'VALUE_TYPE_MISMATCH', field);
      break;
    case 'string':
      if (typeof value !== 'string') fail(`${field} must be a string`, 'VALUE_TYPE_MISMATCH', field);
      if (schema.maxLength && value.length > schema.maxLength) fail(`${field} is too long`, 'VALUE_TOO_LONG', field);
      if (schema.pattern && !(new RegExp(schema.pattern, 'u')).test(value)) fail(`${field} has invalid format`, 'VALUE_PATTERN_MISMATCH', field);
      break;
    case 'enum':
      if (!schema.values.includes(value)) fail(`${field} is not an allowed enum value`, 'VALUE_NOT_ALLOWED', field);
      break;
    default:
      fail('Unsupported value schema', 'UNSUPPORTED_VALUE_SCHEMA', field);
  }
  if (typeof value === 'number') {
    if (schema.min != null && value < schema.min) fail(`${field} is below minimum`, 'VALUE_BELOW_MIN', field);
    if (schema.max != null && value > schema.max) fail(`${field} is above maximum`, 'VALUE_ABOVE_MAX', field);
  }
  return value;
}

export class ClaimTypeDefinition {
  constructor({
    id, schemaVersion, valueSchema, subjectKinds, periodKinds, acceptedPublishers,
    visibility = 'subscriber', validity = {},
  }) {
    this.id = requireNamespacedId(id, 'claimType.id');
    this.schemaVersion = requirePositiveInteger(schemaVersion, 'claimType.schemaVersion');
    if (!valueSchema || !VALUE_KINDS.has(valueSchema.type)) fail('Unsupported value schema', 'UNSUPPORTED_VALUE_SCHEMA', 'valueSchema');
    if (valueSchema.type === 'enum' && (!Array.isArray(valueSchema.values) || !valueSchema.values.length)) {
      fail('Enum values must not be empty', 'EMPTY_ENUM', 'valueSchema.values');
    }
    if (valueSchema.type === 'string' && (!Number.isInteger(valueSchema.maxLength) || valueSchema.maxLength < 1)) {
      fail('String maxLength is required', 'INVALID_MAX_LENGTH', 'valueSchema.maxLength');
    }
    if (valueSchema.pattern) {
      try { new RegExp(valueSchema.pattern, 'u'); }
      catch { fail('String pattern is invalid', 'INVALID_PATTERN', 'valueSchema.pattern'); }
    }
    if (valueSchema.type === 'duration' && !valueSchema.unit) fail('Duration unit is required', 'UNIT_REQUIRED', 'valueSchema.unit');
    this.valueSchema = deepFreeze({ ...valueSchema, values: valueSchema.values ? [...valueSchema.values] : undefined });
    this.subjectKinds = deepFreeze(nonEmptySet(subjectKinds, 'claimType.subjectKinds', SUBJECT_KINDS));
    this.periodKinds = deepFreeze(nonEmptySet(periodKinds, 'claimType.periodKinds', PERIOD_KINDS));
    this.acceptedPublishers = deepFreeze(nonEmptySet(acceptedPublishers, 'claimType.acceptedPublishers'));
    if (!['subscriber', 'administrative'].includes(visibility)) fail('Invalid claim visibility', 'INVALID_VISIBILITY', 'visibility');
    this.visibility = visibility;
    this.validity = deepFreeze({
      maxAgeMs: validity.maxAgeMs ?? null,
      maxFutureSkewMs: validity.maxFutureSkewMs ?? 0,
      mustFitPeriod: validity.mustFitPeriod === true,
      actorRequired: validity.actorRequired === true,
      acceptedActorRoles: [...new Set(validity.acceptedActorRoles ?? [])],
    });
    for (const [field, value] of [['maxAgeMs', this.validity.maxAgeMs], ['maxFutureSkewMs', this.validity.maxFutureSkewMs]]) {
      if (value != null && (!Number.isFinite(value) || value < 0)) fail(`${field} must be a non-negative duration`, 'INVALID_DURATION', `validity.${field}`);
    }
    deepFreeze(this);
  }

  validateValue(value) { return validateTypedValue(this.valueSchema, value); }
}

export default ClaimTypeDefinition;
