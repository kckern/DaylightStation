import { describe, expect, it } from 'vitest';
import { deskView, passageBars, pieceCount, scoreHeading } from './deskModel.js';

const passages = [{ id: 'a', start: 0, end: 4, state: 'silver' }, { id: 'b', start: 5, end: 8, state: 'todo' }];
const piece = { total: 2, silver: 1, gold: 0, practicedAt: 'x', next: { passageId: 'b', label: 'Find the right-hand notes' }, nextGoldPassageId: 'a', passages };

describe('deskModel', () => {
  it('reads the printed title and composer', () => {
    expect(scoreHeading('<work><work-title>Jesu, Joy of Man&apos;s Desiring</work-title></work><creator type="composer">Bach</creator>'))
      .toEqual({ title: "Jesu, Joy of Man's Desiring", composer: 'Bach' });
    expect(scoreHeading('<score />')).toEqual({ title: null, composer: null });
  });
  it('focuses the next passage for the active player', () => {
    const view = deskView({ players: [{ userId: 'k', piece }], courses: [{ userId: 'k', courses: [{ courseId: 'c' }] }], currentUser: 'k' });
    expect(view.focus.id).toBe('b');
    expect(view.action).toEqual({ label: 'Continue', detail: 'Find the right-hand notes' });
    expect(view.course.courseId).toBe('c');
    expect(passageBars(view.focus)).toBe('Bars 6–9');
    expect(pieceCount(piece)).toBe('1 of 2 passages Silver, 0 Gold');
  });
  it('offers Gold when the whole piece is Silver', () => {
    const done = { ...piece, silver: 2, next: null };
    const view = deskView({ players: [{ userId: 'k', piece: done }], currentUser: 'k' });
    expect(view.focus.id).toBe('a');
    expect(view.action).toEqual({ label: 'Go for Gold', detail: 'Your whole piece is Silver.' });
  });
  it('does not claim more work when the whole piece is Gold', () => {
    const done = { ...piece, silver: 2, gold: 2, next: null, nextGoldPassageId: null };
    expect(deskView({ players: [{ userId: 'k', piece: done }], currentUser: 'k' }).action).toEqual({ label: 'Play again', detail: 'Your whole piece is Gold.' });
  });
  it('has no focus for a player without a piece or an unknown player', () => {
    expect(deskView({ players: [{ userId: 'k', piece: null }], currentUser: 'k' })).toMatchObject({ piece: null, focus: null });
    expect(deskView({ players: null, currentUser: 'k' }).player).toBeNull();
  });
});
