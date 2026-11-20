import { describe, expect, it } from 'vitest';
import { cardBadge, coinSize, lessonTitle, mapColumns, mapRows, nextStep, passageBars, passageFaded, pieceCount, pieceFocus, relativeTime, scoreHeading, stripCards, stripGroups } from './deskModel.js';

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

  it('drops a leading lesson number from a lesson title', () => {
    expect(lessonTitle('Lesson 51 | Jingle Bells: New Rhythm (Right Hand)')).toBe('Jingle Bells: New Rhythm (Right Hand)');
    expect(lessonTitle('Lesson 12: Swing')).toBe('Swing');
    expect(lessonTitle('How to Play the Folk Song "Lady, Lady"')).toBe('How to Play the Folk Song "Lady, Lady"');
    expect(lessonTitle('Lesson 3')).toBe('Lesson 3');
    expect(lessonTitle(null)).toBe('');
  });
  it('badges a card by why it is there', () => {
    expect(cardBadge({ kind: 'piece', piece: { silver: 1, gold: 0, total: 3 } })).toEqual({ level: 'silver', label: 'Silver next' });
    expect(cardBadge({ kind: 'piece', piece: { silver: 3, gold: 1, total: 3 } })).toEqual({ level: 'gold', label: 'Gold next' });
    expect(cardBadge({ kind: 'piece', piece: { silver: 3, gold: 3, total: 3 } })).toEqual({ level: 'gold', label: 'All Gold' });
    expect(cardBadge({ kind: 'course', course: {} })).toEqual({ level: 'lesson', label: 'Next lesson' });
  });
  it('names the next step: the bars up next, or the lesson number', () => {
    expect(nextStep({ kind: 'piece', focus: { start: 0, end: 3 } })).toBe('Bars 1–4');
    // The number printed in the title wins over the server's position.
    expect(nextStep({ kind: 'course', course: { completed: 47, next: { title: 'Lesson 51 | Jingle Bells', position: 48 } } })).toBe('Lesson 51');
    expect(nextStep({ kind: 'course', course: { completed: 98, next: { title: 'Au Clair de la Lune', position: 99 } } })).toBe('Lesson 99');
    expect(nextStep({ kind: 'course', course: { completed: 98, next: { title: 'x' } } })).toBe('Lesson 99');
    expect(nextStep({ kind: 'course', course: { completed: 5, next: null } })).toBe('');
  });
  it('lays coins in one row up to fourteen, else two equal rows', () => {
    expect(mapColumns(12)).toBe(12);
    expect(mapColumns(14)).toBe(14);
    expect(mapColumns(20)).toBe(10);
    expect(mapRows(14)).toBe(1);
    expect(mapRows(15)).toBe(2);
  });
  it('sizes coins to fill the card row, never above 20px', () => {
    expect(coinSize(3)).toBe(20);
    expect(coinSize(12)).toBe(12);
    expect(coinSize(20)).toBe(15);
  });
});
