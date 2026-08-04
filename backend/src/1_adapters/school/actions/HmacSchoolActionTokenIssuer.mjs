import { createHmac } from 'node:crypto';
import { ISchoolActionTokenIssuer } from '#apps/school/ports/ISchoolActionTokenIssuer.mjs';
import { createTokenRecord } from '#domains/school/sessions/tokens.mjs';

const TOKEN_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const TOKEN_CONTEXT = 'school.learning-action-token/v1';
const MAX_FIELD_BYTES = 255;

/**
 * Derives an 80-bit opaque token from a dedicated secret and a stable binding.
 * The mapping is deterministic so immutable device artifacts remain
 * reproducible, while the registry remains the revocation/current-policy
 * authority. A token version is an explicit rotation lever.
 */
export class HmacSchoolActionTokenIssuer extends ISchoolActionTokenIssuer {
  #key; #tokens; #clock;

  constructor({ key, tokens, clock = () => new Date() } = {}) {
    super();
    const bytes = normalizeKey(key);
    if (bytes.length < 32) throw new Error('School action token key must contain at least 32 bytes');
    if (!tokens || typeof tokens.claim !== 'function') {
      throw new Error('HmacSchoolActionTokenIssuer requires an atomic token registry');
    }
    if (typeof clock !== 'function') throw new Error('HmacSchoolActionTokenIssuer requires a clock');
    this.#key = bytes;
    this.#tokens = tokens;
    this.#clock = clock;
  }

  async issue(binding) {
    const subject = normalizeBinding(binding);
    const token = this.tokenFor(subject);
    const record = createTokenRecord({
      token,
      tokenClass: 'learning_action',
      subject,
      at: this.#clock().toISOString(),
    });
    const claim = await this.#tokens.claim(record);
    if (claim.status === 'conflict') {
      throw new Error('School action token collision changed an already-printed token meaning');
    }
    if (claim.record.revokedAt) {
      throw new Error(`School action token is revoked; increment tokenVersion for '${subject.actionId}'`);
    }
    return Object.freeze({ token, status: claim.status, record: structuredClone(claim.record) });
  }

  /** Pure derivation exposed for deterministic adapter tests and diagnostics. */
  tokenFor(binding) {
    const subject = normalizeBinding(binding);
    const material = encodeBinding(subject);
    const digest = createHmac('sha256', this.#key).update(material).digest().subarray(0, 10);
    return `sch:${base32Token(digest)}`;
  }
}

function normalizeKey(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  return Buffer.alloc(0);
}

function normalizeBinding(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('School action binding must be a mapping');
  const fields = ['deviceId', 'address', 'actionId'];
  const out = {};
  fields.forEach((field) => {
    const value = raw[field];
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')
      || Buffer.byteLength(value, 'utf8') > MAX_FIELD_BYTES) {
      throw new Error(`School action binding ${field} must be a bounded non-empty string`);
    }
    out[field] = value;
  });
  if (!Number.isInteger(raw.tokenVersion) || raw.tokenVersion < 1 || raw.tokenVersion > 0xffff) {
    throw new Error('School action binding tokenVersion must be an integer from 1–65535');
  }
  out.tokenVersion = raw.tokenVersion;
  return Object.freeze(out);
}

function encodeBinding(binding) {
  const chunks = [Buffer.from(`${TOKEN_CONTEXT}\0`, 'utf8')];
  for (const field of [binding.deviceId, binding.address, binding.actionId]) {
    const bytes = Buffer.from(field, 'utf8');
    chunks.push(Buffer.from([bytes.length]), bytes);
  }
  chunks.push(Buffer.from([binding.tokenVersion & 0xff, binding.tokenVersion >>> 8]));
  return Buffer.concat(chunks);
}

function base32Token(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += TOKEN_ALPHABET[(value >>> bits) & 31];
      value &= (1 << bits) - 1;
    }
  }
  if (bits !== 0 || out.length !== 16) throw new Error('School action token entropy encoding failed');
  return out;
}

export default HmacSchoolActionTokenIssuer;
