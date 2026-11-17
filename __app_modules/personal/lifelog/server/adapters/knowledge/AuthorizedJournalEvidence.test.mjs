import { it, expect, vi } from 'vitest';
import { HistoricalJournalEvidence } from './HistoricalJournalEvidence.mjs';
import { AuthorizedJournalEvidence } from './AuthorizedJournalEvidence.mjs';
it('resolves only durable hash-valid imports without changing legacy rows or live extraction', async () => {
  const asOf = Date.parse('2026-11-03T18:00Z'),
    from = asOf - 90 * 86400000;
  const rows = [{
    id: 'old-entry',
    senderId: 'author',
    timestamp: '2026-11-02T18:00Z',
    content: 'I will finish the story.'
  }];
  const historical = new HistoricalJournalEvidence({
    loadJournal: async () => ({
      messages: rows
    }),
    identityForUser: async () => ({
      senderId: 'author',
      conversationId: 'private'
    }),
    timezoneForUser: () => 'America/Los_Angeles'
  });
  const message = (await historical.read({
    username: 'sample',
    from,
    asOf
  })).messages[0];
  const authorizations = {};
  const live = {
    readUserMessages: vi.fn(async () => ({
      messages: []
    })),
    readByRefs: vi.fn(async () => []),
    readRevocations: vi.fn(async () => [])
  };
  const evidence = new AuthorizedJournalEvidence({
    live,
    historical,
    readAuthorizations: async ({
      username
    }) => username === 'sample' ? authorizations : {}
  });
  const query = {
    username: 'sample',
    refs: [message.ref]
  };
  expect(await evidence.readByRefs(query)).toEqual([]);
  authorizations[message.ref] = {
    originalRef: message.originalRef,
    sourceHash: message.sourceHash,
    from,
    asOf,
    jobId: 'job-1'
  };
  expect(await evidence.readByRefs(query)).toEqual([expect.objectContaining({
    ref: message.ref,
    verified: true,
    previewOnly: false,
    verificationKind: 'operator_import',
    origin: 'historical_import'
  })]);
  expect(await evidence.readByRefs({
    ...query,
    username: 'other'
  })).toEqual([]);
  expect((await evidence.readUserMessages({
    username: 'sample'
  })).messages).toEqual([]);
  expect(rows[0]).not.toHaveProperty('source');
  rows[0].content = 'I finished the story.';
  expect(await evidence.readByRefs(query)).toEqual([]);
  expect(await evidence.readRevocations({
    username: 'sample'
  })).toContain(message.ref);
});
