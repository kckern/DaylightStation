import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const MOUNT_RECEIPT_PURPOSE = 'school-selfservice-mount/v1';
export const MOUNT_RESERVATION_MS = 120_000;
const SESSION_PURPOSE = 'school-selfservice-session/v1';
/** Purpose-separated household signatures. Neither receipt nor cookie grants domain credit. */
export class HmacSchoolMountReceiptIssuer {
  #key; #clock; #householdId;
  constructor({ key, householdId, clock = () => Date.now() } = {}) {
    const source = Buffer.isBuffer(key) ? key : Buffer.from(key ?? '', 'utf8');
    if (source.length < 32) throw new Error('School mount signing material unavailable');
    this.#key = createHmac('sha256', source).update(MOUNT_RECEIPT_PURPOSE).digest();
    if (typeof householdId !== 'string' || !householdId) throw new Error('School mount household unavailable');
    this.#householdId = householdId; this.#clock = clock;
  }
  issue({ useId, token, learnerId, deviceId, action, expiresAt }) {
    if (![useId, token, learnerId, deviceId, action].every(v => typeof v === 'string' && v.length > 0 && v.length <= 256)
      || !(Date.parse(expiresAt) > this.#clock()) || Date.parse(expiresAt) > this.#clock() + MOUNT_RESERVATION_MS) throw new Error('Invalid mount reservation');
    return this.#encode({ purpose: MOUNT_RECEIPT_PURPOSE, useId, token, learnerId, deviceId, action, exp: Date.parse(expiresAt) });
  }
  verify(receipt, { deviceId } = {}) {
    const result = this.#verify(receipt, MOUNT_RECEIPT_PURPOSE);
    if (!result.ok) return result;
    const p = result.payload;
    if (!deviceId || p.deviceId !== deviceId || !['useId','token','learnerId','action'].every(k => typeof p[k] === 'string' && p[k])) return { ok: false };
    return result;
  }
  issueSession() {
    return this.#encode({ purpose: SESSION_PURPOSE, id: randomBytes(32).toString('base64url'), exp: this.#clock() + 86_400_000 });
  }
  sessionIdentity(cookie) {
    const result = this.#verify(cookie, SESSION_PURPOSE);
    return result.ok && typeof result.payload.id === 'string' ? `session:${result.payload.id}` : null;
  }
  #encode(payload) {
    const body = Buffer.from(JSON.stringify({ ...payload, householdId: this.#householdId })).toString('base64url');
    return `${body}.${this.#sign(body)}`;
  }
  #sign(body) { return createHmac('sha256', this.#key).update(body).digest('base64url'); }
  #verify(value, purpose) {
    if (typeof value !== 'string' || value.length > 4096) return { ok: false };
    const [body, signature, extra] = value.split('.');
    if (!body || !signature || extra) return { ok: false };
    const expected = Buffer.from(this.#sign(body)); const actual = Buffer.from(signature);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { ok: false };
    let payload;
    try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return { ok: false }; }
    if (payload?.householdId !== this.#householdId || payload?.purpose !== purpose || !Number.isFinite(payload.exp) || payload.exp <= this.#clock()) return { ok: false };
    return { ok: true, payload };
  }
}
