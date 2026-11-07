import { describe, it, expect } from 'vitest';
import { buildAssignFailureToast } from './buildAssignFailureToast.js';

describe('buildAssignFailureToast', () => {
  it('names the rider and the strap that is still sending', () => {
    const toast = buildAssignFailureToast(
      { ok: false, code: 'user-already-assigned', existingDeviceId: '8317' },
      { name: 'Rider M', profileId: 'rider_m' }
    );
    expect(toast).toMatchObject({ title: 'Rider M is already on strap 8317', variant: 'warning' });
    expect(toast.durationMs).toBeGreaterThan(2500);
  });

  it('falls back to the service message for any other code', () => {
    const toast = buildAssignFailureToast({ ok: false, code: 'session-missing', message: 'User manager is not available.' }, { name: 'Guest' });
    expect(toast).toMatchObject({ title: "Couldn't assign Guest", subtitle: 'User manager is not available.', variant: 'warning' });
  });
});
