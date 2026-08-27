import { describe, expect, it, vi } from 'vitest';
import { createGame, playMove } from '#shared/gaming/rulesets/chess/engine.mjs';
import {
  createChessOpponentCommentaryService,
  normalizeQuip,
} from './ChessOpponentCommentaryService.mjs';

function gameAfter(...moves) {
  return moves.reduce((game, move) => playMove(game, move).game, createGame());
}

function serviceWith({ response = 'That knight has plans.', enabled = true } = {}) {
  const chat = vi.fn(async () => response);
  return {
    chat,
    service: createChessOpponentCommentaryService({
      aiGateway: { chat },
      ladderService: {
        rungFor: vi.fn(async () => ({
          level: 0,
          opponent: {
            name: 'Tempo',
            dialogue: {
              persona: 'Bright, brave, and a little cheeky.',
              chess_voice: 'Notices simple tactics without pretending to be an expert.',
              lore: { type: ['bug'], references: ['String Shot'], known_references: ['String Shot', 'Poison Sting'], use: 'sparingly_as_playful_metaphor' },
            },
          },
        })),
      },
      readConfig: async () => ({ personality: { enabled } }),
    }),
  };
}

describe('ChessOpponentCommentaryService', () => {
  it('grounds a tiny-model request in a replayed committed move', async () => {
    const { service, chat } = serviceWith();
    const game = gameAfter('e4', 'Nf6');
    const result = await service.react({
      userId: 'learner4', gameId: 'g1', ply: 2, level: 0, playerColor: 'w', game,
    });
    expect(result).toEqual({ eventId: 'g1:2:Nf6', quip: 'That knight has plans.', source: 'ai' });
    expect(chat).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: expect.stringContaining('Tempo') }),
    ]), expect.objectContaining({ model: 'gpt-5.6-luna', reasoningEffort: 'none', maxTokens: 40 }));
    expect(chat.mock.calls[0][0][1].content).toContain('"san":"Nf6"');
    expect(chat.mock.calls[0][0][1].content).toContain('Full current-game moves');
    expect(chat.mock.calls[0][0][1].content).toContain('never use "barely looked"');
    expect(chat.mock.calls[0][0][1].content).toContain('CHARACTER PERSONA: Bright, brave, and a little cheeky.');
    expect(chat.mock.calls[0][0][1].content).toContain('CHESS VOICE: Notices simple tactics');
    expect(chat.mock.calls[0][0][1].content).toContain('String Shot');
  });

  it('includes only shown in-game dialogue and compact rivalry context', async () => {
    const { service, chat } = serviceWith();
    const game = gameAfter('e4', 'Nf6');
    await service.react({
      gameId: 'g-history', ply: 2, level: 0, playerColor: 'w', game,
      dialogue: [{ ply: 1, quip: 'A small step with plans.' }],
    });
    expect(chat.mock.calls[0][0][1].content).toContain('A small step with plans.');
  });

  it('falls back without holding the game hostage to bad output', async () => {
    const { service } = serviceWith({ response: 'You stupid idiot!' });
    const game = gameAfter('e4', 'd5', 'exd5');
    const result = await service.react({ gameId: 'g2', ply: 3, level: 0, playerColor: 'w', game });
    expect(result.source).toBe('fallback');
    expect(result.quip).toBe('That capture stung.');
  });

  it('does not call AI when personality is disabled', async () => {
    const { service, chat } = serviceWith({ enabled: false });
    const game = gameAfter('e4');
    const result = await service.react({ gameId: 'g3', ply: 1, level: 0, playerColor: 'w', game });
    expect(result.source).toBe('disabled');
    expect(chat).not.toHaveBeenCalled();
  });

  it('rejects a forged ply or an unreplayable record', async () => {
    const { service } = serviceWith();
    await expect(service.react({
      gameId: 'g4', ply: 9, level: 0, playerColor: 'w', game: gameAfter('e4'),
    })).rejects.toMatchObject({ code: 'invalid_game' });
    await expect(service.react({
      gameId: 'g4', ply: 1, level: 0, playerColor: 'w',
      game: { initial_fen: 'bad', fen: 'bad', moves: ['e4'] },
    })).rejects.toMatchObject({ code: 'invalid_game' });
  });
});

describe('normalizeQuip', () => {
  it('removes wrappers and caps prose to one short sentence', () => {
    expect(normalizeQuip('Quip: “A sharp move! Here is an explanation.”')).toBe('A sharp move!');
  });

  it('rejects emoji and hostile language', () => {
    expect(normalizeQuip('Nice move 😈')).toBeNull();
    expect(normalizeQuip('You are stupid.')).toBeNull();
  });

  it('rejects private chess notation, repeated wording, and unapproved lore', () => {
    // Regressions drawn from the August 26 production transcript.
    expect(normalizeQuip('Barely looked—okay, your pawn steps to f3!')).toBeNull();
    expect(normalizeQuip('I see e4 coming.')).toBeNull();
    expect(normalizeQuip('Qxd6 wins that piece.')).toBeNull();
    expect(normalizeQuip('O-O keeps me safe.')).toBeNull();
    expect(normalizeQuip('A clever little trap!', 96, {
      dialogue: [{ ply: 2, quip: 'A clever little trap is waiting.' }],
    })).toBeNull();
    expect(normalizeQuip('Oops, rook check!', 96, {
      dialogue: [{ ply: 2, quip: 'Oops, rook check!' }],
    })).toBeNull();
    const lore = { references: ['String Shot'], known_references: ['String Shot', 'Poison Sting'] };
    expect(normalizeQuip('String Shot slows you down.', 96, { lore })).toBe('String Shot slows you down.');
    expect(normalizeQuip('Poison Sting surprises you.', 96, { lore })).toBeNull();
  });
});
