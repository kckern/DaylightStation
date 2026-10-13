import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (token) => createHash('sha256').update(token, 'utf8').digest();

export class SchoolCalcRelayCredentialVerifier {
  constructor({ credentials } = {}) {
    if (!Array.isArray(credentials) || credentials.length === 0) throw new Error('SchoolCalc ingress requires at least one relay credential');
    const ids = new Set();
    const digests = new Set();
    this.credentials = credentials.map(({ relayId, apiToken } = {}) => {
      if (typeof relayId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(relayId)) {
        throw new Error('SchoolCalc relay credential has an invalid relayId');
      }
      if (typeof apiToken !== 'string' || Buffer.byteLength(apiToken, 'utf8') < 32) {
        throw new Error(`SchoolCalc relay '${relayId}' api_token must be at least 32 bytes`);
      }
      const tokenDigest = digest(apiToken);
      const key = tokenDigest.toString('hex');
      if (ids.has(relayId)) throw new Error(`Duplicate SchoolCalc relayId '${relayId}'`);
      if (digests.has(key)) throw new Error('Every SchoolCalc relay must have a distinct api_token');
      ids.add(relayId); digests.add(key);
      return Object.freeze({ relayId, digest: tokenDigest });
    });
  }

  verify({ authorization, assertedRelayId = null } = {}) {
    const match = typeof authorization === 'string' ? /^Bearer ([^\s]+)$/.exec(authorization) : null;
    const presented = match ? digest(match[1]) : null;
    const credential = presented
      ? this.credentials.find(({ digest: expected }) => timingSafeEqual(expected, presented)) ?? null
      : null;
    if (!credential || (assertedRelayId && assertedRelayId !== credential.relayId)) {
      return { ok: false, reason: credential ? 'relay identity does not match credential' : 'invalid credential' };
    }
    return { ok: true, relayId: credential.relayId };
  }
}
