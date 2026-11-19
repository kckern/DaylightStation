import { describe, expect, it } from 'vitest';
import { passageBars, pieceCount, pieceFocus, relativeTime, scoreHeading, stripCards } from './deskModel.js';

const passages = [{ id: 'a', start: 0, end: 4, state: 'silver' }, { id: 'b', start: 5, end: 8, state: 'todo' }];
const piece = { total: 2, silver: 1, gold: 0, practicedAt: '2026-11-18T10:00:00Z', next: { passageId: 'b' }, nextGoldPassageId: 'a', passages };
const course = { courseId: 'plex:1', lastPlayedAt: '2026-11-18T09:00:00Z' };

describe('deskModel', () => {
  it('reads the printed title and composer', () => {
    expect(scoreHeading('<work-title>Jesu, Joy of Man&apos;s Desiring</work-title><creator type="composer">Bach</creator>'))
      .toEqual({ title: "Jesu, Joy of Man's Desiring", composer: 'Bach' });
  });
  it('shows each child the more recent of piece and course', () => {
    const cards = stripCards({
      pieces: [{ userId: 'a', name: 'A', piece }, { userId: 'b', name: 'B', piece }, { userId: 'c', name: 'C', piece: null }],
      courses: [{ userId: 'a', courses: [course] }, { userId: 'b', courses: [{ ...course, lastPlayedAt: '2026-11-18T11:00:00Z' }] }, { userId: 'c', courses: [course] }],
    });
    expect(cards.map((card) => [card.userId, card.kind])).toEqual([['b', 'course'], ['a', 'piece'], ['c', 'course']]);
  });
  it('leaves out a child with nothing to show', () => {
    expect(stripCards({ pieces: [{ userId: 'a', piece: null }], courses: [] })).toEqual([]);
  });
  it('focuses the next passage, then Gold, then the first', () => {
    expect(pieceFocus(piece).id).toBe('b');
    expect(pieceFocus({ ...piece, next: null }).id).toBe('a');
    expect(passageBars(pieceFocus(piece))).toBe('Bars 6–9');
    expect(pieceCount(piece)).toBe('1 of 2 Silver');
  });
  it('writes coarse relative times', () => {
    expect(relativeTime('2026-11-18T10:00:00Z', Date.parse('2026-11-18T12:00:00Z'))).toBe('2h ago');
  });
});
