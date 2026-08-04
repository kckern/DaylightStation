import { DomainInvariantError, ValidationError } from '#domains/core/errors/index.mjs';
import { validateSchoolCalcDeliveryRequest } from './delivery.mjs';

const PLATFORM = /^[a-z][a-z0-9-]{1,31}$/;
const isText = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Enrolled calculator aggregate. Device identity is separate from learner
 * attribution, and calculator observation is separate from desired delivery
 * state.
 *
 * @class SchoolCalcDevice
 */
export class SchoolCalcDevice {
  #deviceId; #label; #platformId; #catalogId; #createdAt; #lastObservedAt;
  #lastRelayId; #capabilityReport; #installedArtifactIds; #desiredArtifactIds;
  #deliveryRequests; #learnerBindings; #revision; #hasObserved;

  constructor(state) {
    validateState(state);
    this.#deviceId = state.deviceId;
    this.#label = state.label;
    this.#platformId = state.platformId;
    this.#catalogId = state.catalogId;
    this.#createdAt = state.createdAt;
    this.#lastObservedAt = state.lastObservedAt ?? null;
    this.#lastRelayId = state.lastRelayId ?? null;
    this.#capabilityReport = state.capabilityReport ? structuredClone(state.capabilityReport) : null;
    this.#installedArtifactIds = [...(state.installedArtifactIds ?? [])];
    this.#desiredArtifactIds = [...(state.desiredArtifactIds ?? [])];
    this.#deliveryRequests = structuredClone(state.deliveryRequests ?? []);
    this.#learnerBindings = structuredClone(state.learnerBindings ?? []);
    this.#revision = state.revision ?? 0;
    this.#hasObserved = state.hasObserved ?? false;
  }

  /** Create a new enrollment from application-supplied identity and time. */
  static enroll({ deviceId, label, platformId, catalogId, createdAt }) {
    return new SchoolCalcDevice({
      deviceId, label, platformId, catalogId, createdAt,
      lastObservedAt: null, lastRelayId: null, capabilityReport: null,
      installedArtifactIds: [], desiredArtifactIds: [], deliveryRequests: [],
      learnerBindings: [],
      revision: 0, hasObserved: false,
    });
  }

  /** Reconstitute an already validated persistence record. */
  static restore(state) { return new SchoolCalcDevice(state); }

