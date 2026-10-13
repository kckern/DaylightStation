import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Book-shelf twin of HmacSchoolCubeGrantIssuer: its own key context and purpose, so a cube grant can never open a shelf.
const CONTEXT = 'school.book-shelf.launch-grant/v1';
const PURPOSE = 'book-shelf';
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

export class HmacSchoolBookGrantIssuer {
  #key; #clock; #ttlMs;
  constructor({ key, clock = () => Date.now(), ttlMs = 8 * 60 * 60 * 1000 } = {}) {
    const source = Buffer.isBuffer(key) ? key : Buffer.from(key ?? '', 'utf8');
    if (source.length < 32) throw new Error('School book grant key must contain at least 32 bytes');
    this.#key = createHmac('sha256', source).update(CONTEXT).digest(); this.#clock = clock; this.#ttlMs = ttlMs;
  }
  issue({ learnerId }) {
    if (!learnerId) throw new Error('Book grant requires a learner');
    const payload = { purpose: PURPOSE, learnerId, exp: this.#clock() + this.#ttlMs, jti: randomBytes(12).toString('base64url') };
    const body = encode(payload); return `${body}.${this.#sign(body)}`;
  }
  verify(token, expected = {}) {
    const [body, signature, extra] = String(token ?? '').split('.');
    if (!body || !signature || extra) return { ok: false, reason: 'malformed' };
    const actual = Buffer.from(signature); const wanted = Buffer.from(this.#sign(body));
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return { ok: false, reason: 'tampered' };
    let payload; try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
    // A grant lives only while exp > now; a missing, non-numeric or infinite exp is refused, never treated as open-ended (review n3).
    if (payload.purpose !== PURPOSE || !(Number.isFinite(payload.exp) && payload.exp > this.#clock())) return { ok: false, reason: 'expired' };
    for (const key of ['learnerId']) if (expected[key] && payload[key] !== expected[key]) return { ok: false, reason: key };
    return { ok: true, payload };
  }
  #sign(body) { return createHmac('sha256', this.#key).update(body).digest('base64url'); }
}
export default HmacSchoolBookGrantIssuer;
