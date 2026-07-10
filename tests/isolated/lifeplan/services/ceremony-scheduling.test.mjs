import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CeremonyService } from '#apps/lifeplan/services/CeremonyService.mjs';
import { CeremonyScheduler } from '#apps/lifeplan/services/CeremonyScheduler.mjs';
import { frozenClock } from '../../../_lib/clock-helper.mjs';

describe('CeremonyService', () => {
  let service;
  let mockLifePlanStore;
  let mockCeremonyRecordStore;
  let mockCadenceService;

  const mockPlan = {
    goals: [
      { id: 'g1', name: 'Run marathon', state: 'committed', quality: 'fitness', metrics: [{ name: 'miles', current: 20, target: 26 }] },
      { id: 'g2', name: 'Learn piano', state: 'ready', quality: 'creativity' },
    ],
    beliefs: [
      { id: 'b1', if_hypothesis: 'exercise daily', confidence: 0.7, state: 'testing', evidence_history: [{ type: 'confirmation', date: '2025-06-10' }] },
    ],
    values: [
      { id: 'v1', name: 'Health', rank: 1, alignment_state: 'aligned' },
      { id: 'v2', name: 'Growth', rank: 2, alignment_state: 'drifting' },
    ],
    qualities: [
      { id: 'q1', name: 'Discipline', rules: [{ trigger: 'alarm rings', action: 'get up immediately', effectiveness: 'effective' }] },
    ],
    ceremonies: {
      unit_intention: { enabled: true },
      cycle_retro: { enabled: true },
    },
    cadence: {},
    toJSON() { return this; },
    getActiveGoals() { return this.goals.filter(g => g.state !== 'achieved' && g.state !== 'failed'); },
  };

  beforeEach(() => {
    mockLifePlanStore = {
      load: vi.fn().mockReturnValue(mockPlan),
      save: vi.fn(),
    };
    mockCeremonyRecordStore = {
      hasRecord: vi.fn().mockReturnValue(false),
      saveRecord: vi.fn(),
      getRecords: vi.fn().mockReturnValue([]),
    };
    mockCadenceService = {
      resolve: vi.fn().mockReturnValue({
        unit: { periodId: '2025-U165', alias: 'Day 165' },
        cycle: { periodId: '2025-C24', alias: 'Cycle 24' },
      }),
    };

    service = new CeremonyService({
      lifePlanStore: mockLifePlanStore,
      ceremonyRecordStore: mockCeremonyRecordStore,
      cadenceService: mockCadenceService,
    });
  });

  it('getCeremonyContent returns unit_intention content', () => {
    const content = service.getCeremonyContent('unit_intention', 'testuser');

    expect(content.type).toBe('unit_intention');
    expect(content.activeGoals).toHaveLength(2);
    expect(content.cadencePosition).toBeDefined();
    expect(content.rules).toBeDefined();
  });

  it('getCeremonyContent returns cycle_retro content', () => {
    const content = service.getCeremonyContent('cycle_retro', 'testuser');

    expect(content.type).toBe('cycle_retro');
    expect(content.goalProgress).toBeDefined();
    expect(content.beliefEvidence).toBeDefined();
    expect(content.valueDrift).toBeDefined();
    expect(content.ruleEffectiveness).toBeDefined();
  });

  it('completeCeremony records and saves', () => {
    service.completeCeremony('unit_intention', 'testuser', {
      intentions: ['Focus on running', 'Practice piano'],
    });

    expect(mockCeremonyRecordStore.saveRecord).toHaveBeenCalled();
    const savedRecord = mockCeremonyRecordStore.saveRecord.mock.calls[0][1];
    expect(savedRecord.type).toBe('unit_intention');
    expect(savedRecord.responses.intentions).toHaveLength(2);
  });

  it('completeCeremony returns false for unknown type', () => {
    const result = service.completeCeremony('unknown_type', 'testuser', {});
    expect(result).toBe(false);
  });
});

