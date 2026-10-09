import { CallLeaseService } from './application/CallLeaseService.mjs';
import { SecureHomelineIdentityIssuer } from './adapters/SecureHomelineIdentityIssuer.mjs';
export function createHomelineLease({ deviceService, wakeAndLoadService, logger, clock, scheduler }) {
  return new CallLeaseService({ deviceService, wakeAndLoadService, logger, clock, scheduler, identityIssuer: new SecureHomelineIdentityIssuer() });
}
