/**
 * Integration test: CeremonyScheduler triggers → NotificationService routes
 * by category preference → channel adapters receive normalized intents.
 *
 * Uses the real application-layer NotificationService (intent normalization +
 * preference routing) with fake channel adapters.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { CeremonyScheduler } from '#apps/lifeplan/services/CeremonyScheduler.mjs';
import { NotificationService } from '#apps/notification/NotificationService.mjs';
import { NotificationPreference } from '#domains/notification/entities/NotificationPreference.mjs';

describe('CeremonyScheduler — ceremony delivery (integrated)', () => {
  let scheduler;
  let telegramSends;
  let appSends;

  beforeEach(() => {
    telegramSends = [];
    appSends = [];

    const telegramAdapter = {
      channel: 'telegram',
      send: async (intent) => { telegramSends.push(intent); return { delivered: true, channelId: 'tg-1' }; },
    };
    const appAdapter = {
      channel: 'app',
      send: async (intent) => { appSends.push(intent); return { delivered: true, channelId: 'app-1' }; },
    };

    const notificationService = new NotificationService({
      adapters: [telegramAdapter, appAdapter],
      preferenceLoader: () => new NotificationPreference({
        ceremony: { normal: ['telegram', 'app'] },
      }),
    });

    const planStore = {
      load: () => ({
        ceremonies: {
          unit_intention: { enabled: true },
          unit_capture: { enabled: false },
          cycle_retro: { enabled: true },
          phase_review: { enabled: false },
          season_alignment: { enabled: true },
          era_vision: { enabled: true },
        },
        cadence: {},
      }),
    };

    const ceremonyRecordStore = {
      // unit_intention already completed for today's period
      hasRecord: (username, type, periodId) =>
        type === 'unit_intention' && periodId === '2025-06-07',
      getLatestRecord: () => null,
    };

    const cadenceService = {
      resolve: () => ({
        unit: { periodId: '2025-06-07' },
        cycle: { periodId: '2025-W23' },
        phase: { periodId: '2025-06' },
        season: { periodId: '2025-Q2' },
        era: { periodId: '2025' },
      }),
      // signature: (timing, cadenceConfig, today, lastCeremonyDate)
      isCeremonyDue: (timing) => timing !== 'end_of_era',
    };

    scheduler = new CeremonyScheduler({
      notificationService,
      lifePlanStore: planStore,
      ceremonyRecordStore,
      cadenceService,
      clock: { now: () => new Date('2025-06-07T08:00:00Z') },
    });
  });

  it('sends notifications for due, enabled, not-yet-completed ceremonies', async () => {
    const sent = await scheduler.checkAndNotify('test-user');

    // unit_intention: already done → skip
    // unit_capture / phase_review: disabled → skip
    // cycle_retro + season_alignment: due + enabled + not done → send
    // era_vision: enabled but not due → skip
    const types = sent.map(s => s.type).sort();
    expect(types).toEqual(['cycle_retro', 'season_alignment']);
    expect(sent.every(s => s.delivered)).toBe(true);
  });

  it('routes ceremony category to both preferred channels', async () => {
    await scheduler.checkAndNotify('test-user');

    expect(telegramSends).toHaveLength(2);
    expect(appSends).toHaveLength(2);
  });

  it('delivers normalized intents with ceremony metadata', async () => {
    await scheduler.checkAndNotify('test-user');

    const cycleIntent = telegramSends.find(i => i.metadata.ceremony === 'cycle_retro');
    expect(cycleIntent).toBeDefined();
    expect(cycleIntent.category).toBe('ceremony');
    expect(cycleIntent.metadata.username).toBe('test-user');
    expect(cycleIntent.metadata.periodId).toBe('2025-W23');
    expect(typeof cycleIntent.toJSON).toBe('function');
    expect(cycleIntent.title).toBeDefined();
    expect(cycleIntent.body).toContain('cycle retro');
  });

  it('rejects invalid categories at the service boundary', async () => {
    const notificationService = new NotificationService({ adapters: [] });
    await expect(notificationService.send({ title: 't', body: 'b', category: 'lifeplan', urgency: 'normal' }))
      .rejects.toThrow(/Invalid notification category/);
  });

  it('skips all notifications when no plan exists', async () => {
    const sends = [];
    scheduler = new CeremonyScheduler({
      notificationService: { send: async (i) => { sends.push(i); return []; } },
      lifePlanStore: { load: () => null },
      ceremonyRecordStore: { hasRecord: () => false, getLatestRecord: () => null },
      cadenceService: { resolve: () => ({}), isCeremonyDue: () => true },
      clock: { now: () => new Date('2025-06-07T08:00:00Z') },
    });

    const sent = await scheduler.checkAndNotify('test-user');
    expect(sent).toHaveLength(0);
    expect(sends).toHaveLength(0);
  });
});
