import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const CONTEXT = 'school.rubiks-cube.launch-grant/v1';
const PURPOSE = 'school.rubiks-cube.launch';
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

export class HmacSchoolCubeGrantIssuer {
  #key; #clock; #ttlMs;
  constructor({ key, clock = () => Date.now(), ttlMs = 2 * 60 * 60 * 1000 } = {}) {
    const source = Buffer.isBuffer(key) ? key : Buffer.from(key ?? '', 'utf8');
    if (source.length < 32) throw new Error('School cube grant key must contain at least 32 bytes');
    this.#key = createHmac('sha256', source).update(CONTEXT).digest(); this.#clock = clock; this.#ttlMs = ttlMs;
  }
  issue({ learnerId, unitId, courseId, revision }) {
    if (!learnerId || !unitId || !courseId) throw new Error('Cube grant requires learner, unit, and course');
    const payload = { purpose: PURPOSE, learnerId, unitId, courseId, revision, exp: this.#clock() + this.#ttlMs, jti: randomBytes(12).toString('base64url') };
    const body = encode(payload); return `${body}.${this.#sign(body)}`;
  }
  verify(token, expected = {}) {
    const [body, signature, extra] = String(token ?? '').split('.');
    if (!body || !signature || extra) return { ok: false, reason: 'malformed' };
    const actual = Buffer.from(signature); const wanted = Buffer.from(this.#sign(body));
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return { ok: false, reason: 'tampered' };
    let payload; try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
    if (payload.purpose !== PURPOSE || payload.exp <= this.#clock()) return { ok: false, reason: 'expired' };
    for (const key of ['learnerId', 'courseId']) if (expected[key] && payload[key] !== expected[key]) return { ok: false, reason: key };
    return { ok: true, payload };
  }
  #sign(body) { return createHmac('sha256', this.#key).update(body).digest('base64url'); }
}
export default HmacSchoolCubeGrantIssuer;
