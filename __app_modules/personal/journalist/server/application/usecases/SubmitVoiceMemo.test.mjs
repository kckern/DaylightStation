import test from 'node:test';
import assert from 'node:assert/strict';
import { SubmitVoiceMemo } from './SubmitVoiceMemo.mjs';

const CHAT = 'telegram:b1_c2';

/**
 * A journal that stores what the fake voice path saves, the way ProcessTextEntry
 * saves the user's message under the messageId it is given.
 */
function build({ transcription = 'Bought the tickets today.', failAfterSave = false, failBeforeSave = false } = {}) {
  const calls = { voice: [] };
  const journal = new Map();
  const useCase = new SubmitVoiceMemo({
    processVoiceEntry: {
      execute: async (input) => {
        calls.voice.push(input);
        if (failBeforeSave) throw new Error('transcriber down');
        if (!transcription.trim()) return { success: false, error: 'Empty transcription' };
        journal.set(`${input.chatId}|${input.messageId}`, { id: input.messageId });
        if (failAfterSave) throw new Error('gateway down');
        return { success: true, transcription, source: 'voice' };
      },
    },
    journalEntryRepository: {
      findById: async (id, chatId) => journal.get(`${chatId}|${id}`) || null,
    },
  });
  return { useCase, calls, journal };
}

const memo = (over = {}) => ({
  conversationId: CHAT, username: 'user_1', memoId: '1700000000000',
  audioBuffer: Buffer.from('aac'), mimeType: 'audio/mp4', ...over,
});

test('a memo joins the voice path as a buffer, with no Telegram file id', async () => {
  const { useCase, calls } = build();
  const result = await useCase.execute(memo());
  assert.deepEqual(result, { kind: 'accepted', memoId: '1700000000000', transcriptionLength: 25 });
  assert.equal(calls.voice.length, 1);
  const sent = calls.voice[0];
  assert.equal(sent.chatId, CHAT);
  assert.equal(sent.messageId, 'memo:1700000000000');
  assert.equal(sent.senderId, 'user_1');
  assert.equal(sent.senderName, 'user_1');
  assert.ok(Buffer.isBuffer(sent.voiceFileId.buffer));
  assert.equal(sent.voiceFileId.mimeType, 'audio/mp4');
  assert.equal(sent.responseContext, undefined);
});

test('the same memo id is journaled once', async () => {
  const { useCase, calls, journal } = build();
  await useCase.execute(memo());
  assert.deepEqual(await useCase.execute(memo()), { kind: 'duplicate', memoId: '1700000000000' });
  assert.equal(calls.voice.length, 1);
  assert.equal(journal.size, 1);
});

test('a memo already in the journal is a duplicate for a fresh process', async () => {
  const first = build();
  await first.useCase.execute(memo());
  // A restarted backend: new use case, same journal on disk.
  const restarted = new SubmitVoiceMemo({
    processVoiceEntry: { execute: async () => { throw new Error('must not run'); } },
    journalEntryRepository: { findById: async (id, chatId) => first.journal.get(`${chatId}|${id}`) || null },
  });
  assert.deepEqual(await restarted.execute(memo()), { kind: 'duplicate', memoId: '1700000000000' });
});

test('two uploads of one memo at the same moment run once', async () => {
  const { useCase, calls } = build();
  const [a, b] = await Promise.all([useCase.execute(memo()), useCase.execute(memo())]);
  assert.equal(a.kind, 'accepted');
  assert.equal(b.kind, 'accepted');
  assert.equal(calls.voice.length, 1);
});

test('the same id from another conversation is a different memo', async () => {
  const { useCase, calls } = build();
  await useCase.execute(memo());
  const other = await useCase.execute(memo({ conversationId: 'telegram:b1_c9', username: 'user_2' }));
  assert.equal(other.kind, 'accepted');
  assert.equal(calls.voice.length, 2);
});

test('a memo that failed before it was journaled runs again on the retry', async () => {
  const { useCase, calls } = build({ failBeforeSave: true });
  await assert.rejects(useCase.execute(memo()), /transcriber down/);
  await assert.rejects(useCase.execute(memo()), /transcriber down/);
  assert.equal(calls.voice.length, 2);
});

test('a memo that failed after it was journaled is a duplicate on the retry', async () => {
  const { useCase, calls, journal } = build({ failAfterSave: true });
  await assert.rejects(useCase.execute(memo()), /gateway down/);
  assert.deepEqual(await useCase.execute(memo()), { kind: 'duplicate', memoId: '1700000000000' });
  assert.equal(calls.voice.length, 1);
  assert.equal(journal.size, 1);
});

test('audio with nothing intelligible is reported, not journaled', async () => {
  const { useCase, journal } = build({ transcription: '   ' });
  assert.deepEqual(await useCase.execute(memo()), { kind: 'empty_transcription', memoId: '1700000000000' });
  assert.equal(journal.size, 0);
});

test('the collaborators are required', () => {
  assert.throws(() => new SubmitVoiceMemo({ journalEntryRepository: { findById() {} } }), /processVoiceEntry/);
  assert.throws(() => new SubmitVoiceMemo({ processVoiceEntry: { execute() {} } }), /journalEntryRepository/);
});
