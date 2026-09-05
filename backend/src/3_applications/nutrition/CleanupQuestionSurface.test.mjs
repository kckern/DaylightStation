// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { CleanupQuestionSurface } from './CleanupQuestionSurface.mjs';
import { AgentInteractions } from '#apps/agents/framework/AgentInteractions.mjs';
import { TelegramWebhookParser } from '#adapters/telegram/TelegramWebhookParser.mjs';
import { toInputEvent } from '#adapters/telegram/IInputEvent.mjs';
import { NutribotInputRouter } from '#apps/nutribot/services/NutribotInputRouter.mjs';

function fixture() {
  let state = { version: 0, settings: { telegram: true }, questions: {} };
  const store = { load: () => structuredClone(state), update: (_user, fn) => { const copy = structuredClone(state); const result = fn(copy); state = copy; state.version++; return structuredClone(result); } };
  const onAnswer = vi.fn(async () => ({ status: 'resolved' }));
  const interactions = new AgentInteractions({ store, onAnswer, clock: { now: () => Date.parse('2026-09-04T19:00:00Z') } });
  const q = interactions.ask('alice', { issueKey: 'fish', question: 'Was it cod?', entryVersions: [], entryNames: { fish: 'White Fish' }, choices: [{ id: '0', label: 'Cod', repair: { updates: [{ id: 'fish', changes: { name: 'Cod' } }], createGroups: [] } }] });
  const gateway = { sendMessage: vi.fn(async () => ({ messageId: '100' })), updateMessage: vi.fn(async () => ({})) };
  const cleanup = { store, interactions };
  const surface = new CleanupQuestionSurface({ cleanup, gateway, destinationFor: () => 'telegram:b1_c42', logger: { warn: vi.fn() } });
  return { store, interactions, q, gateway, surface, onAnswer, cleanup };
}
describe('optional shared cleanup questions', () => {
  it('sends once, includes exact changes, then edits the same message after a Health answer', async () => {
    const f = fixture(); await f.surface.sync('alice'); await f.surface.sync('alice');
    expect(f.gateway.sendMessage).toHaveBeenCalledTimes(1);
    expect(f.gateway.sendMessage.mock.calls[0][1]).toContain('White Fish: name → Cod');
    await f.interactions.answer({ userId: 'alice', id: f.q.id, expectedVersion: 1, operationId: 'app', choiceId: '0' });
    await f.surface.sync('alice');
    expect(f.gateway.updateMessage).toHaveBeenCalledWith('telegram:b1_c42', '100', expect.objectContaining({ choices: [], text: expect.stringContaining('resolved') }));
  });
  it('keeps Health usable with no Telegram, and never repeats an ambiguous send', async () => {
    const f = fixture(); f.gateway.available = false; await f.surface.sync('alice');
    expect(f.gateway.sendMessage).not.toHaveBeenCalled();
    f.gateway.available = true; f.gateway.sendMessage.mockRejectedValue(new Error('connection dropped after send'));
    await f.surface.sync('alice'); await f.surface.sync('alice');
    expect(f.gateway.sendMessage).toHaveBeenCalledTimes(1);
    expect(f.interactions.list('alice')[0].status).toBe('open');
    await f.interactions.answer({ userId: 'alice', id: f.q.id, expectedVersion: 1, operationId: 'app', text: 'Cod' });
    expect(f.onAnswer).toHaveBeenCalledOnce();
  });
  it('correlates numeric replies before barcode dispatch, and rejects replies from another chat', async () => {
    const f = fixture(); await f.surface.sync('alice');
    const parser = new TelegramWebhookParser({ botId: '1', logger: {} });
    const event = toInputEvent(parser.parse({ message: { message_id: 200, from: { id: 42 }, chat: { id: 42, type: 'private' }, text: '12345678', reply_to_message: { message_id: 100 } } }));
    expect(event.type).toBe('upc');
    const router = new NutribotInputRouter({}, { cleanupProvider: () => ({ handleTelegram: (...args) => f.surface.handle(...args) }), userResolver: { resolveUser: () => 'alice' }, logger: {} });
    const upc = vi.spyOn(router, 'handleUpc');
    await router.route(event, { sendMessage: vi.fn() });
    expect(upc).not.toHaveBeenCalled();
    expect(f.onAnswer).toHaveBeenCalledOnce();
    expect(f.onAnswer.mock.calls[0][1].answer.text).toBe('12345678');
    const second = fixture(); await second.surface.sync('alice');
    await second.surface.handle('alice', { ...event, metadata: { ...event.metadata, chatId: '999' } }, { sendMessage: vi.fn() });
    expect(second.onAnswer).not.toHaveBeenCalled();
  });
  it('retains reply correlation for media and handles old callbacks without new food input', async () => {
    const f = fixture(); await f.surface.sync('alice');
    const parser = new TelegramWebhookParser({ botId: '1', logger: {} });
    const event = toInputEvent(parser.parse({ message: { message_id: 201, from: { id: 42 }, chat: { id: 42, type: 'private' }, voice: { file_id: 'voice' }, reply_to_message: { message_id: 100 } } }));
    const response = { sendMessage: vi.fn() };
    expect(await f.surface.handle('alice', event, response)).toBe(true);
    expect(response.sendMessage).toHaveBeenCalledWith(expect.stringContaining('type your answer'));
    expect(f.onAnswer).not.toHaveBeenCalled();
  });
});
