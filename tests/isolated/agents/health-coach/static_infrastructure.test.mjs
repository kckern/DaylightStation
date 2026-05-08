import { describe, it, expect, vi } from 'vitest';
import { HealthCoachAgent } from '../../../../backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs';

describe('HealthCoachAgent.getMemoryConfig', () => {
  it('returns lastMessages: 20 (workingMemory deferred — see comment in agent class)', () => {
    const cfg = HealthCoachAgent.getMemoryConfig({ logger: console });
    expect(cfg).toBeDefined();
    expect(cfg.lastMessages).toBe(20);
    // workingMemory currently disabled pending Mastra schema-conversion fix.
    // When re-enabled, assert: workingMemory.enabled === true,
    // scope === 'resource', schema defined.
  });

  it('does not require any deps to construct config', () => {
    const cfg = HealthCoachAgent.getMemoryConfig();
    expect(cfg).toBeDefined();
  });
});

describe('HealthCoachAgent.getDomainAdapters', () => {
  it('returns workout adapter when sessionService present', () => {
    const adapters = HealthCoachAgent.getDomainAdapters({
      sessionService: { listSessionsInRange: vi.fn() },
      householdId: 'default',
    });
    expect(adapters.workout).toBeDefined();
    expect(typeof adapters.workout.list).toBe('function');
  });

  it('returns null workout adapter when sessionService is missing', () => {
    const adapters = HealthCoachAgent.getDomainAdapters({
      householdId: 'default',
    });
    expect(adapters.workout).toBe(null);
  });

  it('returns null meal adapter when foodLogStore is missing', () => {
    const adapters = HealthCoachAgent.getDomainAdapters({
      sessionService: { listSessionsInRange: vi.fn() },
      householdId: 'default',
      defaultUserId: 'kc',
    });
    expect(adapters.meal).toBe(null);
  });

  it('returns meal adapter when foodLogStore present (constructs FoodLogService inline)', () => {
    const adapters = HealthCoachAgent.getDomainAdapters({
      sessionService: { listSessionsInRange: vi.fn() },
      foodLogStore: { findAll: vi.fn(), findById: vi.fn() },
      householdId: 'default',
      defaultUserId: 'kc',
    });
    expect(adapters.meal).toBeDefined();
    expect(typeof adapters.meal.list).toBe('function');
  });

  it('returns weigh_in adapter when healthService present', () => {
    const adapters = HealthCoachAgent.getDomainAdapters({
      sessionService: { listSessionsInRange: vi.fn() },
      healthService: { getHealthForRange: vi.fn() },
      householdId: 'default',
      defaultUserId: 'kc',
    });
    expect(adapters.weigh_in).toBeDefined();
  });
});

describe('HealthCoachAgent.getBaselineService', () => {
  it('returns a PersonalBaselineService when adapters and dataService given', () => {
    const adapters = { workout: { list: vi.fn() } };
    const dataService = { user: { read: vi.fn(), write: vi.fn() } };
    const svc = HealthCoachAgent.getBaselineService({ adapters, dataService });
    expect(svc).toBeDefined();
    expect(typeof svc.getBaselines).toBe('function');
  });

  it('returns null when dataService is missing', () => {
    const svc = HealthCoachAgent.getBaselineService({ adapters: { workout: {} } });
    expect(svc).toBe(null);
  });

  it('returns null when adapters missing', () => {
    const svc = HealthCoachAgent.getBaselineService({ dataService: { user: {} } });
    expect(svc).toBe(null);
  });
});

describe('HealthCoachAgent.getUserModelService', () => {
  it('returns a UserModelService when both deps present', () => {
    const svc = HealthCoachAgent.getUserModelService({
      personalConstantsService: { get: vi.fn() },
      baselineService: { getBaselines: vi.fn() },
    });
    expect(svc).toBeDefined();
    expect(typeof svc.composeContext).toBe('function');
  });

  it('returns null when personalConstantsService missing', () => {
    const svc = HealthCoachAgent.getUserModelService({
      baselineService: { getBaselines: vi.fn() },
    });
    expect(svc).toBe(null);
  });

  it('returns null when baselineService missing', () => {
    const svc = HealthCoachAgent.getUserModelService({
      personalConstantsService: { get: vi.fn() },
    });
    expect(svc).toBe(null);
  });
});
