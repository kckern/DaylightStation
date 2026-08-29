import crypto from 'node:crypto';
import { hashPassword, verifyPassword } from '#system/auth/password.mjs';
import { IAuthenticationPrimitives } from '#apps/auth/ports/IAuthenticationPrimitives.mjs';

export class NodeAuthenticationPrimitives extends IAuthenticationPrimitives {
  hashSecret(secret) { return hashPassword(secret); }
  verifySecret(secret, digest) { return verifyPassword(secret, digest); }
  createInviteToken() { return crypto.randomBytes(32).toString('hex'); }
  createJwtSecret() { return crypto.randomBytes(64).toString('hex'); }
}

export default NodeAuthenticationPrimitives;
