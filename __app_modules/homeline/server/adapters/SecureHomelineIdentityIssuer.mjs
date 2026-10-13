import { randomBytes, randomUUID } from 'node:crypto';

export class SecureHomelineIdentityIssuer {
  newCallId() { return randomUUID(); }
  newDispatchId() { return randomUUID(); }
  newTvPeerId() { return `tv-${randomUUID()}`; }
  newCredential() { return randomBytes(32).toString('base64url'); }
}

export default SecureHomelineIdentityIssuer;
