import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const CONTEXT = 'school.launch-preview.token/v1';
const PURPOSE = 'school.launch-preview';
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const b64 = (value) => Buffer.from(value).toString('base64url');

/**
 * Short-lived, reloadable authority for a teacher to inspect one learner's
 * launch card. Verification grants only the read-only preview route; it is
 * deliberately not accepted by any learner action endpoint.
 */
export class HmacSchoolLaunchPreviewTokenIssuer {
  #key; #clock; #ttlMs;

  constructor({ key, clock = () => Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
    const source = Buffer.isBuffer(key) ? key : Buffer.from(key ?? '', 'utf8');
    if (source.length < 32) throw new Error('School launch preview key must contain at least 32 bytes');
    this.#key = createHmac('sha256', source).update(CONTEXT).digest();
    this.#clock = clock;
    this.#ttlMs = ttlMs;
  }

  issue({ learnerId, subject, continueToday = false } = {}) {
    if (typeof learnerId !== 'string' || !learnerId.trim()) {
      throw new Error('Launch preview requires a learner');
    }
    if (typeof subject !== 'string' || !subject.trim()) {
      throw new Error('Launch preview requires a subject');
    }
    const now = this.#clock();
    const payload = {
      purpose: PURPOSE,
      learnerId: learnerId.trim(),
      subject: subject.trim(),
      continueToday: continueToday === true,
      iat: now,
      exp: now + this.#ttlMs,
      jti: randomBytes(12).toString('base64url'),
    };
    const encoded = b64(JSON.stringify(payload));
    return `${encoded}.${this.#sign(encoded)}`;
  }

  verify(token, expected = {}) {
    const [encoded, signature, extra] = String(token ?? '').split('.');
    if (!encoded || !signature || extra) return { ok: false, reason: 'malformed' };
    const actual = Buffer.from(signature);
    const wanted = Buffer.from(this.#sign(encoded));
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
      return { ok: false, reason: 'tampered' };
    }
    let payload;
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch {
      return { ok: false, reason: 'malformed' };
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || payload.purpose !== PURPOSE || !payload.learnerId || !payload.subject
        || !Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) {
      return { ok: false, reason: 'malformed' };
    }
    if (payload.exp <= this.#clock()) return { ok: false, reason: 'expired' };
    for (const key of ['learnerId', 'subject']) {
      if (expected[key] && payload[key] !== expected[key]) return { ok: false, reason: key };
    }
    return { ok: true, payload };
  }

  #sign(encoded) {
    return createHmac('sha256', this.#key).update(encoded).digest('base64url');
  }
}

export default HmacSchoolLaunchPreviewTokenIssuer;
