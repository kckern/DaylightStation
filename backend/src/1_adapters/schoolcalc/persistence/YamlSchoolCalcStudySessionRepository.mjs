import path from 'node:path';
import { ISchoolCalcStudySessionRepository } from '#apps/school/ports/ISchoolCalcStudySessionRepository.mjs';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';
import { loadYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

const CODE = /^\d{6}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/;

/** One atomic registry keeps both uniqueness indexes and session documents consistent. */
export class YamlSchoolCalcStudySessionRepository extends ISchoolCalcStudySessionRepository {
  #file; #io; #writeChain = Promise.resolve();

  constructor({ directory, io = {} } = {}) {
    super();
    if (typeof directory !== 'string' || !directory) throw new Error('Study session repository requires directory');
    this.#file = path.join(directory, 'adaptive-study-sessions.yml');
    this.#io = { load: io.load ?? loadYamlFromPath, save: io.save ?? saveYamlToPathAtomic };
  }

  async getByWorkSession(workSessionId) {
    assertSafeId(workSessionId, 'workSessionId');
    const document = this.#load();
    const id = document.byWorkSession[workSessionId];
    return id ? structuredClone(document.sessions[id]) : null;
  }

  async getByCode(sixDigitCode) {
    assertCode(sixDigitCode);
    const document = this.#load();
    const id = document.byCode[sixDigitCode];
    return id ? structuredClone(document.sessions[id]) : null;
  }

  async create(studySession) {
    validateSession(studySession);
    return this.#mutate((document) => {
      const workOwner = document.byWorkSession[studySession.workSessionId];
      if (workOwner) return structuredClone(document.sessions[workOwner]);
      const codeOwner = document.byCode[studySession.code];
      if (codeOwner) {
        throw new DomainInvariantError(`SchoolCalc code '${studySession.code}' has already been allocated`, {
          code: 'SCHOOLCALC_CODE_ALREADY_ALLOCATED',
        });
      }
      if (document.sessions[studySession.studySessionId]) {
        throw new DomainInvariantError(`SchoolCalc study '${studySession.studySessionId}' already exists`, {
          code: 'SCHOOLCALC_STUDY_ALREADY_EXISTS',
        });
      }
      const stored = structuredClone(studySession);
      document.sessions[stored.studySessionId] = stored;
      document.byWorkSession[stored.workSessionId] = stored.studySessionId;
      // Codes stay indexed forever, including after close. They are never recycled.
      document.byCode[stored.code] = stored.studySessionId;
      return structuredClone(stored);
    });
  }

  async close({ studySessionId, resultDigest, outcome, closedAt }) {
    assertSafeId(studySessionId, 'studySessionId');
    if (!['passed', 'failed'].includes(outcome)) throw new Error('Study outcome must be passed or failed');
    if (typeof resultDigest !== 'string' || !resultDigest) throw new Error('Study resultDigest is required');
    if (!isTimestamp(closedAt)) throw new Error('Study closedAt must be canonical ISO-8601');
    return this.#mutate((document) => {
      const session = document.sessions[studySessionId];
      if (!session) return { status: 'unknown', session: null };
      if (session.status === 'closed') {
        return {
          status: session.result.resultDigest === resultDigest ? 'duplicate' : 'conflict',
          session: structuredClone(session),
        };
      }
      session.status = 'closed';
      session.result = { resultDigest, outcome, closedAt };
      return { status: 'accepted', session: structuredClone(session) };
    });
  }

  async bindResolution({ studySessionId, resolution }) {
    assertSafeId(studySessionId, 'studySessionId');
    validateResolution(resolution);
    return this.#mutate((document) => {
      const session = document.sessions[studySessionId];
      if (!session) return { status: 'unknown', session: null };
      if (session.status !== 'open') return { status: 'closed', session: structuredClone(session) };
      if (session.resolution) {
        const same = session.resolution.deviceId === resolution.deviceId
          && session.resolution.requestId === resolution.requestId
          && session.resolution.prescriptionId === resolution.prescriptionId;
        return { status: same ? 'duplicate' : 'unauthorized', session: structuredClone(session) };
      }
      session.resolution = structuredClone(resolution);
      return { status: 'accepted', session: structuredClone(session) };
    });
  }

  async #mutate(mutation) {
    const operation = this.#writeChain.then(() => {
      const document = this.#load();
      const result = mutation(document);
      this.#io.save(this.#file, document, { noRefs: true });
      return result;
    });
    this.#writeChain = operation.catch(() => {});
    return operation;
  }

  #load() {
    const loaded = this.#io.load(this.#file);
    if (!loaded) return emptyDocument();
    if (loaded.schema !== 'school.calc.adaptive-study-registry/v1'
      || !plainObject(loaded.sessions) || !plainObject(loaded.byWorkSession) || !plainObject(loaded.byCode)) {
      throw new DomainInvariantError('SchoolCalc adaptive study registry is invalid', {
        code: 'INVALID_SCHOOLCALC_STUDY_REGISTRY',
      });
    }
    return loaded;
  }
}

function emptyDocument() {
  return { schema: 'school.calc.adaptive-study-registry/v1', sessions: {}, byWorkSession: {}, byCode: {} };
}

function validateSession(value) {
  if (!plainObject(value)) throw new Error('Study session is required');
  assertSafeId(value.studySessionId, 'studySessionId');
  assertSafeId(value.workSessionId, 'workSessionId');
  assertSafeId(value.learnerId, 'learnerId');
  assertCode(value.code);
  if (value.status !== 'open' || !isTimestamp(value.createdAt)) throw new Error('New study session must be open and timestamped');
  if (value.schema !== 'school.calc.adaptive-study-session/v1' || !plainObject(value.curation)
      || !plainObject(value.artifact) || typeof value.artifact.artifactId !== 'string'
      || typeof value.artifact.byteDigest !== 'string') {
    throw new Error('Study session requires canonical curation');
  }
}

function validateResolution(value) {
  if (!plainObject(value) || !SAFE_ID.test(value.deviceId || '')
      || !Number.isInteger(value.requestId) || value.requestId < 0 || value.requestId > 0xff_ffff
      || !Number.isInteger(value.learnerKey) || value.learnerKey < 1 || value.learnerKey > 0xffff
      || typeof value.prescriptionId !== 'string' || !value.prescriptionId
      || !isTimestamp(value.resolvedAt)) {
    throw new Error('Study resolution is invalid');
  }
}

function assertSafeId(value, label) {
  if (!SAFE_ID.test(value || '')) throw new Error(`Study ${label} is unsafe`);
}
function assertCode(value) { if (!CODE.test(value || '')) throw new Error('Study code must contain exactly six digits'); }
function plainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function isTimestamp(value) { const d = new Date(value); return typeof value === 'string' && Number.isFinite(d.valueOf()) && d.toISOString() === value; }

export default YamlSchoolCalcStudySessionRepository;
