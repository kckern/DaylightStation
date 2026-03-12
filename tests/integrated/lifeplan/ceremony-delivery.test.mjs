/**
 * Integration test: CeremonyScheduler triggers → NotificationService routes → adapter receives.
 *
 * Verifies the full ceremony notification delivery chain.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { CeremonyScheduler } from '#system/scheduling/CeremonyScheduler.mjs';

describe('CeremonyScheduler — ceremony delivery (integrated)', () => {
  let scheduler;
  let sentNotifications;

  beforeEach(() => {
    sentNotifications = [];

    const mockCeremonyService = {
      getCeremonyContent: async () => ({ steps: [] }),
    };

    const mockNotificationService = {
      send: (intent) => {
        sentNotifications.push(intent);
        return [{ channel: intent.channel, success: true }];
      },
    };

    const mockPlanStore = {
      load: () => ({
        ceremonies: {
          unit_intention: { enabled: true, channel: 'push' },
          cycle_retro: { enabled: true, channel: 'email' },
          phase_review: { enabled: false },
          season_alignment: { enabled: true, channel: 'push' },
        },
        cadence: { unit: 'day', cycle: 'week', phase: 'month', season: 'quarter' },
      }),
    };

    const mockCeremonyRecordStore = {
      hasRecord: (username, type, periodId) => {
        // unit_intention already done for today
        return type === 'unit_intention' && periodId === '2025-06-07';
      },
    };

    const mockCadenceService = {
      resolve: () => ({
        unit: { periodId: '2025-06-07', startDate: new Date('2025-06-07') },
        cycle: { periodId: '2025-W23', startDate: new Date('2025-06-02') },
        phase: { periodId: '2025-06', startDate: new Date('2025-06-01') },
        season: { periodId: '2025-Q2', startDate: new Date('2025-04-01') },
        era: { periodId: '2025', startDate: new Date('2025-01-01') },
      }),
      isCeremonyDue: (type) => {
        // All enabled ceremonies are due except era_vision
        return type !== 'era_vision';
      },
    };

    const clock = {
      now: () => new Date('2025-06-07T08:00:00Z'),
    };

    scheduler = new CeremonyScheduler({
      ceremonyService: mockCeremonyService,
      notificationService: mockNotificationService,
      lifePlanStore: mockPlanStore,
      ceremonyRecordStore: mockCeremonyRecordStore,
      cadenceService: mockCadenceService,
      clock,
    });
  });

  it('sends notifications for due ceremonies not yet completed', async () => {
    await scheduler.checkAndNotify('testuser');

    // unit_intention is already done → skip
    // cycle_retro is due + enabled + not done → send
    // phase_review is disabled → skip
    // season_alignment is due + enabled + not done → send
    // era_vision is not due → skip
    expect(sentNotifications).toHaveLength(2);
  });

  it('routes to correct notification channel from ceremony config', async () => {
    await scheduler.checkAndNotify('testuser');

    const cycleNotif = sentNotifications.find(n => n.ceremony === 'cycle_retro');
    expect(cycleNotif).toBeDefined();
    expect(cycleNotif.channel).toBe('email');

    const seasonNotif = sentNotifications.find(n => n.ceremony === 'season_alignment');
    expect(seasonNotif).toBeDefined();
    expect(seasonNotif.channel).toBe('push');
  });

  it('includes ceremony type and period in notification', async () => {
    await scheduler.checkAndNotify('testuser');

    const notif = sentNotifications[0];
    expect(notif.type).toBe('ceremony_due');
    expect(notif.ceremony).toBeDefined();
    expect(notif.periodId).toBeDefined();
    expect(notif.username).toBe('testuser');
    expect(notif.title).toContain('Time for');
  });

  it('skips all notifications when no plan exists', async () => {
    scheduler = new CeremonyScheduler({
      ceremonyService: {},
      notificationService: { send: (i) => sentNotifications.push(i) },
      lifePlanStore: { load: () => null },
      ceremonyRecordStore: { hasRecord: () => false },
      cadenceService: { resolve: () => ({}), isCeremonyDue: () => true },
      clock: { now: () => new Date() },
    });

    await scheduler.checkAndNotify('testuser');
    expect(sentNotifications).toHaveLength(0);
  });
});
