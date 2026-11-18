import { it, expect, vi } from 'vitest';
import { KnowledgeAttentionHistory } from './KnowledgeAttentionHistory.mjs';
it('reads only the injected owner port and discards private content', async () => {
  const read = vi.fn(async () => ({
    available: true,
    deliveries: [{
      id: 'kb:one',
      day: '2026-11-17',
      channel: 'morning',
      status: 'delivered',
      questionUnits: 2,
      deliveredAt: 1,
      quote: 'private'
    }],
    reservations: [],
    unansweredInvitations: []
  }));
  const history = new KnowledgeAttentionHistory({
    readHistory: read
  });
  const input = {
    username: 'sample',
    askDate: '2026-11-17',
    asOf: 2
  };
  const value = await history.read(input);
  expect(read).toHaveBeenCalledWith(input);
  expect(value.deliveries[0].quote).toBeUndefined();
  expect(value.deliveries[0].questionUnits).toBe(2);
});
it('reports unavailability rather than inventing empty acknowledged history', async () => {
  const h = new KnowledgeAttentionHistory({
    readHistory: async () => {
      throw Error('offline');
    }
  });
  expect(await h.read({
    username: 'sample',
    askDate: '2026-11-17',
    asOf: 1
  })).toMatchObject({
    available: false
  });
});
it('rejects malformed accounting rows instead of treating NaN units as available capacity', async () => {
  const h = new KnowledgeAttentionHistory({
    readHistory: async () => ({
      available: true,
      deliveries: [{
        id: 'bad',
        day: '2026-11-17',
        status: 'delivered',
        channel: 'morning',
        questionUnits: 'two',
        deliveredAt: 1
      }],
      reservations: [],
      unansweredInvitations: []
    })
  });
  expect((await h.read({
    username: 'sample',
    askDate: '2026-11-17',
    asOf: 1
  })).available).toBe(false);
});
it('accepts a historical overage without disabling unrelated dates', async () => {
  const h = new KnowledgeAttentionHistory({
    readHistory: async () => ({
      available: true,
      deliveries: [{
        id: 'old',
        day: '2020-01-01',
        channel: 'morning',
        status: 'delivered',
        questionUnits: 6,
        deliveredAt: 1
      }],
      reservations: [],
      unansweredInvitations: []
    })
  });
  expect((await h.read({
    username: 'sample',
    askDate: '2026-11-17',
    asOf: 2
  })).available).toBe(true);
});
