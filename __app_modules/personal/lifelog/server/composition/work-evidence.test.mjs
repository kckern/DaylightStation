import { it, expect } from 'vitest';
import { createAuthoredJournalEvidence } from '../knowledge-runtime.mjs';
import { createHash } from 'node:crypto';
it('supplies exact current authored receipts independently of KB activation and rejects edits/provider rows', async () => {
  const conversationId = 'telegram:private',
    senderId = '101';
  const row = {
    id: '99',
    role: 'user',
    senderId,
    content: 'I finished Contact Sample',
    timestamp: '2026-11-17T18:00:00Z'
  };
  row.source = {
    platform: 'telegram',
    verified: true,
    senderId,
    conversationId,
    messageId: '99',
    contentHash: createHash('sha256').update(JSON.stringify([row.id, senderId, conversationId, row.content, row.timestamp])).digest('hex')
  };
  const rows = [row, {
    ...row,
    role: 'assistant'
  }];
  const evidence = createAuthoredJournalEvidence({
    loadJournal: async () => ({
      messages: rows
    }),
    identityForUser: () => ({
      senderId,
      conversationId
    }),
    timezoneForUser: () => 'America/Los_Angeles'
  });
  const dto = await evidence.readForMessage({
    username: 'sample',
    conversationId,
    messageId: '99',
    revision: null
  });
  expect(dto).toMatchObject({
    content: row.content,
    verified: true,
    previewOnly: false,
    source: 'user'
  });
  row.content = 'Changed without a receipt';
  expect(await evidence.readByRefs({
    username: 'sample',
    refs: [dto.ref]
  })).toEqual([]);
  expect(await evidence.readForMessage({
    username: 'sample',
    conversationId,
    messageId: '99',
    revision: null
  })).toBeNull();
});
