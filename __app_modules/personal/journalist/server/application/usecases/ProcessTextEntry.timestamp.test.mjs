import test from 'node:test';
import assert from 'node:assert/strict';
import { ProcessTextEntry } from './ProcessTextEntry.mjs';

function build() {
  const saves = [];
  const useCase = new ProcessTextEntry({
    messagingGateway: { sendMessage: async () => ({ messageId: 'sent-1' }) },
    aiGateway: { chat: async () => '{"acknowledgment":"","question":"And then?"}' },
    journalEntryRepository: {
      saveMessage: async (...args) => { saves.push(args); },
      getMessageHistory: async () => [],
    },
    logger: {},
  });
  return { useCase, saves };
}

const entry = (over = {}) => ({ chatId: 'telegram:b1_c2', text: 'Hello.', messageId: '42', senderId: '7', senderName: 'Sam', ...over });

test('an entry with no time is saved exactly as before: the message and nothing else', async () => {
  const { useCase, saves } = build();
  await useCase.execute(entry());
  assert.equal(saves[0].length, 1);
  assert.equal(saves[0][0].messageId, '42');
});

test('an entry made earlier tells the journal when', async () => {
  const { useCase, saves } = build();
  const at = new Date(Date.UTC(2026, 10, 16, 18, 30, 0));
  await useCase.execute(entry({ timestamp: at }));
  assert.equal(saves[0].length, 2);
  assert.deepEqual(saves[0][1], { at });
  // The reply is made now, so it is saved the usual way.
  assert.equal(saves[1].length, 1);
});
