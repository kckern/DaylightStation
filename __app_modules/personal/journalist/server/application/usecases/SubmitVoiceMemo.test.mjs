import test from 'node:test';
import assert from 'node:assert/strict';
import { SubmitVoiceMemo } from './SubmitVoiceMemo.mjs';
import { MemoLedger } from '../services/MemoLedger.mjs';

const CHAT = 'telegram:b1_c2';
const NOW = Date.UTC(2026, 10, 18, 20, 0, 0);
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const TRANSCRIPT = 'Bought the tickets today.';

/** A ledger store that keeps its data in this process, shared across "restarts". */
function memoryStore(files = new Map()) {
  return {
    files,
    read: (username) => (files.has(username) ? structuredClone(files.get(username)) : null),
    write: (username, data) => { files.set(username, structuredClone(data)); return true; },
  };
}

/**
 * The voice and text use cases as step-recording fakes over one journal map.
 * `fail` names steps that throw, each a number of times.
 */
function build({ transcription = TRANSCRIPT, fail = {}, journal = new Map(), store = memoryStore(), limits } = {}) {
  const steps = [];
  const events = [];
  const failures = { ...fail };
  const step = (name, input) => {
    steps.push({ name, input });
    if (failures[name] > 0) { failures[name] -= 1; throw new Error(`${name} failed`); }
  };
  const useCase = new SubmitVoiceMemo({
    clock: () => NOW,
    logger: { info: (event, data) => events.push({ event, data }) },
    memoLedger: new MemoLedger({ store, clock: () => NOW, limits }),
    journalEntryRepository: {
      findById: async (id, chatId) => journal.get(`${chatId}|${id}`) || null,
    },
    processVoiceEntry: {
      transcribe: async (input) => { step('transcribe', input); return transcription; },
      sendTranscription: async (input) => { step('echo', input); },
      sendNotUnderstood: async (input) => { step('apology', input); },
    },
    processTextEntry: {
      saveUserMessage: async (input) => {
        step('save', input);
        journal.set(`${input.chatId}|${input.messageId}`, { id: input.messageId, content: input.text });
      },
      execute: async (input) => { step('followUp', input); return { success: true }; },
    },
  });
  const names = () => steps.map((s) => s.name);
  const count = (name) => steps.filter((s) => s.name === name).length;
  const first = (name) => steps.find((s) => s.name === name)?.input;
  return { useCase, steps, names, count, first, events, journal, store };
}

const memo = (over = {}) => ({
  conversationId: CHAT, username: 'user_1', memoId: '1700000000000',
  audioBuffer: Buffer.from('aac'), mimeType: 'audio/mp4', ...over,
});

test('a memo is transcribed, saved, echoed and then answered, in that order', async () => {
  const { useCase, names, first } = build();
  const result = await useCase.execute(memo());
  assert.deepEqual(result, { kind: 'accepted', memoId: '1700000000000', transcriptionLength: 25 });
  assert.deepEqual(names(), ['transcribe', 'save', 'echo', 'followUp']);

  const heard = first('transcribe');
  assert.equal(heard.chatId, CHAT);
  assert.ok(Buffer.isBuffer(heard.voiceFileId.buffer));
  assert.equal(heard.voiceFileId.mimeType, 'audio/mp4');

  const saved = first('save');
  assert.equal(saved.messageId, 'memo:1700000000000');
  assert.equal(saved.text, TRANSCRIPT);
  assert.equal(saved.senderId, 'user_1');
  assert.equal(saved.senderName, 'user_1');

  assert.equal(first('echo').transcription, TRANSCRIPT);
  const followUp = first('followUp');
  assert.equal(followUp.messageId, 'memo:1700000000000');
  assert.equal(followUp.userMessageSaved, true);
  assert.equal(followUp.responseContext, undefined);
});

