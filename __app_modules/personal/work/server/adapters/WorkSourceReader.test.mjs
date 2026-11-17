import { it, expect, vi } from 'vitest';
import { WorkSourceReader } from './WorkSourceReader.mjs';
it('overlays persisted latest failure after restart without changing retained facts or source dates', async () => {
  const raw = {
    accountId: 'personal',
    observedAt: 1000,
    tasks: [{
      id: 'old-task',
      modifiedAt: null
    }],
    coverage: {
      complete: true,
      reason: null
    }
  };
  const health = {
    schema: 'work-source-health/v1',
    provider: 'todoist',
    accountId: 'personal',
    observedAt: 2000,
    complete: false,
    reason: 'provider_read_failed'
  };
  const make = () => new WorkSourceReader({
    readCurrent: async () => raw,
    readHistory: async () => ({}),
    readHealth: async () => health
  });
  const first = await make().current('sample', 'todoist');
  const restarted = await make().current('sample', 'todoist');
  expect(first).toEqual(restarted);
  expect(first).toMatchObject({
    observedAt: 1000,
    tasks: raw.tasks,
    coverage: {
      complete: false,
      reason: 'provider_read_failed'
    }
  });
  expect(raw.coverage.complete).toBe(true);
});
it('does not use an older health row to override a newer complete snapshot', async () => {
  const reader = new WorkSourceReader({
    readCurrent: async () => ({
      accountId: 'personal',
      observedAt: 3000,
      coverage: {
        complete: true
      }
    }),
    readHistory: async () => ({}),
    readHealth: async () => ({
      schema: 'work-source-health/v1',
      provider: 'todoist',
      accountId: 'personal',
      observedAt: 2000,
      complete: false
    })
  });
  expect((await reader.current('sample', 'todoist')).coverage.complete).toBe(true);
});
it('validates the user/provider before reading and fails closed on unreadable health', async () => {
  const readCurrent = vi.fn(async () => ({
    observedAt: 1000,
    coverage: {
      complete: true
    }
  }));
  const reader = new WorkSourceReader({
    readCurrent,
    readHistory: async () => ({}),
    readHealth: async () => {
      throw new Error('unreadable');
    }
  });
  await expect(reader.current('../other', 'todoist')).rejects.toThrow();
  await expect(reader.current('sample', '../other')).rejects.toThrow();
  expect(readCurrent).not.toHaveBeenCalled();
  expect((await reader.current('sample', 'todoist')).coverage).toMatchObject({
    complete: false,
    reason: 'source_health_unavailable'
  });
});
