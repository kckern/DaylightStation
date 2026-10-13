import { createHash } from 'node:crypto';

/** Infrastructure-owned SHA-256 primitive for already-canonical text. */
export function sha256Text(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export default sha256Text;