test('the same memo id is journaled once', async () => {
  const { useCase, count, journal } = build();
  await useCase.execute(memo());
  assert.deepEqual(await useCase.execute(memo()), { kind: 'duplicate', memoId: '1700000000000' });
  assert.equal(count('transcribe'), 1);
  assert.equal(count('echo'), 1);
  assert.equal(count('followUp'), 1);
  assert.equal(journal.size, 1);
});

test('a finished memo is a duplicate for a fresh process', async () => {
  const first = build();
  await first.useCase.execute(memo());
  const restarted = build({ journal: first.journal, store: first.store });
  assert.deepEqual(await restarted.useCase.execute(memo()), { kind: 'duplicate', memoId: '1700000000000' });
  assert.deepEqual(restarted.names(), []);
});

test('a journaled memo with no record left is a duplicate, and nothing is sent', async () => {
  const first = build();
  await first.useCase.execute(memo());
  const later = build({ journal: first.journal });
  assert.deepEqual(await later.useCase.execute(memo()), { kind: 'duplicate', memoId: '1700000000000' });
  assert.deepEqual(later.names(), []);
});

test('two uploads of one memo at the same moment run once', async () => {
  const { useCase, count } = build();
  const [a, b] = await Promise.all([useCase.execute(memo()), useCase.execute(memo())]);
  assert.equal(a.kind, 'accepted');
  assert.equal(b.kind, 'accepted');
  assert.equal(count('transcribe'), 1);
});

test('the same id from another user is a different memo', async () => {
  const { useCase, count } = build();
  await useCase.execute(memo());
  const other = await useCase.execute(memo({ conversationId: 'telegram:b1_c9', username: 'user_2' }));
  assert.equal(other.kind, 'accepted');
  assert.equal(count('transcribe'), 2);
});

test('a memo whose transcription failed is transcribed again on the retry', async () => {
  const { useCase, count } = build({ fail: { transcribe: 1 } });
  await assert.rejects(useCase.execute(memo()), /transcribe failed/);
  assert.equal((await useCase.execute(memo())).kind, 'accepted');
  assert.equal(count('transcribe'), 2);
  assert.equal(count('save'), 1);
});

test('an echo that keeps failing never costs a second transcription', async () => {
  const { useCase, count, journal } = build({ fail: { echo: 3 } });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(useCase.execute(memo()), /echo failed/);
  }
  const done = await useCase.execute(memo());
  assert.deepEqual(done, { kind: 'resumed', memoId: '1700000000000' });
  assert.equal(count('transcribe'), 1);
  assert.equal(count('save'), 1);
  assert.equal(count('echo'), 4);
  assert.equal(count('followUp'), 1);
  assert.equal(journal.size, 1);
});

test('a retry after the follow-up failed sends the follow-up once and the echo not again', async () => {
  const { useCase, count, steps } = build({ fail: { followUp: 1 } });
  await assert.rejects(useCase.execute(memo()), /followUp failed/);
  assert.deepEqual(await useCase.execute(memo()), { kind: 'resumed', memoId: '1700000000000' });
  assert.equal(count('transcribe'), 1);
  assert.equal(count('echo'), 1);
  assert.equal(count('followUp'), 2);
  // The retry answers from the saved entry's words.
  assert.equal(steps.at(-1).input.text, TRANSCRIPT);
  assert.deepEqual(await useCase.execute(memo()), { kind: 'duplicate', memoId: '1700000000000' });
  assert.equal(count('followUp'), 2);
});

test('a retry in a fresh process finishes the replies from the saved entry', async () => {
  const first = build({ fail: { echo: 1 } });
  await assert.rejects(first.useCase.execute(memo()), /echo failed/);
  const restarted = build({ journal: first.journal, store: first.store });
  assert.deepEqual(await restarted.useCase.execute(memo()), { kind: 'resumed', memoId: '1700000000000' });
  assert.deepEqual(restarted.names(), ['echo', 'followUp']);
});

