import { describe, expect, it } from 'vitest';
import { createCharadesChallengeOrder, createSeededRoundOrder } from './charadesSelection.mjs';

const performers = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }));
const challenges = [
  ...Array.from({ length: 6 }, (_, index) => ({ id: `image-${index}`, activity: 'charades', prompt: `Image ${index}`, decoder: { image: `/image-${index}.svg` } })),
  ...Array.from({ length: 12 }, (_, index) => ({ id: `text-${index}`, activity: 'charades', prompt: `Text ${index}` })),
];

describe('Charades deterministic selection', () => {
  it('creates one independently shuffled performer permutation per round', () => {
    const first = createSeededRoundOrder(performers, 3, 42);
    const replay = createSeededRoundOrder(performers, 3, 42);
    const different = createSeededRoundOrder(performers, 3, 43);
    expect(first).toEqual(replay);
    expect(first.order).not.toEqual(different.order);
    for (let round = 0; round < 3; round += 1) {
      expect(first.order.slice(round * 6, (round + 1) * 6).sort()).toEqual(performers.map(({ id }) => id).sort());
    }
  });

  it('selects image and text clues from independent eligible pools', () => {
    const turnOrder = createSeededRoundOrder(performers, 3, 42);
    const result = createCharadesChallengeOrder({
      challenges, turnOrder: turnOrder.order, cluesPerTurn: 1,
      imageParticipantIds: ['a', 'b'], seed: turnOrder.rngState,
    });
    const selected = result.order.map((index) => challenges[index]);
    const imageClues = selected.filter((_, index) => ['a', 'b'].includes(turnOrder.order[index]));
    const textClues = selected.filter((_, index) => !['a', 'b'].includes(turnOrder.order[index]));
    expect(new Set(imageClues.map(({ id }) => id)).size).toBe(6);
    expect(imageClues.every((clue) => Boolean(clue.decoder?.image))).toBe(true);
    expect(textClues.every((clue) => !clue.decoder?.image)).toBe(true);
  });

  it('preserves the legacy lazy pool shuffle when captured history is absent', () => {
    const result = createCharadesChallengeOrder({
      challenges,
      turnOrder: ['text-player', 'image-player', 'text-player', 'image-player'],
      cluesPerTurn: 1,
      imageParticipantIds: ['image-player'],
      seed: 42,
    });
    expect(result.order).toEqual([8, 2, 6, 4]);
  });

  it('reshuffles an exhausted pool without an immediate repeat', () => {
    const twoTextChallenges = challenges.filter(({ decoder }) => !decoder).slice(0, 2);
    const result = createCharadesChallengeOrder({
      challenges: twoTextChallenges, turnOrder: ['a', 'a', 'a', 'a', 'a'],
      cluesPerTurn: 1, imageParticipantIds: [], seed: 9,
    });
    for (let index = 1; index < result.order.length; index += 1) {
      expect(result.order[index]).not.toBe(result.order[index - 1]);
    }
  });

  it('uses every currently-unused clue before recycling an exhausted pool', () => {
    const result = createCharadesChallengeOrder({
      challenges: challenges.slice(0, 3),
      turnOrder: ['a', 'a', 'a'], cluesPerTurn: 1, imageParticipantIds: ['a'],
      historyIds: ['image-0', 'image-1'], seed: 7,
    });
    expect(challenges[result.order[0]].id).toBe('image-2');
    expect(new Set(result.order.slice(1)).size).toBe(2);
  });

  it('derives the current cycle after complete historical exhaustion', () => {
    const result = createCharadesChallengeOrder({
      challenges: challenges.slice(0, 3), turnOrder: ['a'], cluesPerTurn: 1,
      imageParticipantIds: ['a'], historyIds: ['image-0', 'image-1', 'image-2', 'image-1'], seed: 4,
    });
    expect(challenges[result.order[0]].id).not.toBe('image-1');
  });

  it('ignores historical ids absent from the current eligible bank', () => {
    const result = createCharadesChallengeOrder({
      challenges: challenges.slice(0, 2), turnOrder: ['a'], cluesPerTurn: 1,
      imageParticipantIds: ['a'], historyIds: ['retired-clue'], seed: 2,
    });
    expect(result.order).toHaveLength(1);
  });

  it('rejects a missing pool instead of changing the configured presentation', () => {
    const textOnly = challenges.filter(({ decoder }) => !decoder);
    expect(() => createCharadesChallengeOrder({
      challenges: textOnly, turnOrder: ['preschooler'], cluesPerTurn: 1,
      imageParticipantIds: ['preschooler'], seed: 1,
    })).toThrow('image challenge pool');
  });
});
