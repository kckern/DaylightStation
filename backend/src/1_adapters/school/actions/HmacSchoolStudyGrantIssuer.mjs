import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const PURPOSE = 'school.sentence-ladder.study';
const CONTEXT = 'school.sentence-ladder.study-grant/v1';
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;

const b64 = (value) => Buffer.from(value).toString('base64url');
const parseB64 = (value) => Buffer.from(value, 'base64url');

/**
 * Short-lived, purpose-bound authority for one learner and one corpus.
 * Tokens are carried only in the X-School-Study-Grant header and are never
 * persisted. This is deliberately separate from household login JWTs: a
 * logged-in browser has identity, but only a validated School launch earns
 * permission to study this queue.
 */
export class HmacSchoolStudyGrantIssuer {
  #key; #clock; #ttlMs; #nonce;

  constructor({
    key,
    clock = () => Date.now(),
    ttlMs = DEFAULT_TTL_MS,
    nonce = () => randomBytes(12).toString('base64url'),
  } = {}) {
    const source = Buffer.isBuffer(key) ? key : Buffer.from(key ?? '', 'utf8');
    if (source.length < 32) throw new Error('School study grant key must contain at least 32 bytes');
    this.#key = createHmac('sha256', source).update(CONTEXT).digest();
    this.#clock = clock;
    this.#ttlMs = ttlMs;
    this.#nonce = nonce;
  }

  issue({ learnerId, corpusId }) {
    if (!learnerId || !corpusId) throw new Error('Study grant requires learnerId and corpusId');
    const iat = this.#clock();
    const payload = {
      purpose: PURPOSE,
      programId: 'sentence-ladder',
      learnerId,
      corpusId,
      iat,
      exp: iat + this.#ttlMs,
      jti: this.#nonce(),
    };
    const encoded = b64(JSON.stringify(payload));
    return `${encoded}.${this.#sign(encoded)}`;
  }

  verify(token, { learnerId, corpusId } = {}) {
    if (typeof token !== 'string') return { ok: false, reason: 'missing' };
    const [encoded, signature, extra] = token.split('.');
    if (!encoded || !signature || extra) return { ok: false, reason: 'malformed' };
    const expected = this.#sign(encoded);
    const actualBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
      return { ok: false, reason: 'tampered' };
    }
    let payload;
    try { payload = JSON.parse(parseB64(encoded).toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
    if (payload.purpose !== PURPOSE || payload.programId !== 'sentence-ladder') return { ok: false, reason: 'purpose' };
    if (payload.learnerId !== learnerId) return { ok: false, reason: 'learner' };
    if (payload.corpusId !== corpusId) return { ok: false, reason: 'corpus' };
    if (!Number.isFinite(payload.exp) || payload.exp <= this.#clock()) return { ok: false, reason: 'expired' };
    return { ok: true, payload };
  }

  #sign(encoded) {
    return createHmac('sha256', this.#key).update(encoded).digest('base64url');
  }
}

export default HmacSchoolStudyGrantIssuer;
