import { describe, expect, it, vi } from 'vitest';
import { OpponentDialogueService } from './OpponentDialogueService.mjs';

const adapter = (transcript, { sessionId, ply }) => transcript?.valid && ply === 2
  ? { event: { actor: 'opponent', capture: true }, eventId: `${sessionId}:2:test`, fallback: 'That one was mine.' }
  : null;

function make({ chat = null, enabled = true } = {}) {
  return new OpponentDialogueService({
    aiGateway: chat ? { chat } : null,
    adapters: { test: adapter },
    readConfig: async () => ({ personality: { enabled } }),
    resolveOpponent: async () => ({ level: 1, position: 1, rosterPack: 'test', opponent: { name: 'Pip' } }),
  });
}

describe('OpponentDialogueService', () => {
  it('generates from redacted facts and returns normalized opponent identity', async () => {
    const chat = vi.fn(async () => 'A clever turn!');
    const result = await make({ chat }).react('test', { sessionId: 'g1', ply: 2, transcript: { valid: true, privateMove: 'raw-42' } });
    expect(result).toMatchObject({ eventId: 'g1:2:test', quip: 'A clever turn!', source: 'ai', opponent: { id: 'test:level-1', name: 'Pip' } });
    expect(chat.mock.calls[0][0][1].content).not.toContain('raw-42');
  });

  it('fails open when disabled or generation is unsafe', async () => {
    expect(await make({ enabled: false }).react('test', { sessionId: 'g', ply: 2, transcript: { valid: true } }))
      .toMatchObject({ quip: 'That one was mine.', source: 'disabled' });
    expect(await make({ chat: async () => 'Move to square 4.' }).react('test', { sessionId: 'g', ply: 2, transcript: { valid: true } }))
      .toMatchObject({ quip: 'That one was mine.', source: 'fallback', fallbackReason: 'invalid_output' });
  });

  it('rejects a forged transcript', async () => {
    await expect(make().react('test', { sessionId: 'g', ply: 9, transcript: { valid: true } }))
      .rejects.toMatchObject({ code: 'invalid_game' });
  });
});
