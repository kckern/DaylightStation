import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Coin-bank twin of HmacSchoolBookGrantIssuer: its own key context and purpose,
// so a bank grant can never open a shelf and a shelf grant never opens a bank.
const CONTEXT = 'school.economy-bank.launch-grant/v1';
const PURPOSE = 'economy-bank';
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

export class HmacSchoolBankGrantIssuer {
  #key; #clock; #ttlMs;
  constructor({ key, clock = () => Date.now(), ttlMs = 10 * 60 * 1000 } = {}) {
    const source = Buffer.isBuffer(key) ? key : Buffer.from(key ?? '', 'utf8');
    if (source.length < 32) throw new Error('School bank grant key must contain at least 32 bytes');
    this.#key = createHmac('sha256', source).update(CONTEXT).digest(); this.#clock = clock; this.#ttlMs = ttlMs;
  }
  issue({ learnerId }) {
    if (!learnerId) throw new Error('Bank grant requires a learner');
    const payload = { purpose: PURPOSE, learnerId, exp: this.#clock() + this.#ttlMs, jti: randomBytes(12).toString('base64url') };
    const body = encode(payload); return `${body}.${this.#sign(body)}`;
  }
  verify(token, expected = {}) {
    const [body, signature, extra] = String(token ?? '').split('.');
    if (!body || !signature || extra) return { ok: false, reason: 'malformed' };
    const actual = Buffer.from(signature); const wanted = Buffer.from(this.#sign(body));
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return { ok: false, reason: 'tampered' };
    let payload; try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
    // A missing, non-numeric or infinite exp is refused, never read as open-ended.
    if (payload.purpose !== PURPOSE || !(Number.isFinite(payload.exp) && payload.exp > this.#clock())) return { ok: false, reason: 'expired' };
    for (const key of ['learnerId']) if (expected[key] && payload[key] !== expected[key]) return { ok: false, reason: key };
    return { ok: true, payload };
  }
  #sign(body) { return createHmac('sha256', this.#key).update(body).digest('base64url'); }
}
export default HmacSchoolBankGrantIssuer;
