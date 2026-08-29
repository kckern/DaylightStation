import { describe, expect, it, vi } from 'vitest';
import { OpponentDialogueService } from './OpponentDialogueService.mjs';

const adapter = (transcript, { sessionId, ply }) => transcript?.valid && ply === 2
  ? { event: { actor: 'opponent', capture: true }, eventId: `${sessionId}:2:test`, fallback: 'That one was mine.' }
  : null;

function make({ chat = null, enabled = true, config = {}, rivalry = null, ladder = null } = {}) {
  return new OpponentDialogueService({
    dialogueGenerator: chat ? { available: true, generate: ({ instruction, prompt }) => chat([
      { role: 'system', content: instruction },
      { role: 'user', content: prompt },
    ]) } : null,
    adapters: { test: adapter },
    readConfig: async () => ({ personality: { enabled, ...config } }),
    resolveOpponent: async () => ({ level: 1, position: 1, total: 7, rosterPack: 'test', opponent: { name: 'Pip' } }),
    recallRivalry: async () => rivalry,
    readLadder: async () => ladder,
  });
}

describe('OpponentDialogueService', () => {
  it('generates from redacted facts and returns normalized opponent identity', async () => {
    const chat = vi.fn(async () => 'A clever turn!');
    const result = await make({ chat }).react('test', { sessionId: 'g1', ply: 2, transcript: { valid: true, privateMove: 'raw-42' } });
    expect(result).toMatchObject({ eventId: 'g1:2:test', quip: 'A clever turn!', source: 'ai', opponent: { id: 'test:level-1', name: 'Pip' } });
    expect(chat.mock.calls[0][0][1].content).not.toContain('raw-42');
  });

  it('includes only compact rivalry and normalized ladder context', async () => {
    const chat = vi.fn(async () => 'We meet again!');
    await make({
      chat,
      rivalry: { record: { win: 2, loss: 1, draw: 0 }, recent: [{ result: 'win', moves: 8, notable: ['capture'], finalLine: 'Until next time.', raw: 'secret-engine-line' }] },
      ladder: { wins: 2, wins_required: 3 },
    }).react('test', { sessionId: 'g1', ply: 2, userId: 'kid', transcript: { valid: true } });
    const prompt = chat.mock.calls[0][0][1].content;
    expect(prompt).toContain('"position":1');
    expect(prompt).toContain('"notable":["capture"]');
    expect(prompt).not.toContain('secret-engine-line');
  });

  it('allowlists the model and clamps cosmetic generation options', async () => {
    const chat = vi.fn(async () => 'Still your turn!');
    await make({ chat, config: { model: 'expensive-model', timeout_ms: 99999, max_chars: 999 } })
      .react('test', { sessionId: 'g1', ply: 2, transcript: { valid: true } });
    expect(chat.mock.calls[0][1]).toMatchObject({ model: 'gpt-5.6-luna', timeout: 2500, maxTokens: 40 });
  });

  it('fails open when disabled or generation is unsafe', async () => {
    expect(await make({ enabled: false }).react('test', { sessionId: 'g', ply: 2, transcript: { valid: true } }))
      .toMatchObject({ quip: 'That one was mine.', source: 'disabled' });
    expect(await make({ chat: async () => 'Move to square 4.' }).react('test', { sessionId: 'g', ply: 2, transcript: { valid: true } }))
      .toMatchObject({ quip: 'That one was mine.', source: 'fallback', fallbackReason: 'invalid_output' });
    expect(await make({ chat: async () => { throw new Error('offline'); } }).react('test', { sessionId: 'g', ply: 2, transcript: { valid: true } }))
      .toMatchObject({ source: 'fallback', fallbackReason: 'generation_error' });
  });

  it('rejects a forged transcript', async () => {
    await expect(make().react('test', { sessionId: 'g', ply: 9, transcript: { valid: true } }))
      .rejects.toMatchObject({ code: 'invalid_game' });
  });
});
