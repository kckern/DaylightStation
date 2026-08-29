import { createHash } from 'node:crypto';

/** Pure deterministic SHA-256 text digest shared by upper layers. */
export function sha256Text(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

/** Pure deterministic SHA-256 digest for an existing byte sequence. */
export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export default sha256Text;
