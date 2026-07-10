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

    scheduler = new CeremonyScheduler({
      notificationService: mockNotificationService,
      lifePlanStore: mockLifePlanStore,
      ceremonyRecordStore: mockCeremonyRecordStore,
      cadenceService: mockCadenceService,
      clock: frozenClock('2025-06-15T08:00:00Z'),
    });
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
    await scheduler.checkAndNotify('testuser');

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

    const sent = await scheduler.checkAndNotify('testuser');

    // unit_intention, unit_capture (both unit period), cycle_retro — all due per mock
    const types = sent.map(s => s.type);
    expect(types).toContain('unit_intention');
    expect(types).toContain('cycle_retro');
    // season_alignment / era_vision have no UI — never default-enabled
    expect(types).not.toContain('season_alignment');
    expect(types).not.toContain('era_vision');
  });

  it('uses cadence to determine due ceremonies', async () => {
    mockCadenceService.isCeremonyDue.mockReturnValue(false);

    await scheduler.checkAndNotify('testuser');

    expect(mockNotificationService.send).not.toHaveBeenCalled();
  });
});
