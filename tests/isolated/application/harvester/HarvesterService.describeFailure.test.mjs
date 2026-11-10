import { describe, it, expect } from 'vitest';
import { HarvesterService } from '#apps/harvester/HarvesterService.mjs';

const quiet = { info() {}, warn() {}, error() {} };

describe('HarvesterService.describeFailure', () => {
  const service = new HarvesterService({ resolveDefaultUserId: () => 'default', logger: quiet });

  it('describes a status-error result', () => {
    expect(service.describeFailure({ count: 0, status: 'error', reason: 'auth_failed', error: 'invalid refresh_token' }))
      .toBe('auth_failed: invalid refresh_token');
  });

  it('returns null for a result that is not a failure', () => {
    expect(service.describeFailure({ count: 3, status: 'success' })).toBeNull();
    expect(service.describeFailure({ count: 0, status: 'skipped', reason: 'cooldown' })).toBeNull();
  });
});
