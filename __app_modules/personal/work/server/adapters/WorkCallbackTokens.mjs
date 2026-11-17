import { randomBytes, createHash } from 'node:crypto';
/** Opaque transport controls; raw tokens are returned once and never persisted. */
export function createWorkCallbackTokens() {
  const hash = token => typeof token === 'string' && /^w1:[A-Za-z0-9_-]{32}$/.test(token) ? createHash('sha256').update(token).digest('hex') : null;
  return {
    mint() {
      const token = 'w1:' + randomBytes(24).toString('base64url');
      return {
        token,
        hash: hash(token)
      };
    },
    hash
  };
}
