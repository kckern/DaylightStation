import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const CONTEXT = 'school.language-reels.launch-grant/v1';
const PURPOSE = 'school.language-reels.launch';
const b64 = (value) => Buffer.from(value).toString('base64url');

/** Short-lived authority for one learner's assigned Language Reel unit. */
export class HmacSchoolReelGrantIssuer {
  #key; #clock; #ttlMs;
  constructor({ key, clock = () => Date.now(), ttlMs = 2 * 60 * 60 * 1000 } = {}) {
    const source = Buffer.isBuffer(key) ? key : Buffer.from(key ?? '', 'utf8');
    if (source.length < 32) throw new Error('School reel grant key must contain at least 32 bytes');
    this.#key = createHmac('sha256', source).update(CONTEXT).digest();
    this.#clock = clock; this.#ttlMs = ttlMs;
  }
  issue({ learnerId, unitId, reelId, revision = null }) {
    if (!learnerId || !unitId || !reelId) throw new Error('Reel grant requires learner, unit, and reel');
    const payload = { purpose: PURPOSE, learnerId, unitId, reelId, revision,
      exp: this.#clock() + this.#ttlMs, jti: randomBytes(12).toString('base64url') };
    const encoded = b64(JSON.stringify(payload));
    return `${encoded}.${this.#sign(encoded)}`;
  }
  verify(token, expected = {}) {
    const [encoded, signature, extra] = String(token ?? '').split('.');
    if (!encoded || !signature || extra) return { ok: false, reason: 'malformed' };
    const actual = Buffer.from(signature); const wanted = Buffer.from(this.#sign(encoded));
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return { ok: false, reason: 'tampered' };
    let payload; try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
    if (payload.purpose !== PURPOSE || payload.exp <= this.#clock()) return { ok: false, reason: 'expired' };
    for (const key of ['learnerId', 'unitId', 'reelId']) if (expected[key] && payload[key] !== expected[key]) return { ok: false, reason: key };
    return { ok: true, payload };
  }
  #sign(encoded) { return createHmac('sha256', this.#key).update(encoded).digest('base64url'); }
}
export default HmacSchoolReelGrantIssuer;