test('audio with nothing intelligible is reported, not journaled, and not transcribed twice', async () => {
  const { useCase, count, journal, names } = build({ transcription: '   ' });
  assert.deepEqual(await useCase.execute(memo()), { kind: 'empty_transcription', memoId: '1700000000000' });
  assert.deepEqual(names(), ['transcribe', 'apology']);
  assert.equal(journal.size, 0);
  assert.deepEqual(await useCase.execute(memo()), { kind: 'empty_transcription', memoId: '1700000000000' });
  assert.equal(count('transcribe'), 1);
  assert.equal(count('apology'), 1);
});

test('an apology that cannot be sent does not fail the memo', async () => {
  const { useCase } = build({ transcription: '', fail: { apology: 1 } });
  assert.equal((await useCase.execute(memo())).kind, 'empty_transcription');
});

test('the collaborators are required', () => {
  const all = {
    processVoiceEntry: {}, processTextEntry: {}, memoLedger: {},
    journalEntryRepository: { findById() {} },
  };
  for (const name of Object.keys(all)) {
    assert.throws(() => new SubmitVoiceMemo({ ...all, [name]: undefined }), new RegExp(name));
  }
});

test('a memo recorded earlier is saved at the time it was recorded', async () => {
  const { useCase, first, events } = build();
  const recordedAt = NOW - 2 * DAY;
  await useCase.execute(memo({ recordedAt }));
  assert.ok(first('save').timestamp instanceof Date);
  assert.equal(first('save').timestamp.getTime(), recordedAt);
  assert.equal(events.length, 0);
});

test('a phone clock a few minutes ahead is believed', async () => {
  const { useCase, first } = build();
  await useCase.execute(memo({ recordedAt: NOW + 4 * MINUTE }));
  assert.equal(first('save').timestamp.getTime(), NOW + 4 * MINUTE);
});

test('a memo with no recorded time is saved now, with no time passed on', async () => {
  const { useCase, first, events } = build();
  await useCase.execute(memo());
  assert.equal('timestamp' in first('save'), false);
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
    const { useCase, first, events } = build();
    await useCase.execute(memo({ recordedAt }));
    assert.equal('timestamp' in first('save'), false, String(recordedAt));
    assert.deepEqual(events, [{ event: 'journalist.memo.recordedAtIgnored', data: { memoId: '1700000000000', username: 'user_1', reason } }]);
  }
});

test('past the daily memo count a new memo is refused before it is transcribed', async () => {
  const { useCase, count } = build({ limits: { memos: 1 } });
  await useCase.execute(memo());
  const refused = await useCase.execute(memo({ memoId: 'second' }));
  assert.equal(refused.kind, 'daily_limit');
  assert.equal(refused.limit, 'memos');
  assert.ok(refused.retryAfterSeconds > 0);
  assert.equal(count('transcribe'), 1);
});

test('the real size of the audio is held to the daily byte limit', async () => {
  const { useCase, count } = build({ limits: { bytes: 5 } });
  const refused = await useCase.execute(memo({ audioBuffer: Buffer.alloc(6) }));
  assert.equal(refused.kind, 'daily_limit');
  assert.equal(refused.limit, 'bytes');
  assert.equal(count('transcribe'), 0);
});

test('a retry that only has replies left to send is not held to the limit', async () => {
  const { useCase } = build({ limits: { memos: 1 }, fail: { echo: 1 } });
  await assert.rejects(useCase.execute(memo()), /echo failed/);
  assert.equal((await useCase.execute(memo())).kind, 'resumed');
});

test('the gate can ask ahead of the body whether a memo would be admitted', async () => {
  const { useCase } = build({ limits: { memos: 1, bytes: 100 } });
  assert.deepEqual(useCase.admission({ username: 'user_1', memoId: 'm1', bytes: 50 }), { allowed: true });
  assert.equal(useCase.admission({ username: 'user_1', memoId: 'm1', bytes: 101 }).limit, 'bytes');
  await useCase.execute(memo());
  assert.equal(useCase.admission({ username: 'user_1', memoId: 'other', bytes: 1 }).limit, 'memos');
});
