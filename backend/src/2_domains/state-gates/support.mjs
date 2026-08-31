import { ValidationError } from '#domains/core/errors/index.mjs';

export const SUBJECT_KINDS = Object.freeze(['learner', 'room', 'device', 'household']);
export const PERIOD_KINDS = Object.freeze(['instant', 'local_day', 'local_week', 'interval', 'occurrence']);
export const EVALUATION_STATES = Object.freeze(['satisfied', 'unsatisfied', 'indeterminate', 'not_applicable']);
export const FAILURE_POSTURES = Object.freeze(['fail_open', 'fail_closed']);

export function fail(message, code, field, details) {
  throw new ValidationError(message, { code, field, details });
}

export function requireNonEmpty(value, field, code = 'REQUIRED') {
  if (typeof value !== 'string' || !value.trim()) fail(`${field} is required`, code, field);
  return value.trim();
}

export function requireNamespacedId(value, field) {
  const id = requireNonEmpty(value, field, 'INVALID_ID');
  if (id.length > 160 || !/^[a-z0-9][a-z0-9._:-]*\.[a-z0-9][a-z0-9._:-]*$/i.test(id)) {
    fail(`${field} must be a namespaced identifier`, 'INVALID_ID', field);
  }
  return id;
}

export function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) fail(`${field} must be a positive integer`, 'INVALID_INTEGER', field);
  return value;
}

export function instant(value, field) {
  const result = value instanceof Date ? value.getTime() : value;
  if (!Number.isFinite(result)) fail(`${field} must be an instant`, 'INVALID_INSTANT', field);
  return result;
}

export function optionalInstant(value, field) {
  return value == null ? null : instant(value, field);
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function asEntries(value) {
  if (value instanceof Map) return [...value.entries()];
  return Object.entries(value ?? {});
}

export function asMap(value) {
  return new Map(asEntries(value));
}

const lockedMaps = new WeakSet();

/** A Map-shaped read model whose mutation methods remain unusable after construction. */
export class ReadonlyMap extends Map {
  constructor(entries = []) {
    super(entries);
    lockedMaps.add(this);
    Object.freeze(this);
  }
  set(key, value) {
    if (lockedMaps.has(this)) throw new TypeError('ReadonlyMap cannot be mutated');
    return super.set(key, value);
  }
  delete(key) {
    if (lockedMaps.has(this)) throw new TypeError('ReadonlyMap cannot be mutated');
    return super.delete(key);
  }
  clear() {
    if (lockedMaps.has(this)) throw new TypeError('ReadonlyMap cannot be mutated');
    return super.clear();
  }
}

export function sameSubject(left, right) {
  return left?.kind === right?.kind && left?.id === right?.id;
}

export function samePeriod(left, right) {
  return left?.kind === right?.kind && left?.id === right?.id
    && left?.startsAt === right?.startsAt && (left?.endsAt ?? null) === (right?.endsAt ?? null);
}

export function subjectKey(subject) {
  return `${subject.kind}:${subject.id}`;
}

export function periodKey(period) {
  return `${period.kind}:${period.id}`;
}

export function instanceKey(id, subject, period) {
  return `${id}|${subjectKey(subject)}|${periodKey(period)}`;
}

export function earliestBoundary(...candidates) {
  const values = candidates.flat().filter(Boolean);
  if (!values.length) return null;
  return values.reduce((best, candidate) => candidate.at < best.at ? candidate : best);
}