  get deviceId() { return this.#deviceId; }
  get label() { return this.#label; }
  get platformId() { return this.#platformId; }
  /** The one authored Catalog projected to this calculator at a time. */
  get catalogId() { return this.#catalogId; }
  get createdAt() { return this.#createdAt; }
  get lastObservedAt() { return this.#lastObservedAt; }
  get lastRelayId() { return this.#lastRelayId; }
  get capabilityReport() { return this.#capabilityReport ? structuredClone(this.#capabilityReport) : null; }
  get installedArtifactIds() { return [...this.#installedArtifactIds]; }
  get desiredArtifactIds() { return [...this.#desiredArtifactIds]; }
  get deliveryRequests() { return structuredClone(this.#deliveryRequests); }
  get learnerBindings() { return structuredClone(this.#learnerBindings); }
  get activeLearnerBindings() {
    return structuredClone(this.#learnerBindings
      .filter(({ active }) => active)
      .sort((left, right) => left.position - right.position));
  }
  get revision() { return this.#revision; }
  get hasObserved() { return this.#hasObserved; }

  /**
   * Resolve the stable compact identity copied into a result when work begins.
   * Historical bindings remain resolvable after a learner leaves the current
   * roster so an old offline queue can never be reattributed or stranded.
   */
  resolveLearnerKey(learnerKey, { activeOnly = false } = {}) {
    if (!Number.isSafeInteger(learnerKey) || learnerKey < 1 || learnerKey > 0xffff) return null;
    const binding = this.#learnerBindings.find((entry) => entry.learnerKey === learnerKey) ?? null;
    if (!binding || (activeOnly && !binding.active)) return null;
    return structuredClone(binding);
  }

  /**
   * Reconcile the configured School learner roster with durable per-device
   * keys. Keys are append-only and are never recycled; current display order
   * is retained separately from historical identity.
   *
   * @returns {{device: SchoolCalcDevice, changed: boolean}}
   */
  synchronizeLearners({ learners, synchronizedAt }) {
    const roster = validateLearners(learners);
    if (!isText(synchronizedAt)) {
      throw new ValidationError('SchoolCalc learner synchronization requires synchronizedAt', {
        code: 'INVALID_SCHOOLCALC_LEARNER_ROSTER',
      });
    }
    const byLearner = new Map(this.#learnerBindings.map((entry) => [entry.learnerId, entry]));
    let nextKey = this.#learnerBindings.reduce((maximum, entry) => Math.max(maximum, entry.learnerKey), 0) + 1;
    const activeIds = new Set(roster.map(({ id }) => id));
    const next = this.#learnerBindings.map((entry) => {
      if (activeIds.has(entry.learnerId)) return entry;
      if (!entry.active) return entry;
      return { ...entry, active: false, retiredAt: synchronizedAt };
    });

    roster.forEach((learner, position) => {
      const prior = byLearner.get(learner.id) ?? null;
      if (!prior) {
        if (nextKey > 0xffff) {
          throw new DomainInvariantError('SchoolCalc learner key space is exhausted', {
            code: 'SCHOOLCALC_LEARNER_KEY_EXHAUSTED', details: { deviceId: this.#deviceId },
          });
        }
        next.push({
          learnerKey: nextKey, learnerId: learner.id, label: learner.name,
          position, active: true, boundAt: synchronizedAt, retiredAt: null,
        });
        nextKey += 1;
        return;
      }
      const index = next.findIndex(({ learnerId }) => learnerId === learner.id);
      next[index] = {
        ...next[index], label: learner.name, position, active: true, retiredAt: null,
      };
    });
    next.sort((left, right) => left.learnerKey - right.learnerKey);
    if (sameBindings(this.#learnerBindings, next)) return { device: this, changed: false };
    return {
      device: this.#copy({ learnerBindings: next, revision: this.#revision + 1 }),
      changed: true,
    };
  }

  /**
   * Apply one server-validated capability/install observation.
   *
   * @returns {SchoolCalcDevice} new aggregate revision
   */
  observe({ capabilityReport, observedAt, relayId }) {
    if (!capabilityReport || capabilityReport.platformId !== this.#platformId) {
      throw new DomainInvariantError('Calculator observation platform does not match enrollment', {
        code: 'SCHOOLCALC_PLATFORM_MISMATCH',
        details: { enrolled: this.#platformId, observed: capabilityReport?.platformId ?? null },
      });
    }
    if (capabilityReport.deviceId && capabilityReport.deviceId !== this.#deviceId) {
      throw new DomainInvariantError('Calculator observation device identity does not match enrollment', {
        code: 'SCHOOLCALC_DEVICE_ID_MISMATCH',
      });
    }
    if (!isText(observedAt) || !isText(relayId)) {
      throw new ValidationError('SchoolCalc observation requires observedAt and relayId', {
        code: 'INVALID_SCHOOLCALC_OBSERVATION',
      });
    }
    const installed = uniqueText(capabilityReport.installedArtifactIds ?? [], 'installedArtifactIds');
    return this.#copy({
      capabilityReport,
      lastObservedAt: observedAt,
      lastRelayId: relayId,
      installedArtifactIds: installed,
      desiredArtifactIds: this.#hasObserved ? this.#desiredArtifactIds : installed,
      hasObserved: true,
      revision: this.#revision + 1,
    });
  }

  /**
   * Claim and apply one install/remove intent.
   *
   * @returns {{device: SchoolCalcDevice, outcome: 'accepted'|'duplicate', entry: object}}
   */
  requestDelivery({ request, recordDigest, resolvedArtifactIds = [], requestedAt }) {
    const validation = validateSchoolCalcDeliveryRequest(request);
    if (validation.errors.length) {
      throw new ValidationError(validation.errors.join('; '), { code: 'INVALID_SCHOOLCALC_DELIVERY_REQUEST' });
    }
    if (request.deviceId !== this.#deviceId) {
      throw new DomainInvariantError('Delivery request device identity does not match enrollment', {
        code: 'SCHOOLCALC_DEVICE_ID_MISMATCH',
      });
    }
    if (!isText(recordDigest) || !isText(requestedAt)) {
      throw new ValidationError('Delivery request requires recordDigest and requestedAt', {
        code: 'INVALID_SCHOOLCALC_DELIVERY_REQUEST',
      });
    }
    const prior = this.#deliveryRequests.find((entry) => entry.requestId === request.requestId);
    if (prior) {
      if (prior.recordDigest !== recordDigest) {
        throw new DomainInvariantError('Delivery request sequence was reused with different content', {
          code: 'SCHOOLCALC_DELIVERY_REQUEST_CONFLICT',
          details: { deviceId: this.#deviceId, requestId: request.requestId },
        });
      }
      return { device: this, outcome: 'duplicate', entry: structuredClone(prior) };
    }

    if (request.action === 'install' && (!Array.isArray(resolvedArtifactIds)
      || resolvedArtifactIds.length === 0
      || !resolvedArtifactIds.every(isText)
      || new Set(resolvedArtifactIds).size !== resolvedArtifactIds.length)) {
      throw new ValidationError('Install request requires unique resolved artifacts', {
        code: 'SCHOOLCALC_ARTIFACT_REQUIRED',
      });
    }
    const artifactIds = request.action === 'install'
      ? [...resolvedArtifactIds]
      : request.artifactIds ?? [request.artifactId];
    const desired = new Set(this.#desiredArtifactIds);
    artifactIds.forEach((artifactId) => {
      if (request.action === 'install') desired.add(artifactId);
      else desired.delete(artifactId);
    });
    const entry = Object.freeze({
      requestId: request.requestId,
      learnerKey: request.learnerKey,
      action: request.action,
      ...(request.address ? { address: request.address } : {}),
      ...(request.installSet ? { installSet: structuredClone(request.installSet) } : {}),
      artifactIds,
      ...(artifactIds.length === 1 ? { artifactId: artifactIds[0] } : {}),
      recordDigest,
      requestedAt,
    });
    return {
      device: this.#copy({
        desiredArtifactIds: [...desired],
        deliveryRequests: [...this.#deliveryRequests, entry],
        revision: this.#revision + 1,
      }),
      outcome: 'accepted',
      entry: structuredClone(entry),
    };
  }

  #copy(overrides) {
    return new SchoolCalcDevice({
      deviceId: this.#deviceId,
      label: this.#label,
      platformId: this.#platformId,
      catalogId: this.#catalogId,
      createdAt: this.#createdAt,
      lastObservedAt: this.#lastObservedAt,
      lastRelayId: this.#lastRelayId,
      capabilityReport: this.#capabilityReport,
      installedArtifactIds: this.#installedArtifactIds,
      desiredArtifactIds: this.#desiredArtifactIds,
      deliveryRequests: this.#deliveryRequests,
      learnerBindings: this.#learnerBindings,
      revision: this.#revision,
      hasObserved: this.#hasObserved,
      ...overrides,
    });
  }
}

function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new ValidationError('SchoolCalc device state must be a mapping', { code: 'INVALID_SCHOOLCALC_DEVICE' });
  }
  if (!isText(state.deviceId) || !isText(state.label) || !PLATFORM.test(state.platformId || '')
      || !isText(state.catalogId) || !isText(state.createdAt)) {
    throw new ValidationError('SchoolCalc device requires deviceId, label, platformId, catalogId, and createdAt', {
      code: 'INVALID_SCHOOLCALC_DEVICE',
    });
  }
  if (!Number.isSafeInteger(state.revision ?? 0) || (state.revision ?? 0) < 0) {
    throw new ValidationError('SchoolCalc device revision must be a non-negative safe integer', { code: 'INVALID_SCHOOLCALC_DEVICE' });
  }
  uniqueText(state.installedArtifactIds ?? [], 'installedArtifactIds');
  uniqueText(state.desiredArtifactIds ?? [], 'desiredArtifactIds');
  if (!Array.isArray(state.deliveryRequests ?? [])) {
    throw new ValidationError('SchoolCalc deliveryRequests must be an array', { code: 'INVALID_SCHOOLCALC_DEVICE' });
  }
  validateBindings(state.learnerBindings ?? []);
}

function validateLearners(learners) {
  if (!Array.isArray(learners)) {
    throw new ValidationError('SchoolCalc learner roster must be an array', { code: 'INVALID_SCHOOLCALC_LEARNER_ROSTER' });
  }
  const ids = new Set();
  return learners.map((learner, index) => {
    if (!learner || typeof learner !== 'object' || Array.isArray(learner)
        || !isText(learner.id) || !isText(learner.name)) {
      throw new ValidationError(`SchoolCalc learner roster entry ${index} is invalid`, {
        code: 'INVALID_SCHOOLCALC_LEARNER_ROSTER',
      });
    }
    if (ids.has(learner.id)) {
      throw new ValidationError(`SchoolCalc learner roster repeats '${learner.id}'`, {
        code: 'INVALID_SCHOOLCALC_LEARNER_ROSTER',
      });
    }
    ids.add(learner.id);
    return { id: learner.id, name: learner.name };
  });
}

function validateBindings(bindings) {
  if (!Array.isArray(bindings)) {
    throw new ValidationError('SchoolCalc learnerBindings must be an array', { code: 'INVALID_SCHOOLCALC_DEVICE' });
  }
  const keys = new Set();
  const ids = new Set();
  bindings.forEach((binding, index) => {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)
        || !Number.isSafeInteger(binding.learnerKey) || binding.learnerKey < 1 || binding.learnerKey > 0xffff
        || !isText(binding.learnerId) || !isText(binding.label)
        || !Number.isSafeInteger(binding.position) || binding.position < 0
        || typeof binding.active !== 'boolean' || !isText(binding.boundAt)
        || (binding.retiredAt !== null && !isText(binding.retiredAt))) {
      throw new ValidationError(`SchoolCalc learner binding ${index} is invalid`, { code: 'INVALID_SCHOOLCALC_DEVICE' });
    }
    if (keys.has(binding.learnerKey) || ids.has(binding.learnerId)) {
      throw new ValidationError('SchoolCalc learner bindings must have unique keys and learners', {
        code: 'INVALID_SCHOOLCALC_DEVICE',
      });
    }
    if (binding.active && binding.retiredAt !== null) {
      throw new ValidationError('Active SchoolCalc learner binding cannot be retired', { code: 'INVALID_SCHOOLCALC_DEVICE' });
    }
    if (!binding.active && !isText(binding.retiredAt)) {
      throw new ValidationError('Inactive SchoolCalc learner binding requires retiredAt', { code: 'INVALID_SCHOOLCALC_DEVICE' });
    }
    keys.add(binding.learnerKey);
    ids.add(binding.learnerId);
  });
}

function sameBindings(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function uniqueText(values, field) {
  if (!Array.isArray(values) || !values.every(isText) || new Set(values).size !== values.length) {
    throw new ValidationError(`SchoolCalc ${field} must contain unique non-empty strings`, {
      code: 'INVALID_SCHOOLCALC_DEVICE',
    });
  }
  return [...values];
}

export default SchoolCalcDevice;
