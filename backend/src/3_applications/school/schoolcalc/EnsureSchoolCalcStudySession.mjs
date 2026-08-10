import { curateAdaptiveStudy } from '#domains/school/schoolcalc/index.mjs';

const MAX_CODE_ATTEMPTS = 64;

/** Idempotently issue the immutable Adaptive Study behind one generic work session. */
export class EnsureSchoolCalcStudySession {
  #studies; #banks; #artifacts; #newStudySessionId; #newCode;

  constructor({ studies, banks, artifacts, newStudySessionId, newCode } = {}) {
    if (!studies || !banks?.getBank || !artifacts?.execute
        || typeof newStudySessionId !== 'function' || typeof newCode !== 'function') {
      throw new Error('EnsureSchoolCalcStudySession requires studies, banks, artifacts, and ID/code factories');
    }
    this.#studies = studies;
    this.#banks = banks;
    this.#artifacts = artifacts;
    this.#newStudySessionId = newStudySessionId;
    this.#newCode = newCode;
  }

  async ensure({ workSessionId, learnerId, unit, at } = {}) {
    const existing = await this.#studies.getByWorkSession(workSessionId);
    if (existing) return publicView(existing);

    const bank = await this.#banks.getBank(unit?.bank);
    const curation = curateAdaptiveStudy({ unit, bank });
    const artifact = await this.#artifacts.execute({ unit, bank, curation });
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const code = normalizeCode(this.#newCode());
      // Avoid the common collision without writing. create() remains the authoritative atomic guard.
      // eslint-disable-next-line no-await-in-loop
      if (await this.#studies.getByCode(code)) continue;
      const session = {
        schema: 'school.calc.adaptive-study-session/v1',
        studySessionId: this.#newStudySessionId(), workSessionId, learnerId, code,
        unitId: unit.unitId, subject: unit.subject, topicId: curation.topicId,
        status: 'open', createdAt: at, curation,
        artifact: {
          artifactId: artifact.artifactId, platformId: artifact.platformId,
          variableName: artifact.variableName, byteLength: artifact.byteLength,
          byteDigest: artifact.byteDigest, requiredClientVersion: 1,
        },
      };
      try {
        // eslint-disable-next-line no-await-in-loop
        return publicView(await this.#studies.create(session));
      } catch (error) {
        if (error?.code !== 'SCHOOLCALC_CODE_ALREADY_ALLOCATED') throw error;
      }
    }
    throw new Error('Unable to allocate an unused SchoolCalc code');
  }

  async preview({ workSessionId } = {}) {
    const existing = await this.#studies.getByWorkSession(workSessionId);
    return existing ? publicView(existing) : { eligible: true, studySessionId: null, code: null };
  }
}

function publicView(session) {
  return Object.freeze({
    eligible: true,
    studySessionId: session.studySessionId,
    code: session.code,
    status: session.status,
  });
}

function normalizeCode(value) {
  if (Number.isInteger(value) && value >= 0 && value <= 999999) return String(value).padStart(6, '0');
  if (typeof value === 'string' && /^\d{6}$/.test(value)) return value;
  throw new Error('SchoolCalc code factory must return 0..999999 or exactly six digits');
}

export default EnsureSchoolCalcStudySession;
