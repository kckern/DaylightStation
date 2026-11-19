/**
 * What the voice path writes to the log. The real ProcessVoiceEntry and
 * ProcessTextEntry run with a logger that keeps every event at every level,
 * and no event may carry the audio or the words spoken in it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProcessVoiceEntry } from './ProcessVoiceEntry.mjs';
import { ProcessTextEntry } from './ProcessTextEntry.mjs';

const AUDIO = Buffer.from('RIFF-not-really-audio-0123456789-abcdefghijklmnopqrstuvwxyz-'.repeat(40));
const TRANSCRIPT = 'Bought the tickets today, two aisle seats for the late train to the coast.';
// The longest run of the audio or the transcript an event may repeat.
const MAX_SHARED = 12;

function capturingLogger() {
  const events = [];
  const at = (level) => (event, data) => events.push({ level, event, data });
  return { events, debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}

/** Every string and every binary value anywhere inside a payload. */
function leaves(value, out = { strings: [], binaries: 0 }) {
  if (typeof value === 'string') out.strings.push(value);
  else if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) out.binaries += 1;
  else if (Array.isArray(value)) value.forEach((item) => leaves(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => leaves(item, out));
  return out;
}

function windows(text, size) {
  const found = new Set();
  for (let i = 0; i + size <= text.length; i += 1) found.add(text.slice(i, i + size));
  return found;
}

export function assertNothingSpokenIsLogged(events, { audio = AUDIO, transcript = TRANSCRIPT } = {}) {
  assert.ok(events.length > 0, 'the run logged nothing, so the check proves nothing');
  const forbidden = [
    ...windows(transcript, MAX_SHARED + 1),
    ...windows(audio.toString('latin1'), MAX_SHARED + 1),
    ...windows(audio.toString('base64'), MAX_SHARED + 1),
  ];
  for (const { event, data } of events) {
    const { strings, binaries } = leaves(data);
    assert.equal(binaries, 0, `${event} carries binary data`);
    for (const text of strings) {
      for (const piece of forbidden) {
        assert.ok(!text.includes(piece), `${event} repeats ${MAX_SHARED + 1} characters of the audio or the transcript`);
      }
    }
  }
}

function build({ aiReply = '{"acknowledgment":"Nice.","question":"Where to?"}', failSend = false, failTranscribe = false } = {}) {
  const logger = capturingLogger();
  const messagingGateway = {
    transcribeVoice: async () => {
      if (failTranscribe) throw new Error('transcriber is down');
      return TRANSCRIPT;
    },
    sendMessage: async () => {
      if (failSend) throw new Error('telegram is down');
      return { messageId: 'sent-1' };
    },
  };
  const processTextEntry = new ProcessTextEntry({
    messagingGateway,
    // The model is free to quote the entry back, so its reply counts as spoken words too.
    aiGateway: { chat: async (prompt, options) => (options?.maxTokens === 150 ? aiReply : '["Yes","No"]') },
    journalEntryRepository: { saveMessage: async () => {}, getMessageHistory: async () => [] },
    logger,
  });
  const processVoiceEntry = new ProcessVoiceEntry({ messagingGateway, processTextEntry, logger });
  return { logger, processVoiceEntry };
}

const memoInput = () => ({
  chatId: 'telegram:b1_c2', voiceFileId: { buffer: AUDIO, mimeType: 'audio/mp4' },
  messageId: 'memo:1700000000000', senderId: 'user_1', senderName: 'user_1',
});

test('a memo buffer is described in the log, never carried', async () => {
  const { logger, processVoiceEntry } = build();
  await processVoiceEntry.execute(memoInput());
  assertNothingSpokenIsLogged(logger.events);
  const start = logger.events.find((e) => e.event === 'voiceEntry.process.start');
  assert.deepEqual(start.data.voice, { bytes: AUDIO.length, mimeType: 'audio/mp4' });
  assert.equal('voiceFileId' in start.data, false);
});

test('a Telegram file id is still logged as the id', async () => {
  const { logger, processVoiceEntry } = build();
  await processVoiceEntry.execute({ ...memoInput(), voiceFileId: 'AwACAgEAAxkBAAIB' });
  const start = logger.events.find((e) => e.event === 'voiceEntry.process.start');
  assert.equal(start.data.voice, 'AwACAgEAAxkBAAIB');
});

test('a model reply that quotes the entry is not logged when it cannot be parsed', async () => {
  const { logger, processVoiceEntry } = build({ aiReply: `I heard: ${TRANSCRIPT}` });
  await processVoiceEntry.execute(memoInput());
  assertNothingSpokenIsLogged(logger.events);
  const noJson = logger.events.find((e) => e.event === 'textEntry.conversational.noJsonFound');
  assert.equal(noJson.data.responseLength, `I heard: ${TRANSCRIPT}`.length);
});

test('the failure events carry no audio and no words either', async () => {
  for (const failure of [{ failSend: true }, { failTranscribe: true }]) {
    const { logger, processVoiceEntry } = build(failure);
    await assert.rejects(processVoiceEntry.execute(memoInput()));
    assertNothingSpokenIsLogged(logger.events);
    assert.ok(logger.events.some((e) => e.level === 'error'));
  }
});
