import { describe, it, expect, vi } from 'vitest';
import { HealthCoachAgent } from '../../../../backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs';

describe('HealthCoachAgent.getMemoryConfig', () => {
  it('reads last_messages from configService when present', () => {
    const cfg = HealthCoachAgent.getMemoryConfig({
      configService: {
        getAppConfig: () => ({
          default: { memory: { last_messages: 75 } },
          overrides: {},
        }),
      },
    });
    expect(cfg.lastMessages).toBe(75);
  });

  it('falls back to hardcoded default (100) when no configService', () => {
    const cfg = HealthCoachAgent.getMemoryConfig({ configService: null });
    expect(cfg.lastMessages).toBe(100);
  });

  it('attaches working memory template when enabled in config', () => {
    const cfg = HealthCoachAgent.getMemoryConfig({
      configService: {
        getAppConfig: () => ({
          default: {
            memory: {
              working_memory: { enabled: true, scope: 'resource' },
            },
          },
        }),
      },
    });
    expect(cfg.workingMemory).toBeDefined();
    expect(cfg.workingMemory.enabled).toBe(true);
    expect(cfg.workingMemory.scope).toBe('resource');
    expect(typeof cfg.workingMemory.template).toBe('string');
    expect(cfg.workingMemory.template).toMatch(/Recent Focus Areas/);
  });

  it('omits workingMemory when disabled in config', () => {
    const cfg = HealthCoachAgent.getMemoryConfig({
      configService: {
        getAppConfig: () => ({
          default: { memory: { working_memory: { enabled: false } } },
          overrides: {},
        }),
      },
    });
    expect(cfg.workingMemory).toBeUndefined();
  });

  it('honors per-agent overrides over defaults', () => {
    const cfg = HealthCoachAgent.getMemoryConfig({
      configService: {
        getAppConfig: () => ({
          default: { memory: { last_messages: 50 } },
          overrides: { 'health-coach': { memory: { last_messages: 200 } } },
        }),
      },
    });
    expect(cfg.lastMessages).toBe(200);
  });

  it('uses scope: resource as default when not in YAML', () => {
    const cfg = HealthCoachAgent.getMemoryConfig({ configService: null });
    expect(cfg.workingMemory.scope).toBe('resource');
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
