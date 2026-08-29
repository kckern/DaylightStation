import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliverScheduledMorningDebrief } from './DeliverScheduledMorningDebrief.mjs';

test('scheduled debrief resolves identity, generates, and delivers once', async () => {
  const generated = [];
  const delivered = [];
  const operation = new DeliverScheduledMorningDebrief({
    username: 'user_1',
    resolveConversationId: () => 'telegram:b1_c2',
    generateMorningDebrief: { execute: async (input) => {
      generated.push(input);
      return { success: true, date: '2026-08-28' };
    } },
    sendMorningDebrief: { execute: async (input) => delivered.push(input) },
    logger: { info() {}, warn() {} },
  });
  await operation.execute();
  assert.deepEqual(generated, [{ username: 'user_1', conversationId: 'telegram:b1_c2' }]);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].conversationId, 'telegram:b1_c2');
});

test('scheduled debrief preserves skip behavior without attempting delivery', async () => {
  let delivered = false;
  const operation = new DeliverScheduledMorningDebrief({
    username: 'user_1',
    resolveConversationId: () => 'telegram:b1_c2',
    generateMorningDebrief: { execute: async () => ({ success: false, reason: 'already-sent' }) },
    sendMorningDebrief: { execute: async () => { delivered = true; } },
    logger: { info() {}, warn() {} },
  });
  await operation.execute();
  assert.equal(delivered, false);
});
