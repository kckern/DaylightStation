import test from 'node:test';
import assert from 'node:assert/strict';
import { SubmitVoiceMemo } from './SubmitVoiceMemo.mjs';

const CHAT = 'telegram:b1_c2';
const NOW = Date.UTC(2026, 10, 18, 20, 0, 0);
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/**
 * A journal that stores what the fake voice path saves, the way ProcessTextEntry
 * saves the user's message under the messageId it is given.
 */
function build({ transcription = 'Bought the tickets today.', failAfterSave = false, failBeforeSave = false } = {}) {
  const calls = { voice: [] };
  const journal = new Map();
  const events = [];
  const useCase = new SubmitVoiceMemo({
    clock: () => NOW,
    logger: { info: (event, data) => events.push({ event, data }) },
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
  return { useCase, calls, journal, events };
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

test('a memo recorded earlier is journaled at the time it was recorded', async () => {
  const { useCase, calls, events } = build();
  const recordedAt = NOW - 2 * DAY;
  await useCase.execute(memo({ recordedAt }));
  assert.ok(calls.voice[0].timestamp instanceof Date);
  assert.equal(calls.voice[0].timestamp.getTime(), recordedAt);
  assert.equal(events.length, 0);
});

test('a phone clock a few minutes ahead is believed', async () => {
  const { useCase, calls } = build();
  await useCase.execute(memo({ recordedAt: NOW + 4 * MINUTE }));
  assert.equal(calls.voice[0].timestamp.getTime(), NOW + 4 * MINUTE);
});

test('a memo with no recorded time is journaled now, with nothing passed on', async () => {
  const { useCase, calls, events } = build();
  await useCase.execute(memo());
  assert.equal('timestamp' in calls.voice[0], false);
  assert.equal(events.length, 0);
});

test('a recorded time that cannot be right is ignored and said so', async () => {
  const cases = [
    [NOW + 6 * MINUTE, 'in_the_future'],
    [NOW - 31 * DAY, 'too_old'],
    [Number.NaN, 'not_a_time'],
    ['yesterday', 'not_a_time'],
    [-5, 'not_a_time'],
  ];
  for (const [recordedAt, reason] of cases) {
    const { useCase, calls, events } = build();
    await useCase.execute(memo({ recordedAt }));
    assert.equal('timestamp' in calls.voice[0], false, String(recordedAt));
    assert.deepEqual(events, [{ event: 'journalist.memo.recordedAtIgnored', data: { memoId: '1700000000000', username: 'user_1', reason } }]);
  }
});
