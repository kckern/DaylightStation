import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Debrief twin of HmacSchoolBookGrantIssuer: its own key context and purpose, and
// the study days it may write (today, plus yesterday while in grace).
const CONTEXT = 'school.debrief.launch-grant/v1';
const PURPOSE = 'school-debrief';
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

export class HmacSchoolDebriefGrantIssuer {
  #key; #clock; #ttlMs;
  constructor({ key, clock = () => Date.now(), ttlMs = 2 * 60 * 60 * 1000 } = {}) {
    const source = Buffer.isBuffer(key) ? key : Buffer.from(key ?? '', 'utf8');
    if (source.length < 32) throw new Error('School debrief grant key must contain at least 32 bytes');
    this.#key = createHmac('sha256', source).update(CONTEXT).digest(); this.#clock = clock; this.#ttlMs = ttlMs;
  }
  issue({ learnerId, days }) {
    if (!learnerId) throw new Error('Debrief grant requires a learner');
    if (!Array.isArray(days) || !days.length) throw new Error('Debrief grant requires at least one study day');
    const payload = { purpose: PURPOSE, learnerId, days, exp: this.#clock() + this.#ttlMs, jti: randomBytes(12).toString('base64url') };
    const body = encode(payload); return `${body}.${this.#sign(body)}`;
  }
  verify(token, expected = {}) {
    const [body, signature, extra] = String(token ?? '').split('.');
    if (!body || !signature || extra) return { ok: false, reason: 'malformed' };
    const actual = Buffer.from(signature); const wanted = Buffer.from(this.#sign(body));
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return { ok: false, reason: 'tampered' };
    let payload; try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
    // A grant lives only while exp > now; a missing, non-numeric or infinite exp is refused, never treated as open-ended.
    if (payload.purpose !== PURPOSE || !(Number.isFinite(payload.exp) && payload.exp > this.#clock())) return { ok: false, reason: 'expired' };
    if (expected.learnerId && payload.learnerId !== expected.learnerId) return { ok: false, reason: 'learnerId' };
    if (expected.day && !(payload.days ?? []).includes(expected.day)) return { ok: false, reason: 'day' };
    return { ok: true, payload };
  }
  #sign(body) { return createHmac('sha256', this.#key).update(body).digest('base64url'); }
}
export default HmacSchoolDebriefGrantIssuer;
