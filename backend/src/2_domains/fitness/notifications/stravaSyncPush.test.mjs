import { describe, it, expect } from 'vitest';
import { composeStravaSyncPush, plainSyncError } from './stravaSyncPush.mjs';
import { findPushTextDefects } from '#domains/notification/push/pushText.mjs';

const now = '2026-09-22T22:23:00Z';
const tz = 'America/Los_Angeles';
const clean = (push) => {
  expect(findPushTextDefects(push.title)).toEqual([]);
  expect(findPushTextDefects(push.message)).toEqual([]);
};

describe('composeStravaSyncPush', () => {
  it('stale sweep: spoken local time, plain error, stage tag on Household alerts', () => {
    const push = composeStravaSyncPush({
      stage: 'sweep', status: 'stale', lastSuccessAt: '2026-09-22T17:23:00Z',
      error: 'No access token available. Call refreshToken first.', now, timezone: tz,
    });
    expect(push.title).toBe('⚠️ Strava sync stalled');
    expect(push.message).toBe('Titles, notes and timelines haven’t synced with Strava for 5 hr (last worked 10:23 AM). Last error: Strava sign-in expired');
    expect(push.data).toMatchObject({ tag: 'strava-sync-sweep', channel: 'Household alerts', importance: 'high' });
    clean(push);
  });

  it('stale harvest with no recorded success', () => {
    const push = composeStravaSyncPush({ stage: 'harvest', status: 'stale', now, timezone: tz });
    expect(push.message).toBe('Activities haven’t been pulled from Strava since the server started');
    clean(push);
  });

  it('missing webhooks name the activities', () => {
    const push = composeStravaSyncPush({ stage: 'webhook', status: 'stale', activityNames: ['Seattle North Spartan Sprint 5K - Saturday'], now });
    expect(push.message).toBe('An activity arrived without a webhook, so it wasn’t matched to a workout: “Seattle North Spartan Sprint 5K - Saturday”');
    clean(push);
  });

  it('integrity counts sessions', () => {
    const push = composeStravaSyncPush({ stage: 'integrity', status: 'stale', count: 2, now });
    expect(push.message).toMatch(/^2 Strava workouts still have/);
    clean(push);
  });

  it('recovery replaces the same card without ringing', () => {
    const push = composeStravaSyncPush({ stage: 'sweep', status: 'recovered', now });
    expect(push).toMatchObject({ title: '✅ Strava sync recovered', data: { tag: 'strava-sync-sweep', alert_once: true } });
    clean(push);
  });

  it('never leaks raw error text', () => {
    expect(plainSyncError('Request failed with status code 401')).toBe('Strava sign-in expired');
    expect(plainSyncError('Request failed with status code 429')).toBe('Strava rate limit reached');
    expect(plainSyncError('TypeError: cannot read x of undefined')).toBe('an unexpected error (details in the logs)');
    expect(plainSyncError(null)).toBeNull();
  });
});
