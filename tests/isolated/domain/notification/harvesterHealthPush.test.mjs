import { describe, expect, it } from 'vitest';
import { composeHarvesterHealthPush } from '#domains/notification/push/harvesterHealthPush.mjs';
import { findPushTextDefects } from '#domains/notification/push/pushText.mjs';

const now = '2026-10-20T19:00:00.000Z';
const tz = 'America/Los_Angeles';
const clean = (p) => { expect(findPushTextDefects(p.title)).toEqual([]); expect(findPushTextDefects(p.message)).toEqual([]); };

describe('composeHarvesterHealthPush', () => {
  it('failing sign-in names the service, how long, and the fix', () => {
    const p = composeHarvesterHealthPush({ serviceId: 'withings', status: 'failing', error: 'auth_failed: Invalid Params: invalid refresh_token', lastSuccessAt: '2026-10-01T19:00:00.000Z', now, timezone: tz });
    expect(p.title).toBe('⚠️ Withings stopped syncing');
    expect(p.message).toMatch(/sign-in expired/);
    expect(p.message).toMatch(/Admin/);
    expect(p.data).toMatchObject({ tag: 'harvester-health-withings', channel: 'Household alerts', importance: 'high' });
    clean(p);
  });
  it('a long outage reads as a local day, not hundreds of hours', () => {
    const p = composeHarvesterHealthPush({ serviceId: 'withings', status: 'failing', error: 'auth_failed', lastSuccessAt: '2026-10-01T19:00:00.000Z', now, timezone: tz });
    expect(p.message).toMatch(/since Thu Oct 1/);
    expect(p.message).not.toMatch(/\d+ hr/);
  });
  it('a short outage gives the span and the local clock time', () => {
    const p = composeHarvesterHealthPush({ serviceId: 'withings', status: 'failing', error: 'ETIMEDOUT', lastSuccessAt: '2026-10-20T16:00:00.000Z', now, timezone: tz });
    expect(p.message).toMatch(/for 3 hr \(last worked 9:00\sAM\)/);
    expect(p.message).toMatch(/could not be reached/);
    clean(p);
  });
  it('failing without a known last success still reads cleanly', () => {
    clean(composeHarvesterHealthPush({ serviceId: 'fitsync', status: 'failing', error: 'ETIMEDOUT', now, timezone: tz }));
  });
  it('only Withings sign-in failures point at Admin (the only reconnect button)', () => {
    const p = composeHarvesterHealthPush({ serviceId: 'fitsync', status: 'failing', error: 'auth_failed: 401', now, timezone: tz });
    expect(p.message).toMatch(/sign-in expired/);
    expect(p.message).not.toMatch(/Admin/);
    expect(p.title).toBe('⚠️ FitnessSyncer stopped syncing');
    clean(p);
  });
  it('an unknown service id is title-cased, never shown raw', () => {
    const p = composeHarvesterHealthPush({ serviceId: 'new_source', status: 'failing', error: null, now, timezone: tz });
    expect(p.title).toBe('⚠️ New Source stopped syncing');
    clean(p);
  });
  it('stale names the newest entry', () => {
    const p = composeHarvesterHealthPush({ serviceId: 'withings', status: 'stale', latestDate: '2026-10-01', now, timezone: tz });
    expect(p.title).toBe('⚠️ No new Withings data');
    expect(p.message).toMatch(/Thu Oct 1/);
    clean(p);
  });
  it('recovered is quiet', () => {
    const p = composeHarvesterHealthPush({ serviceId: 'withings', status: 'recovered', now, timezone: tz });
    expect(p.title).toBe('✅ Withings syncing again');
    expect(p.data).toMatchObject({ importance: 'low', alert_once: true });
    clean(p);
  });
});
