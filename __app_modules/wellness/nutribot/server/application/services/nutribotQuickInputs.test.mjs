import { describe, it, expect } from 'vitest';
import { createNutribotQuickInputs } from './nutribotQuickInputs.mjs';

const NOW = Date.UTC(2026, 10, 18, 20, 0, 0);          // 12:00 in Los Angeles
const HOUR = 60 * 60 * 1000;

function memoryStore() {
  const files = new Map();
  return {
    read: (username) => (files.has(username) ? structuredClone(files.get(username)) : null),
    write: (username, data) => { files.set(username, structuredClone(data)); return true; },
  };
}

/** A stand-in for NutribotInputRouter that records the events it is handed. */
function build({ answer = { ok: true, result: { success: true, nutrilogUuid: 'log-1' }, logId: 'log-1' }, available = true, limits } = {}) {
  const events = [];
  const handle = (type) => async (event, responseContext) => {
    events.push({ type, event, responseContext });
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer(event) : answer;
  };
  const quick = createNutribotQuickInputs({
    available,
    inputRouter: { handleText: handle('text'), handleVoice: handle('voice'), handleImage: handle('image') },
    ledgerStore: memoryStore(),
    limits,
    timezone: () => 'America/Los_Angeles',
    deviceConfig: (key) => ({ phone: { quick_input: { nutribot: ['user_1'] } } })[key],
    resolveConversationId: (username) => {
      if (username !== 'user_1') throw new Error('no such user');
      return 'telegram:b9_c2';
    },
    clock: () => NOW,
    logger: {},
  });
  return { quick, events };
}

const command = (over = {}) => ({
  conversationId: 'telegram:b9_c2', username: 'user_1', inputId: 'i1',
  body: Buffer.from('two eggs and toast'), mimeType: 'text/plain', ...over,
});

