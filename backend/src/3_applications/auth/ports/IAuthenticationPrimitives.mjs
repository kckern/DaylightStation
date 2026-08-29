export class IAuthenticationPrimitives {
  hashSecret(_secret) { throw new Error('IAuthenticationPrimitives.hashSecret must be implemented'); }
  verifySecret(_secret, _digest) { throw new Error('IAuthenticationPrimitives.verifySecret must be implemented'); }
  createInviteToken() { throw new Error('IAuthenticationPrimitives.createInviteToken must be implemented'); }
  createJwtSecret() { throw new Error('IAuthenticationPrimitives.createJwtSecret must be implemented'); }
}

export function isAuthenticationPrimitives(value) {
  return value != null
    && typeof value.hashSecret === 'function'
    && typeof value.verifySecret === 'function'
    && typeof value.createInviteToken === 'function'
    && typeof value.createJwtSecret === 'function';
}
