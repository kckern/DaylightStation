import { it, expect } from 'vitest';
import { WorkExtractor } from './WorkExtractor.mjs';
it('attributes native occurrences to local day and does not impersonate authored journal prose', () => {
  const x = new WorkExtractor({
      timezone: 'America/Los_Angeles'
    }),
    event = {
      id: 'work:1',
      ref: {
        provider: 'clickup',
        accountId: 'delivery',
        kind: 'task',
        id: 'task'
      },
      type: 'completed',
      occurredAt: Date.parse('2027-01-01T00:30:00Z'),
      actorId: 'someone-else'
    };
  const r = x.extractForDate([event], '2026-12-31');
  expect(r.events).toEqual([event]);
  expect(x.extractForDate([event], '2027-01-01')).toBeNull();
  expect(x.summarize(r)).toContain('someone-else');
  expect(x.source).toBe('work');
});