describe('Nutribot quick inputs', () => {
  it('a typed meal reaches the input router as a text event from this user, with no response context', async () => {
    const { quick, events } = build();
    const result = await quick.endpoints.text.submit(command({ body: Buffer.from('  two eggs and toast \n') }));
    expect(result).toEqual({ kind: 'accepted', inputId: 'i1' });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('text');
    expect(events[0].responseContext).toBeNull();
    expect(events[0].event).toEqual({
      platform: 'quick-input', type: 'text', userId: 'user_1', conversationId: 'telegram:b9_c2', messageId: null,
      payload: { text: 'two eggs and toast' },
    });
  });

  it('a recording reaches it as bytes in place of a Telegram file id', async () => {
    const { quick, events } = build();
    const body = Buffer.from('opus');
    await quick.endpoints.voice.submit(command({ body, mimeType: 'audio/ogg' }));
    expect(events[0].type).toBe('voice');
    expect(events[0].event.payload.fileId).toEqual({ buffer: body, mimeType: 'audio/ogg' });
  });

  it('a photo reaches it as bytes, with no file id and no URL', async () => {
    const { quick, events } = build();
    const body = Buffer.from('jpeg');
    await quick.endpoints.photo.submit(command({ body, mimeType: 'image/jpeg' }));
    expect(events[0].type).toBe('image');
    expect(events[0].event.payload).toEqual({ fileId: null, imageBuffer: body });
  });

  it('an input captured earlier is filed on the day and at the meal it was captured', async () => {
    const { quick, events } = build();
    // Yesterday at 12:30 local, uploaded now.
    await quick.endpoints.photo.submit(command({ mimeType: 'image/jpeg', recordedAt: NOW - 24 * HOUR + 30 * 60 * 1000 }));
    expect(events[0].event.payload.date).toBe('2026-11-17');
    expect(events[0].event.payload.bucket).toBe('afternoon');
    // 19:00 local the day before that: an evening meal.
    await quick.endpoints.text.submit(command({ inputId: 'i2', recordedAt: NOW - 41 * HOUR }));
    expect(events[1].event.payload).toMatchObject({ date: '2026-11-16', bucket: 'evening' });
  });

  it('an input with no believable time carries no date, so the bot files it as it would a Telegram message', async () => {
    const { quick, events } = build();
    await quick.endpoints.text.submit(command());
    await quick.endpoints.text.submit(command({ inputId: 'i2', recordedAt: NOW + 2 * HOUR }));
    for (const { event } of events) {
      expect('date' in event.payload).toBe(false);
      expect('bucket' in event.payload).toBe(false);
    }
  });

  it('processes an input once', async () => {
    const { quick, events } = build();
    await quick.endpoints.text.submit(command());
    expect(await quick.endpoints.text.submit(command())).toEqual({ kind: 'duplicate', inputId: 'i1' });
    expect(events).toHaveLength(1);
  });

  it('reads what the bot made of the input', async () => {
    const cases = [
      [{ ok: true, result: { success: false, code: 'NO_FOOD', error: 'No food detected' }, logId: null }, 'unusable_input'],
      [{ ok: true, result: { success: false, code: 'EMPTY_TRANSCRIPTION', error: 'Empty transcription' }, logId: null }, 'empty_transcription'],
      [{ ok: true, result: { success: false, code: 'VOICE_UNAVAILABLE' }, logId: null }, 'unavailable'],
      [{ ok: false, code: 'AI_UNAVAILABLE', error: 'Food analysis is temporarily unavailable.' }, 'unavailable'],
      // An open revision in the chat took the words, as it would a Telegram message.
      [{ ok: true, result: { success: true } }, 'accepted'],
    ];
    for (const [answer, kind] of cases) {
      const { quick } = build({ answer });
      expect((await quick.endpoints.voice.submit(command({ mimeType: 'audio/ogg' }))).kind).toBe(kind);
    }
  });

  it('nothing usable is not asked of the bot twice', async () => {
    const { quick, events } = build({ answer: { ok: true, result: { success: false, code: 'NO_FOOD' }, logId: null } });
    await quick.endpoints.photo.submit(command({ mimeType: 'image/jpeg' }));
    expect((await quick.endpoints.photo.submit(command({ mimeType: 'image/jpeg' }))).kind).toBe('unusable_input');
    expect(events).toHaveLength(1);
  });

  it('a failed transcription, a refusal with no known cause and a thrown error can all be retried', async () => {
    const failures = [
      { ok: true, result: { success: false, code: 'TRANSCRIBE_FAILED', error: 'socket hang up' }, logId: null },
      { ok: true, result: { success: false, error: 'Revision session expired' }, logId: null },
      new Error('store is down'),
    ];
    for (const answer of failures) {
      const { quick, events } = build({ answer });
      await expect(quick.endpoints.voice.submit(command({ mimeType: 'audio/ogg' }))).rejects.toThrow();
      await expect(quick.endpoints.voice.submit(command({ mimeType: 'audio/ogg' }))).rejects.toThrow();
      expect(events).toHaveLength(2);
    }
  });

  it('the error for a refusal names the code, never the bot\'s words', async () => {
    const { quick } = build({ answer: { ok: true, result: { success: false, code: 'TRANSCRIBE_FAILED', error: 'the transcript so far: two eggs' }, logId: null } });
    await expect(quick.endpoints.voice.submit(command({ mimeType: 'audio/ogg' }))).rejects.toThrow(/^Nutribot did not take the input: TRANSCRIBE_FAILED$/);
  });

  it('binds devices and users for Nutribot only, and has its own daily allowance', async () => {
    const { quick } = build({ limits: { inputs: 1 } });
    for (const kind of ['voice', 'text', 'photo']) {
      expect(quick.endpoints[kind].available()).toBe(true);
      expect(quick.endpoints[kind].deviceAllowed('fleet:phone', 'user_1')).toBe(true);
      expect(quick.endpoints[kind].deviceAllowed('fleet:phone', 'user_2')).toBe(false);
      expect(quick.endpoints[kind].conversationFor('user_1')).toBe('telegram:b9_c2');
      expect(quick.endpoints[kind].conversationFor('user_2')).toBeNull();
    }
    await quick.endpoints.text.submit(command());
    expect((await quick.endpoints.photo.submit(command({ inputId: 'i2', mimeType: 'image/jpeg' }))).kind).toBe('daily_limit');
  });

  it('is unavailable without the AI gateway, the input router or a ledger', () => {
    expect(build({ available: false }).quick.endpoints.text.available()).toBe(false);
    const noRouter = createNutribotQuickInputs({ inputRouter: null, ledgerStore: memoryStore(), resolveConversationId: () => 'x' });
    expect(noRouter.endpoints.photo.available()).toBe(false);
  });
});
