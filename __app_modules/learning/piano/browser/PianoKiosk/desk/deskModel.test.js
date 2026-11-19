import { describe, expect, it } from 'vitest';
import { coinSize, mapColumns, passageBars, passageFaded, pieceCount, pieceFocus, relativeTime, scoreHeading, stripCards, stripGroups } from './deskModel.js';

const passages = [{ id: 'a', start: 0, end: 4, state: 'silver' }, { id: 'b', start: 5, end: 8, state: 'todo' }];
const piece = { total: 2, silver: 1, gold: 0, practicedAt: '2026-11-18T10:00:00Z', next: { passageId: 'b' }, nextGoldPassageId: 'a', passages };
const course = { courseId: 'plex:1', lastPlayedAt: '2026-11-18T09:00:00Z' };

describe('deskModel', () => {
  it('reads the printed title and composer', () => {
    expect(scoreHeading('<work-title>Jesu, Joy of Man&apos;s Desiring</work-title><creator type="composer">Bach</creator>'))
      .toEqual({ title: "Jesu, Joy of Man's Desiring", composer: 'Bach' });
  });
  it('gives a child their piece and their course side by side, children by their latest activity', () => {
    const cards = stripCards({
      pieces: [{ userId: 'a', name: 'A', piece }, { userId: 'b', name: 'B', piece: null }, { userId: 'c', name: 'C', piece: null }],
      courses: [{ userId: 'a', courses: [course] }, { userId: 'b', courses: [{ ...course, lastPlayedAt: '2026-11-18T11:00:00Z' }] }, { userId: 'c', courses: [course] }],
    });
    expect(cards.map((card) => [card.userId, card.kind])).toEqual([['b', 'course'], ['a', 'piece'], ['a', 'course'], ['c', 'course']]);
    expect(new Set(cards.map((card) => card.key)).size).toBe(4);
  });
  it('groups a child cards under one header, children by their latest activity', () => {
    const groups = stripGroups({
      pieces: [{ userId: 'a', name: 'A', piece }, { userId: 'b', name: 'B', piece: null }],
      courses: [{ userId: 'a', courses: [course] }, { userId: 'b', courses: [{ ...course, lastPlayedAt: '2026-11-18T11:00:00Z' }] }],
    });
    expect(groups.map((group) => [group.userId, group.name, group.cards.map((card) => card.kind)])).toEqual([['b', 'B', ['course']], ['a', 'A', ['piece', 'course']]]);
  });
  it('sizes passage coins to fill the card width, as large as 26px', () => {
    expect(coinSize(12)).toBe(26);
    expect(coinSize(8)).toBe(26);
    expect(coinSize(16)).toBe(19);
    expect(coinSize(18)).toBe(16);
  });
  it('fades only the tomatoes nobody has started, never the one up next', () => {
    expect(passageFaded({ state: 'todo', steps: { done: 0, total: 4 } }, false)).toBe(true);
    expect(passageFaded({ state: 'todo', steps: { done: 0, total: 4 } }, true)).toBe(false);
    expect(passageFaded({ state: 'todo', steps: { done: 1, total: 4 } }, false)).toBe(false);
    expect(passageFaded({ state: 'learning', steps: { done: 2, total: 4 } }, false)).toBe(false);
    expect(passageFaded({ state: 'silver' }, false)).toBe(false);
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

  it('lays a piece out in one row of up to six coins, else two equal rows', () => {
    expect(mapColumns(5)).toBe(5);
    expect(mapColumns(6)).toBe(6);
    expect(mapColumns(8)).toBe(4);
    expect(mapColumns(12)).toBe(6);
    expect(mapColumns(13)).toBe(7);
  });
});
