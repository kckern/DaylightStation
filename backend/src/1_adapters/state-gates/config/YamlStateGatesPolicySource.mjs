import crypto from 'node:crypto';
import moment from 'moment';
import { IStateGatesPolicySource } from '#apps/state-gates/ports/IStateGatesPolicySource.mjs';

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

const ISO_DURATION = /^P(?:(?:\d+(?:[.,]\d+)?W)|(?:(?:\d+(?:[.,]\d+)?Y)?(?:\d+(?:[.,]\d+)?M)?(?:\d+(?:[.,]\d+)?D)?(?:T(?=\d)(?:\d+(?:[.,]\d+)?H)?(?:\d+(?:[.,]\d+)?M)?(?:\d+(?:[.,]\d+)?S)?)?))$/i;

function invalidDuration(field) {
  return Object.assign(new Error(`${field} must be finite non-negative milliseconds or an ISO-8601 duration`), {
    name: 'ValidationError', code: 'INVALID_DURATION', field,
  });
}

function durationMs(value, field) {
  if (value == null) return null;
  if (typeof value === 'number') {
    if (Number.isFinite(value) && value >= 0) return value;
    throw invalidDuration(field);
  }
  if (typeof value !== 'string' || !/[0-9]/.test(value) || !ISO_DURATION.test(value)) {
    throw invalidDuration(field);
  }
  const parsed = moment.duration(value.replaceAll(',', '.'));
  const milliseconds = parsed.asMilliseconds();
  if (!parsed.isValid() || !Number.isFinite(milliseconds) || milliseconds < 0) throw invalidDuration(field);
  return milliseconds;
}

function binding(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') return value;
  return { kind: value.kind, id: value.id };
}

function selector(raw = {}) {
  return {
    claimTypeId: raw.type ?? raw.claim_type_id,
    publisherId: raw.publisher ?? raw.publisher_id,
    subject: binding(raw.subject, '$subject'),
    period: binding(raw.period, '$period'),
  };
}

function expression(raw, path = 'expression') {
  if (!raw || typeof raw !== 'object') return raw;
  if (raw.kind) return { ...raw, nodeId: raw.nodeId ?? path };
  if (raw.claim) return { kind: 'claim', ...selector(raw.claim), nodeId: path };
  if (raw.reference) {
    const value = typeof raw.reference === 'string' ? raw.reference : raw.reference.gate ?? raw.reference.gate_id;
    return { kind: 'reference', gateId: value, nodeId: path };
  }
  if (raw.all) return { kind: 'all', children: raw.all.map((child, index) => expression(child, `${path}/${index}`)), nodeId: path };
  if (raw.any) return { kind: 'any', children: raw.any.map((child, index) => expression(child, `${path}/${index}`)), nodeId: path };
  if (raw.not) return { kind: 'not', child: expression(raw.not, `${path}/not`), nodeId: path };
  if (raw.comparison) {
    const literal = raw.comparison.value;
    return {
      kind: 'comparison', claim: selector(raw.comparison.claim), op: raw.comparison.op,
      value: literal && typeof literal === 'object' && 'amount' in literal ? literal.amount : literal,
      unit: literal && typeof literal === 'object' ? literal.unit : undefined,
      nodeId: path,
    };
  }
  if (raw.count) {
    const threshold = raw.count.threshold ?? {};
    return {
      kind: 'count', over: raw.count.over, as: raw.count.as,
      where: expression(raw.count.where, `${path}/where`),
      threshold: {
        ...(threshold.at_least != null ? { atLeast: threshold.at_least } : {}),
        ...(threshold.at_most != null ? { atMost: threshold.at_most } : {}),
        ...(threshold.exactly != null ? { exactly: threshold.exactly } : {}),
      },
      nodeId: path,
    };
  }
  if (raw.schedule) return { kind: 'schedule', days: raw.schedule.days, start: raw.schedule.start, end: raw.schedule.end, nodeId: path };
  return raw;
}

function progressProjection(id, value) {
  if (!value) return null;
  if (value.basis_node_id) return { basisNodeId: value.basis_node_id };
  if (typeof value.from !== 'string') return { ...value };
  const suffix = value.from.replace(/^\/(all|any|not|count)/, '');
  return { basisNodeId: `${id}/expression${suffix}` };
}

function claimType(id, raw) {
  return {
    id,
    schemaVersion: raw.schema_version,
    valueSchema: {
      ...raw.value,
      maxLength: raw.value?.max_length ?? raw.value?.maxLength,
    },
    subjectKinds: raw.subject_kinds,
    periodKinds: raw.period_kinds,
    acceptedPublishers: raw.accepted_publishers,
    visibility: raw.visibility,
    validity: {
      maxAgeMs: durationMs(raw.validity?.max_age, `claim_types.${id}.validity.max_age`),
      maxFutureSkewMs: durationMs(raw.validity?.max_future_skew, `claim_types.${id}.validity.max_future_skew`) ?? 0,
      mustFitPeriod: raw.validity?.must_fit_period,
      actorRequired: raw.validity?.actor_required,
      acceptedActorRoles: raw.validity?.accepted_actor_roles,
    },
  };
}

export class YamlStateGatesPolicySource extends IStateGatesPolicySource {
  #load;
  constructor({ load }) {
    super();
    if (typeof load !== 'function') throw new Error('YamlStateGatesPolicySource requires load');
    this.#load = load;
  }

  async loadCandidate(householdId) {
    const raw = await this.#load(householdId);
    if (!raw) {
      const error = new Error('State Gates policy source is missing');
      error.name = 'ValidationError';
      error.code = 'POLICY_SOURCE_MISSING';
      throw error;
    }
    if (raw.schema !== 'daylight.state-gates-policy/v1') {
      const error = new Error('Unsupported gates policy schema');
      error.name = 'ValidationError';
      error.code = 'UNSUPPORTED_POLICY_SCHEMA';
      throw error;
    }
    const candidate = {
      schemaVersion: 1,
      policyRevision: raw.policy_revision,
      publishers: Object.fromEntries(Object.entries(raw.publishers ?? {}).map(([id, value]) => [id, { ...value }])),
      subjectSets: Object.fromEntries(Object.entries(raw.subject_sets ?? {}).map(([id, value]) => [id, (value.members ?? []).map(member => ({ kind: value.kind, id: member }))])),
      claimTypes: Object.fromEntries(Object.entries(raw.claim_types ?? {}).map(([id, value]) => [id, claimType(id, value)])),
      gates: Object.fromEntries(Object.entries(raw.gates ?? {}).map(([id, value]) => [id, {
        id,
        schemaVersion: value.schema_version,
        subjectKinds: value.subject_kinds,
        periodKinds: value.period_kinds,
        expression: expression(value.expression, `${id}/expression`),
        progress: progressProjection(id, value.progress),
        reasonLabels: value.reason_labels ?? {},
      }])),
      entitlements: Object.fromEntries(Object.entries(raw.entitlements ?? {}).map(([id, value]) => [id, {
        capabilityId: id,
        gateId: value.gate,
        failurePosture: value.failure_posture,
      }])),
    };
    candidate.digest = crypto.createHash('sha256').update(canonical(candidate)).digest('hex');
    return freeze(candidate);
  }
}

export default YamlStateGatesPolicySource;
