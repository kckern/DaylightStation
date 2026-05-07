// tests/isolated/agents/health-coach/filter_validation/filter_contract.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { EventQueryService } from '../../../../../backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs';

const makeSvc = (sessions = []) => new EventQueryService({
  sessionService: { listSessionsInRange: vi.fn(async () => sessions) },
  householdId: 'kckern',
});

describe('queryEvents — filter contract', () => {
  it('rejects string filter with a clear error', async () => {
    const svc = makeSvc();
    await expect(svc.queryEvents({ kind: 'workout', period: 'last_7d', filter: "type == 'run'" }))
      .rejects.toThrow(/filter must be an object/i);
  });

  it('rejects array filter', async () => {
    const svc = makeSvc();
    await expect(svc.queryEvents({ kind: 'workout', period: 'last_7d', filter: ['type', 'run'] }))
      .rejects.toThrow(/filter must be an object/i);
  });

  it('rejects unknown filter keys', async () => {
    const svc = makeSvc();
    await expect(svc.queryEvents({ kind: 'workout', period: 'last_7d', filter: { sql: 'foo' } }))
      .rejects.toThrow(/unknown filter key.*sql/i);
  });

  it('accepts undefined filter', async () => {
    const svc = makeSvc([]);
    const r = await svc.queryEvents({ kind: 'workout', period: 'last_7d' });
    expect(r.events).toEqual([]);
  });

  it('accepts valid object filter', async () => {
    const svc = makeSvc([]);
    const r = await svc.queryEvents({ kind: 'workout', period: 'last_7d', filter: { type: 'Run' } });
    expect(r.events).toEqual([]);
  });
});
