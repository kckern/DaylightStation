import path from 'node:path';
import { IRemediationSessionRepository } from '#apps/school/ports/IRemediationSessionRepository.mjs';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';
import { loadYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/;
const RECORD_SCHEMA = 'school.remediation-session-record/v1';
const AVAILABLE = new Set(['offered', 'active']);

/** Atomic YAML persistence for the generic School remediation aggregate. */
export class YamlRemediationSessionRepository extends IRemediationSessionRepository {
  #directory; #io; #writeChain = Promise.resolve();

  constructor({ directory, io = {} } = {}) {
    super();
    if (typeof directory !== 'string' || !directory) {
      throw new Error('YamlRemediationSessionRepository requires directory');
    }
    this.#directory = directory;
    this.#io = { load: io.load ?? loadYamlFromPath, save: io.save ?? saveYamlToPathAtomic };
  }

  async createOffer(session) {
    return this.#mutate(session.sessionId, (record, exists) => {
      if (exists) {
        if (record.session.source?.externalId !== session.source?.externalId
            || record.session.learnerId !== session.learnerId) {
          throw invariant('Remediation session ID collision', 'REMEDIATION_SESSION_COLLISION');
        }
        return { status: 'existing', session: structuredClone(record.session) };
      }
      record.session = structuredClone(session);
      return { status: 'created', session: structuredClone(record.session) };
    });
  }

  async getSession(sessionId) {
    return structuredClone(this.#load(sessionId, false)?.session ?? null);
  }

  async listAvailable({ surface, endpointId = null, learnerIds = [] }) {
    if (!nonEmpty(surface)
        || (endpointId !== null && !nonEmpty(endpointId))
        || !Array.isArray(learnerIds)
        || learnerIds.some((learnerId) => !nonEmpty(learnerId))
        || (endpointId === null && learnerIds.length === 0)) {
      throw new Error('Remediation source surface and endpoint or learners are required');
    }
    const learners = new Set(learnerIds);
    const index = this.#io.load(path.join(this.#directory, '_index.yml'));
    const ids = Array.isArray(index?.sessionIds) ? index.sessionIds : [];
    return ids.map((sessionId) => this.#load(sessionId, false)?.session ?? null)
      .filter((session) => session
        && session.source?.surface === surface
        && (endpointId === null || session.source?.endpointId === endpointId)
        && (learners.size === 0 || learners.has(session.learnerId))
        && AVAILABLE.has(session.status))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((session) => structuredClone(session));
  }

  async claimAction({
    sessionId, clientSequence, payloadDigest, payload, claimedAt, leaseMs = 45_000,
  }) {
    assertSequence(clientSequence);
    if (!nonEmpty(payloadDigest) || !isCanonicalTimestamp(claimedAt)
        || !Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) {
      throw new Error('Remediation action claim metadata is invalid');
    }
    return this.#mutate(sessionId, (record, exists) => {
      if (!exists) return { status: 'missing', session: null };
      const key = String(clientSequence);
      const current = record.actions[key];
      if (current) {
        if (current.payloadDigest !== payloadDigest) {
          return { status: 'conflict', session: structuredClone(record.session), action: structuredClone(current) };
        }
        if (current.status === 'complete') {
          return {
            status: 'duplicate', session: structuredClone(record.session),
            action: structuredClone(current), response: structuredClone(current.response),
          };
        }
        if (current.status === 'processing'
            && new Date(current.leaseExpiresAt).valueOf() > new Date(claimedAt).valueOf()) {
          return { status: 'busy', session: structuredClone(record.session), action: structuredClone(current) };
        }
        current.status = 'processing';
        current.claimedAt = claimedAt;
        current.leaseExpiresAt = addMilliseconds(claimedAt, leaseMs);
        current.attempts += 1;
        delete current.lastError;
        return { status: 'resume', session: structuredClone(record.session), action: structuredClone(current) };
      }
      if (clientSequence !== record.session.nextClientSequence) {
        return { status: 'out_of_order', session: structuredClone(record.session) };
      }
      record.actions[key] = {
        clientSequence, payloadDigest, payload: structuredClone(payload),
        status: 'processing', attempts: 1, claimedAt,
        leaseExpiresAt: addMilliseconds(claimedAt, leaseMs),
      };
      return { status: 'new', session: structuredClone(record.session), action: structuredClone(record.actions[key]) };
    });
  }

  async completeAction({ sessionId, clientSequence, payloadDigest, session, response, completedAt }) {
    assertSequence(clientSequence);
    if (!isCanonicalTimestamp(completedAt)) throw new Error('Remediation action completion time is invalid');
    return this.#mutate(sessionId, (record, exists) => {
      if (!exists) throw invariant('Remediation session disappeared during action', 'REMEDIATION_SESSION_MISSING');
      const action = record.actions[String(clientSequence)];
      if (!action || action.payloadDigest !== payloadDigest) {
        throw invariant('Remediation action completion does not match its claim', 'REMEDIATION_ACTION_CLAIM_MISMATCH');
      }
      if (action.status === 'complete') return structuredClone(action.response);
      if (action.status !== 'processing') {
        throw invariant('Remediation action is not processing', 'REMEDIATION_ACTION_NOT_PROCESSING');
      }
      if (session?.sessionId !== sessionId || session.nextClientSequence !== clientSequence + 1) {
        throw invariant('Remediation action produced an invalid next session', 'INVALID_REMEDIATION_NEXT_SESSION');
      }
      record.session = structuredClone(session);
      action.status = 'complete';
      action.completedAt = completedAt;
      action.response = structuredClone(response);
      delete action.leaseExpiresAt;
      return structuredClone(response);
    });
  }

  async failAction({ sessionId, clientSequence, payloadDigest, failedAt, error }) {
    assertSequence(clientSequence);
    if (!isCanonicalTimestamp(failedAt)) throw new Error('Remediation action failure time is invalid');
    return this.#mutate(sessionId, (record, exists) => {
      if (!exists) return null;
      const action = record.actions[String(clientSequence)];
      if (!action || action.payloadDigest !== payloadDigest || action.status === 'complete') return null;
      action.status = 'retryable';
      action.failedAt = failedAt;
      action.leaseExpiresAt = failedAt;
      action.lastError = boundedError(error);
      return structuredClone(action);
    });
  }

  async #mutate(sessionId, mutation) {
    assertSafeId(sessionId);
    const operation = this.#writeChain.then(() => {
      const loaded = this.#load(sessionId, false);
      const exists = Boolean(loaded);
      const record = loaded ?? { schema: RECORD_SCHEMA, sessionId, session: null, actions: {} };
      const result = mutation(record, exists);
      if (record.session) {
        this.#io.save(this.#path(sessionId), record, { noRefs: true });
        if (!exists) this.#appendIndex(sessionId);
      }
      return result;
    });
    this.#writeChain = operation.catch(() => {});
    return operation;
  }

  #load(sessionId, required = true) {
    assertSafeId(sessionId);
    const loaded = this.#io.load(this.#path(sessionId));
    if (!loaded) {
      if (required) throw invariant(`Remediation session '${sessionId}' was not found`, 'REMEDIATION_SESSION_MISSING');
      return null;
    }
    if (loaded.schema !== RECORD_SCHEMA || loaded.sessionId !== sessionId
        || !loaded.session || typeof loaded.session !== 'object'
        || !loaded.actions || typeof loaded.actions !== 'object' || Array.isArray(loaded.actions)) {
      throw invariant(`Remediation session record '${sessionId}' is invalid`, 'INVALID_REMEDIATION_SESSION_RECORD');
    }
    return loaded;
  }

  #appendIndex(sessionId) {
    const indexPath = path.join(this.#directory, '_index.yml');
    const loaded = this.#io.load(indexPath);
    const sessionIds = Array.isArray(loaded?.sessionIds) ? loaded.sessionIds : [];
    if (!sessionIds.includes(sessionId)) sessionIds.push(sessionId);
    this.#io.save(indexPath, {
      schema: 'school.remediation-session-index/v1', sessionIds: sessionIds.sort(),
    }, { noRefs: true });
  }

  #path(sessionId) { return path.join(this.#directory, `${sessionId}.yml`); }
}

function assertSafeId(value) { if (!SAFE_ID.test(value || '')) throw new Error('Remediation sessionId is unsafe'); }
function assertSequence(value) { if (!Number.isSafeInteger(value) || value < 0) throw new Error('Remediation clientSequence is invalid'); }
function nonEmpty(value) { return typeof value === 'string' && value.length > 0; }
function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}
function addMilliseconds(value, milliseconds) { return new Date(new Date(value).valueOf() + milliseconds).toISOString(); }
function boundedError(value) { return String(value?.message ?? value ?? 'unknown').replace(/[\r\n]+/g, ' ').slice(0, 240); }
function invariant(message, code) { return new DomainInvariantError(message, { code }); }

export default YamlRemediationSessionRepository;