describe('CeremonyScheduler', () => {
  let scheduler;
  let deps;
  let mockNotificationService;
  let mockLifePlanStore;
  let mockCeremonyRecordStore;
  let mockCadenceService;

  const ALL_DEFAULT_TYPES_DISABLED = {
    unit_intention: { enabled: false },
    unit_capture: { enabled: false },
    cycle_retro: { enabled: false },
    phase_review: { enabled: false },
  };

  beforeEach(() => {
    mockNotificationService = {
      send: vi.fn().mockResolvedValue([{ delivered: true, channel: 'app' }]),
    };
    mockLifePlanStore = {
      load: vi.fn().mockReturnValue({
        ceremonies: {
          ...ALL_DEFAULT_TYPES_DISABLED,
          unit_intention: { enabled: true },
          cycle_retro: { enabled: true },
        },
        cadence: {},
      }),
    };
    mockCeremonyRecordStore = {
      hasRecord: vi.fn().mockReturnValue(false),
      getLatestRecord: vi.fn().mockReturnValue(null),
    };
    mockCadenceService = {
      resolve: vi.fn().mockReturnValue({
        unit: { periodId: '2025-U165' },
        cycle: { periodId: '2025-C24' },
      }),
      isCeremonyDue: vi.fn().mockReturnValue(true),
    };

    deps = {
      notificationService: mockNotificationService,
      lifePlanStore: mockLifePlanStore,
      ceremonyRecordStore: mockCeremonyRecordStore,
      cadenceService: mockCadenceService,
      timezone: 'UTC',
      // 07:00 = unit_intention's default delivery hour, so day-level tests
      // exercise the full pipeline through the hour gate.
      clock: frozenClock('2025-06-15T07:00:00Z'),
    };

    scheduler = new CeremonyScheduler(deps);
  });

  it('sends notification when ceremony is due', async () => {
    const sent = await scheduler.checkAndNotify('testuser');

    expect(mockNotificationService.send).toHaveBeenCalled();
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0].delivered).toBe(true);
  });

  it('sends a valid notification intent (category, metadata)', async () => {
    await scheduler.checkAndNotify('testuser');

    const intent = mockNotificationService.send.mock.calls[0][0];
    expect(intent.category).toBe('ceremony');
    expect(intent.urgency).toBe('normal');
    expect(intent.metadata.username).toBe('testuser');
    expect(intent.metadata.ceremony).toBeDefined();
    expect(intent.metadata.periodId).toBeDefined();
  });

  it('passes real timing strings to isCeremonyDue', async () => {
    // Hour gating means unit_intention (07) and cycle_retro (17) reach
    // isCeremonyDue in different runs — check both hours.
    await scheduler.checkAndNotify('testuser');
    const at17 = new CeremonyScheduler({ ...deps, clock: frozenClock('2025-06-15T17:00:00Z') });
    await at17.checkAndNotify('testuser');

    const timings = mockCadenceService.isCeremonyDue.mock.calls.map(c => c[0]);
    expect(timings).toContain('start_of_unit');
    expect(timings).toContain('end_of_cycle');
    // signature: (timing, cadenceConfig, today, lastCeremonyDate)
    const [, cadenceConfig, today] = mockCadenceService.isCeremonyDue.mock.calls[0];
    expect(cadenceConfig).toEqual({});
    expect(today).toBeInstanceOf(Date);
  });

  it('skips already-completed ceremonies', async () => {
    mockCeremonyRecordStore.hasRecord.mockReturnValue(true);

    await scheduler.checkAndNotify('testuser');

    expect(mockNotificationService.send).not.toHaveBeenCalled();
  });

  it('respects enabled/disabled config', async () => {
    mockLifePlanStore.load.mockReturnValue({
      ceremonies: { ...ALL_DEFAULT_TYPES_DISABLED },
      cadence: {},
    });

    await scheduler.checkAndNotify('testuser');

    expect(mockNotificationService.send).not.toHaveBeenCalled();
  });

  it('defaults UI-complete ceremonies to enabled when plan has no ceremonies config', async () => {
    mockLifePlanStore.load.mockReturnValue({ cadence: {} });

    // Run at each type's delivery hour: intention 07, retro 17.
    const sent7 = await scheduler.checkAndNotify('testuser');
    const at17 = new CeremonyScheduler({ ...deps, clock: frozenClock('2025-06-15T17:00:00Z') });
    const sent17 = await at17.checkAndNotify('testuser');

    const types = [...sent7, ...sent17].map(s => s.type);
    expect(types).toContain('unit_intention');
    expect(types).toContain('cycle_retro');
    // season_alignment / era_vision have no UI — never default-enabled
    expect(types).not.toContain('season_alignment');
    expect(types).not.toContain('era_vision');
  });

  it('uses cadence to determine due ceremonies', async () => {
    mockCadenceService.isCeremonyDue.mockReturnValue(false);

    await scheduler.checkAndNotify('testuser');

    // The hour gate passed (07:00 = unit_intention hour) so cadence was
    // actually consulted — the skip is cadence-driven, not hour-driven.
    expect(mockCadenceService.isCeremonyDue).toHaveBeenCalled();
    expect(mockNotificationService.send).not.toHaveBeenCalled();
  });

  it('gates each ceremony to its delivery hour (default: intention 07, capture 20)', async () => {
    mockLifePlanStore.load.mockReturnValue({
      ceremonies: {
        ...ALL_DEFAULT_TYPES_DISABLED,
        unit_intention: { enabled: true },
        unit_capture: { enabled: true },
      },
      cadence: {},
    });

    const at7am = new CeremonyScheduler({ ...deps, timezone: 'UTC', clock: { now: () => new Date('2025-06-15T07:30:00Z') } });
    const sent7 = await at7am.checkAndNotify('test-user');
    expect(sent7.map(s => s.type)).toContain('unit_intention');
    expect(sent7.map(s => s.type)).not.toContain('unit_capture');

    const at8pm = new CeremonyScheduler({ ...deps, timezone: 'UTC', clock: { now: () => new Date('2025-06-15T20:10:00Z') } });
    const sent20 = await at8pm.checkAndNotify('test-user');
    expect(sent20.map(s => s.type)).toContain('unit_capture');
    expect(sent20.map(s => s.type)).not.toContain('unit_intention');
  });

  it('honors plan.ceremonies.<type>.at override', async () => {
    mockLifePlanStore.load.mockReturnValue({ ceremonies: { unit_intention: { enabled: true, at: '09:00' } }, cadence: {} });
    const at9 = new CeremonyScheduler({ ...deps, timezone: 'UTC', clock: { now: () => new Date('2025-06-15T09:05:00Z') } });
    expect((await at9.checkAndNotify('test-user')).map(s => s.type)).toContain('unit_intention');

    // The override replaces the default hour — 07:00 no longer fires.
    const at7 = new CeremonyScheduler({ ...deps, timezone: 'UTC', clock: { now: () => new Date('2025-06-15T07:05:00Z') } });
    expect((await at7.checkAndNotify('test-user')).map(s => s.type)).not.toContain('unit_intention');
  });

  it('gates by household-local hour, not UTC', async () => {
    // 14:00Z = 07:00 PDT — unit_intention's delivery hour in LA
    const laMorning = new CeremonyScheduler({ ...deps, timezone: 'America/Los_Angeles', clock: { now: () => new Date('2025-06-15T14:00:00Z') } });
    expect((await laMorning.checkAndNotify('test-user')).map(s => s.type)).toContain('unit_intention');

    // 07:00Z = midnight PDT — would fire under UTC gating, must not in LA
    const laMidnight = new CeremonyScheduler({ ...deps, timezone: 'America/Los_Angeles', clock: { now: () => new Date('2025-06-15T07:00:00Z') } });
    expect((await laMidnight.checkAndNotify('test-user')).map(s => s.type)).not.toContain('unit_intention');
  });

  it('falls back to UTC on invalid timezone', async () => {
    const bad = new CeremonyScheduler({ ...deps, timezone: 'Not/A_Zone', clock: { now: () => new Date('2025-06-15T07:00:00Z') } });
    expect((await bad.checkAndNotify('test-user')).map(s => s.type)).toContain('unit_intention');
  });
});
