import { describe, expect, it } from 'vitest';
import { householdViewerFor, viewerFor } from './participantHttp.mjs';

describe('household surfaces need no sign-in; editing does', () => {
  it('lets a LAN screen with no sign-in view and start activities as a host', () => {
    expect(householdViewerFor({ roles: ['sysadmin'] }, 'default')).toEqual({ role: 'host', participant_id: 'household:default', householdId: 'default' });
  });
  it('gives an outside caller with no sign-in only participant authority', () => {
    expect(householdViewerFor({ roles: [] }, 'default').role).toBe('participant');
  });
  it('keeps a signed-in caller as themselves', () => {
    expect(householdViewerFor({ user: { sub: 'kckern' }, roles: ['sysadmin'] }, 'default').participant_id).toBe('kckern');
  });
  it('still refuses another household', () => {
    expect(() => householdViewerFor({ householdId: 'other', roles: ['sysadmin'] }, 'default')).toThrow('Household scope mismatch');
  });
  it('keeps sign-in required for editing routes', () => {
    expect(() => viewerFor({ roles: ['sysadmin'] }, 'default', true)).toThrow('Authentication required');
  });
});
