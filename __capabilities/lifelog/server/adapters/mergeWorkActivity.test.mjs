import { it, expect } from 'vitest';
import { mergeWorkActivity } from './mergeWorkActivity.mjs';
const at = Date.parse('2027-01-01T00:30:00Z');
const event = {
  id: 'work:1',
  username: 'sample',
  ref: {
    provider: 'todoist',
    accountId: 'personal',
    kind: 'task',
    id: 'task-1'
  },
  type: 'completed',
  occurredAt: at,
  observedAt: at,
  providerVersion: 'v1',
  occurrenceId: String(at),
  origin: 'provider',
  actorId: 'other-person',
  sourceRefs: ['provider:1']
};
it('deduplicates exact provider identity/time and preserves distinct accounts, IDs and recurrences', () => {
  const legacy = {
    source: 'todoist',
    category: 'productivity',
    data: {
      created: [],
      completed: [{
        id: 'task-1',
        accountId: 'personal',
        action: 'completed',
        occurredAt: at,
        content: 'Sample'
      }, {
        id: 'task-2',
        accountId: 'personal',
        action: 'completed',
        occurredAt: at,
        content: 'Sample'
      }, {
        id: 'task-1',
        accountId: 'other',
        action: 'completed',
        occurredAt: at,
        content: 'Sample'
      }],
      total: 3
    },
    summary: 'legacy'
  };
  const entries = mergeWorkActivity({
    legacyEntries: [legacy],
    canonicalEvents: [event, {
      ...event,
      id: 'work:2',
      occurredAt: at + 1000,
      occurrenceId: String(at + 1000)
    }],
    date: '2026-12-31',
    timezone: 'America/Los_Angeles'
  });
  expect(entries.find(e => e.source === 'todoist').data.completed).toHaveLength(2);
  expect(entries.find(e => e.source === 'work').data.events).toHaveLength(2);
  expect(entries.find(e => e.source === 'work').summary).toContain('Provider');
});
it('never suppresses unknown account or unknown legacy time by title', () => {
  const legacy = {
    source: 'todoist',
    data: {
      created: [],
      completed: [{
        id: 'task-1',
        content: 'Sample'
      }],
      total: 1
    }
  };
  expect(mergeWorkActivity({
    legacyEntries: [legacy],
    canonicalEvents: [event],
    date: '2026-12-31',
    timezone: 'America/Los_Angeles'
  }).find(e => e.source === 'todoist').data.completed).toHaveLength(1);
});
import { HarvestedLifelogSourceRegistry } from './HarvestedLifelogSourceRegistry.mjs';
it('uses identical local-day merging for readDay and readRange', async () => {
  const ranges = [];
  const registry = new HarvestedLifelogSourceRegistry({
    userLoadFile: (_u, file) => file === 'todoist' ? {
      '2026-12-31': [{
        id: 'task-1',
        accountId: 'personal',
        action: 'completed',
        occurredAt: at,
        content: 'Sample'
      }]
    } : null,
    workActivityReader: {
      read: async input => {
        ranges.push(input);
        return [event];
      }
    },
    userTimezone: () => 'America/Los_Angeles'
  });
  const day = await registry.readDay('sample', '2026-12-31'),
    range = await registry.readRange('sample', ['2026-12-31']);
  expect(day).toEqual(range.days['2026-12-31']);
  expect(day).toHaveLength(1);
  expect(day[0].source).toBe('work');
  expect(ranges[0]).toMatchObject({
    from: Date.parse('2026-12-31T08:00:00Z'),
    to: Date.parse('2027-01-01T07:59:59.999Z')
  });
});
it('rebuilds legacy summaries after removing a canonical duplicate', () => {
  const legacy = {
    source: 'todoist',
    category: 'productivity',
    data: {
      created: [],
      completed: [{
        id: 'task-1',
        accountId: 'personal',
        action: 'completed',
        occurredAt: at,
        content: 'MATCHEDONLY'
      }, {
        id: 'task-2',
        accountId: 'personal',
        action: 'completed',
        occurredAt: at,
        content: 'OTHER'
      }],
      total: 2
    },
    summary: 'MATCHEDONLY and OTHER'
  };
  const r = mergeWorkActivity({
    legacyEntries: [legacy],
    canonicalEvents: [event],
    date: '2026-12-31',
    timezone: 'America/Los_Angeles'
  });
  expect(r.find(e => e.source === 'todoist').summary).not.toContain('MATCHEDONLY');
  expect(r.find(e => e.source === 'todoist').summary).toContain('OTHER');
});
it('keeps minute-only legacy history when multiple canonical occurrences match that minute', () => {
  const legacy = {
    source: 'todoist',
    data: {
      created: [],
      completed: [{
        id: 'task-1',
        accountId: 'personal',
        action: 'completed',
        time: '16:30',
        content: 'Uncertain occurrence'
      }],
      total: 1
    }
  };
  const canonical = [event, {
    ...event,
    id: 'work:2',
    occurredAt: at + 1000,
    occurrenceId: String(at + 1000)
  }];
  const entries = mergeWorkActivity({
    legacyEntries: [legacy],
    canonicalEvents: canonical,
    date: '2026-12-31',
    timezone: 'America/Los_Angeles'
  });
  const legacyEntry = entries.find(e => e.source === 'todoist');
  expect(legacyEntry).toBeDefined();
  expect(legacyEntry.data.completed).toHaveLength(1);
});
