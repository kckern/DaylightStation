/**
 * Nutribot resilience (2026-09-24): a Whisper 502 lost a spoken revision, and
 * a mis-tapped Undo removed a meal with no way back from the chat.
 *  - voice while a revision is open goes INTO the revision (it used to log a new meal)
 *  - a failed transcription offers 🔄 Retry; the retry re-runs the same file
 *    and still lands in the open revision (retry state never touches the root flow)
 *  - ↩️ Restore brings an undone log back
 */
import { describe, it, expect, vi } from 'vitest';
import { NutribotInputRouter } from './NutribotInputRouter.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

function stateStore(root = null) {
  const sessions = {};
  return {
    root, sessions,
    get: vi.fn(async (id, messageId) => (messageId ? sessions[messageId] ?? null : root)),
    set: vi.fn(async (id, value, messageId) => { if (messageId) sessions[messageId] = value; else root = value; }),
    clear: vi.fn(async () => { root = null; }),
  };
}

function harness({ state, voiceResults }) {
  const store = stateStore(state);
  const logFoodFromVoice = { execute: vi.fn(async (input) => {
    const next = voiceResults.shift();
    if (next.transcript && input.routeTranscript) return input.routeTranscript(next.transcript);
    return next;
  }) };
  const revision = { execute: vi.fn(async () => ({ success: true, revised: true })) };
  const logFoodFromText = { execute: vi.fn(async () => ({ success: true })) };
  const restore = { execute: vi.fn(async () => ({ restored: 9, dates: ['2026-09-24'] })) };
  const container = {
    getConversationStateStore: () => store,
    getLogFoodFromVoice: () => logFoodFromVoice,
    getProcessRevisionInput: () => revision,
    getLogFoodFromText: () => logFoodFromText,
    getRestoreFoodLog: () => restore,
    getFoodLogStore: () => ({ findByUuid: async () => ({ meal: { date: '2026-09-24' } }) }),
    getMealCoachingTrigger: () => null,
  };
  const router = new NutribotInputRouter(container, { logger: silent });
  const rc = { sendMessage: vi.fn(async () => ({ messageId: 'm' })), updateMessage: vi.fn(async () => {}), deleteMessage: vi.fn(async () => {}) };
  return { router, rc, store, logFoodFromVoice, revision, logFoodFromText, restore };
}

const REVISING = { activeFlow: 'revision', flowState: { pendingLogUuid: 'ydezh98OKs' } };
const voice = { type: 'voice', platform: 'telegram', conversationId: 'telegram:b1_c2', userId: 'kckern', messageId: '11720', payload: { fileId: 'AwACAgEAAxkBAAIt' } };

describe('Nutribot resilience', () => {
  it('a voice note during a revision revises that log instead of logging a new meal', async () => {
    const h = harness({ state: REVISING, voiceResults: [{ transcript: 'the rice bowl was only half' }] });
    await h.router.handleVoice(voice, h.rc);
    expect(h.revision.execute).toHaveBeenCalledWith(expect.objectContaining({ logUuid: 'ydezh98OKs', text: 'the rice bowl was only half' }));
    expect(h.logFoodFromText.execute).not.toHaveBeenCalled();
  });

  it('a failed transcription offers Retry; the retry re-runs the same file into the still-open revision', async () => {
    const h = harness({ state: REVISING, voiceResults: [
      { success: false, code: 'TRANSCRIBE_FAILED', retryMessageId: '11721' },
      { transcript: 'the rice bowl was only half' },
    ] });
    await h.router.handleVoice(voice, h.rc);
    expect(h.logFoodFromVoice.execute.mock.calls[0][0].offerRetry).toBe(true);
    // Retry kept beside the revision, not in place of it.
    expect(h.store.sessions['11721'].voiceRetry.fileId).toBe('AwACAgEAAxkBAAIt');
    expect(await h.store.get('c')).toEqual(REVISING);

    await h.router.handleCallback({ ...voice, type: 'callback', messageId: '11721', payload: { callbackData: JSON.stringify({ cmd: 'vr' }) } }, h.rc);
    expect(h.logFoodFromVoice.execute.mock.calls[1][0].voiceData.fileId).toBe('AwACAgEAAxkBAAIt');
    expect(h.revision.execute).toHaveBeenCalledOnce();
    // One retry per button.
    await h.router.handleCallback({ ...voice, type: 'callback', messageId: '11721', payload: { callbackData: JSON.stringify({ cmd: 'vr' }) } }, h.rc);
    expect(h.logFoodFromVoice.execute).toHaveBeenCalledTimes(2);
    expect(h.rc.sendMessage.mock.calls.at(-1)[0]).toMatch(/no longer available/);
  });

  it('↩️ Restore brings an undone log back', async () => {
    const h = harness({ state: null, voiceResults: [] });
    const out = await h.router.handleCallback({ ...voice, type: 'callback', messageId: '11709', payload: { callbackData: JSON.stringify({ cmd: 'rs', id: 'gaEcGWCYfN' }) } }, h.rc);
    expect(h.restore.execute).toHaveBeenCalledWith(expect.objectContaining({ logUuid: 'gaEcGWCYfN', userId: 'kckern' }));
    expect(out.restored).toBe(9);
  });
});
