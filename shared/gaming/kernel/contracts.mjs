export const GAMING_PROTOCOL_VERSION = 1;

export const SESSION_STATUSES = Object.freeze({
  CREATED: 'created',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  COMPLETE: 'complete',
  ABANDONED: 'abandoned',
});

export const AUTHORITY_STRATEGIES = Object.freeze({
  REMOTE: 'remote',
  CHECKPOINTED_LOCAL: 'checkpointed-local',
  EPHEMERAL: 'ephemeral',
});

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const object = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function validateGameSessionHeader(header) {
  const errors = [];
  if (!object(header)) return { valid: false, errors: ['header must be an object'] };
  if (!ID.test(String(header.session_id || ''))) errors.push('session_id is invalid');
  if (!Object.values(SESSION_STATUSES).includes(header.status)) errors.push('status is invalid');
  if (!ID.test(String(header.ruleset?.id || ''))) errors.push('ruleset.id is invalid');
  if (!Number.isInteger(header.ruleset?.version) || header.ruleset.version < 1) errors.push('ruleset.version must be a positive integer');
  if (header.ruleset?.definition_hash != null && !HASH.test(header.ruleset.definition_hash)) errors.push('ruleset.definition_hash is invalid');
  for (const [kind, artifact] of Object.entries(header.artifacts || {})) {
    if (!ID.test(String(kind)) || !ID.test(String(artifact?.id || '')) || !HASH.test(String(artifact?.hash || ''))) errors.push(`artifact reference is invalid: ${kind}`);
  }
  if (!Number.isInteger(header.revision) || header.revision < 0) errors.push('revision must be a non-negative integer');
  if (!Number.isInteger(header.seed) || header.seed < 0 || header.seed > 0xffffffff) errors.push('seed must be an unsigned 32-bit integer');
  if (!Array.isArray(header.participants)) errors.push('participants must be an array');
  if (!Array.isArray(header.seats)) errors.push('seats must be an array');
  if (header.experience != null && (!ID.test(String(header.experience.id || '')) || !Number.isInteger(header.experience.version) || !ID.test(String(header.experience.native_surface_id || '')) || !HASH.test(String(header.experience.manifest_hash || '')))) errors.push('experience reference is invalid');
  return { valid: errors.length === 0, errors };
}

export function validateCommandEnvelope(envelope) {
  const errors = [];
  if (!object(envelope)) return { valid: false, errors: ['command envelope must be an object'] };
  if (!ID.test(String(envelope.command_id || ''))) errors.push('command_id is invalid');
  if (!ID.test(String(envelope.actor_id || ''))) errors.push('actor_id is invalid');
  if (!Number.isInteger(envelope.expected_revision) || envelope.expected_revision < 0) errors.push('expected_revision must be a non-negative integer');
  if (!Number.isFinite(envelope.logical_time) || envelope.logical_time < 0) errors.push('logical_time must be non-negative');
  if (!object(envelope.command) || !ID.test(String(envelope.command.type || ''))) errors.push('command.type is invalid');
  if (envelope.causation_id != null && !ID.test(String(envelope.causation_id))) errors.push('causation_id is invalid');
  if (envelope.correlation_id != null && !ID.test(String(envelope.correlation_id))) errors.push('correlation_id is invalid');
  return { valid: errors.length === 0, errors };
}

export function validateEventEnvelope(envelope) {
  const errors = [];
  if (!object(envelope)) return { valid: false, errors: ['event envelope must be an object'] };
  if (!ID.test(String(envelope.event_id || ''))) errors.push('event_id is invalid');
  if (!Number.isInteger(envelope.revision) || envelope.revision < 1) errors.push('revision must be a positive integer');
  if (!ID.test(String(envelope.causation_id || ''))) errors.push('causation_id is invalid');
  if (!ID.test(String(envelope.correlation_id || ''))) errors.push('correlation_id is invalid');
  if (!object(envelope.event) || !ID.test(String(envelope.event.type || ''))) errors.push('event.type is invalid');
  if (typeof envelope.recorded_at !== 'string' || Number.isNaN(Date.parse(envelope.recorded_at))) errors.push('recorded_at is invalid');
  return { valid: errors.length === 0, errors };
}

export function assertValid(validation, label = 'Gaming contract') {
  if (!validation.valid) throw Object.assign(new Error(`${label}: ${validation.errors.join('; ')}`), { code: 'invalid_contract', details: validation.errors });
}

export function createGameSessionHeader({ sessionId, ruleset, experience = null, artifacts = {}, seed, participants = [], seats = [], status = SESSION_STATUSES.ACTIVE }) {
  const header = {
    protocol_version: GAMING_PROTOCOL_VERSION,
    session_id: sessionId,
    status,
    ruleset: structuredClone(ruleset),
    ...(experience ? { experience: structuredClone(experience) } : {}),
    artifacts: structuredClone(artifacts),
    revision: 0,
    seed: Number(seed) >>> 0,
    participants: structuredClone(participants),
    seats: structuredClone(seats),
  };
  assertValid(validateGameSessionHeader(header), 'GameSessionHeader');
  return header;
}
