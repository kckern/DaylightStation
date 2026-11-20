import { describe, expect, it } from 'vitest';
import { piecePolishing, cardBadge, coinLayout, coinSize, lessonNumber, lessonTitle, nextSkill, swipeTarget, mapColumns, mapRows, nextStep, passageBars, passageFaded, pieceCount, pieceFocus, pieceLabel, relativeTime, scoreHeading, shownCard, stripCards, stripGroups } from './deskModel.js';

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
    expect(cardBadge({ kind: 'piece', piece: { silver: 3, gold: 3, total: 3 } })).toEqual({ level: 'gold', label: 'Polish next' });
  });
  it('once a piece is all Gold, badges the Polish goal: Polish next, Diamond next, then Diamond', () => {
    const allGold = { silver: 3, gold: 3, total: 3 };
    expect(cardBadge({ kind: 'piece', piece: { ...allGold, polish: { gem: false, diamond: false } } })).toEqual({ level: 'gold', label: 'Polish next' });
    expect(cardBadge({ kind: 'piece', piece: { ...allGold, polish: { gem: true, diamond: false } } })).toEqual({ level: 'diamond', label: 'Diamond next' });
    expect(cardBadge({ kind: 'piece', piece: { ...allGold, polish: { gem: true, diamond: true } } })).toEqual({ level: 'diamond', label: 'Diamond' });
    // Awards on a piece that is no longer all Gold (a passage added) leave the ladder badge alone.
    expect(cardBadge({ kind: 'piece', piece: { silver: 3, gold: 2, total: 3, polish: { gem: true, diamond: false } } })).toEqual({ level: 'gold', label: 'Gold next' });
  });
  it('names the next step: the bars up next, or the lesson number', () => {
    expect(nextStep({ kind: 'piece', focus: { start: 0, end: 3 } })).toBe('Bars 1–4');
    // The number printed in the title wins over the server's position.
    expect(nextStep({ kind: 'course', course: { completed: 47, next: { title: 'Lesson 51 | Jingle Bells', position: 48 } } })).toBe('Lesson 51');
    expect(nextStep({ kind: 'course', course: { completed: 98, next: { title: 'Au Clair de la Lune', position: 99 } } })).toBe('Lesson 99');
    expect(nextStep({ kind: 'course', course: { completed: 98, next: { title: 'x' } } })).toBe('Lesson 99');
    expect(nextStep({ kind: 'course', course: { completed: 5, next: null } })).toBe('');
  // A bare "Lesson 3" title keeps its own number, whatever the position says.
  expect(nextStep({ kind: 'course', course: { completed: 4, next: { title: 'Lesson 3', position: 5 } } })).toBe('Lesson 3');
  });
  it('names the whole piece as the next step once every passage is Gold', () => {
    const gold = { total: 3, silver: 3, gold: 3, passages: [] };
    expect(piecePolishing(gold)).toBe(true);
    expect(piecePolishing({ ...gold, gold: 2 })).toBe(false);
    expect(nextStep({ kind: 'piece', piece: gold, focus: { start: 0, end: 3 } })).toBe('Whole piece');
    expect(nextStep({ kind: 'piece', piece: { ...gold, gold: 0 }, focus: { start: 0, end: 3 } })).toBe('Bars 1–4');
  });
  it('never gives a longer piece bigger coins, with or without a Polish stone', () => {
    for (const extra of [0, 1]) {
      for (let n = 1; n <= 30; n += 1) expect(coinSize(n + 1, extra), `n=${n} extra=${extra}`).toBeLessThanOrEqual(coinSize(n, extra));
    }
  });
  it('puts the count beside a short piece\'s coins, so two to four passages get big ones', () => {
    expect(coinLayout(2)).toEqual({ rows: 1, columns: 2, size: 36, countBeside: true });
    expect(coinLayout(3).size).toBe(36);
    expect(coinLayout(4).size).toBe(30);
    expect(coinLayout(4).countBeside).toBe(true);
  });
  it('moves the count above a one-row map once the row needs its full width', () => {
    expect(coinLayout(6)).toEqual({ rows: 1, columns: 6, size: 24, countBeside: false });
    expect(coinLayout(7)).toEqual({ rows: 1, columns: 7, size: 23, countBeside: false });
  });
  it('takes more rows only when they give coins 3px bigger, and three for a very long piece', () => {
    // Eight stay on one row: two rows would win only 2px, not worth tall cards.
    expect(coinLayout(8)).toEqual({ rows: 1, columns: 8, size: 20, countBeside: false });
    // Nine take two rows, their coins held to eight's size so a longer piece never gets bigger ones.
    expect(coinLayout(9)).toEqual({ rows: 2, columns: 5, size: 20, countBeside: false });
    expect(coinLayout(10)).toEqual({ rows: 2, columns: 5, size: 20, countBeside: false });
    expect(coinLayout(20)).toEqual({ rows: 2, columns: 10, size: 15, countBeside: false });
    expect(coinLayout(24)).toEqual({ rows: 2, columns: 12, size: 12, countBeside: false });
    expect(coinLayout(26)).toEqual({ rows: 3, columns: 9, size: 12, countBeside: false });
    // Three rows keep coins at 12px or more up to 36 passages.
    expect(coinLayout(36).size).toBe(12);
    expect(mapRows(5)).toBe(1);
    expect(mapRows(20)).toBe(2);
    expect(mapColumns(20)).toBe(10);
    expect(coinSize(20)).toBe(15);
  });
  it('makes room for one more coin-sized slot when the row ends in a Polish stone', () => {
    expect(coinLayout(3, 1)).toEqual({ rows: 1, columns: 3, size: 30, countBeside: true });
    expect(coinSize(10, 1)).toBeLessThanOrEqual(coinSize(10));
  });
  it('reads the coach\'s next skill as the piece card\'s what-to-do line, never while polishing', () => {
    const piece = { total: 3, gold: 0, next: { passageId: 'a', skill: 'pulse', label: 'Settle into a beat' } };
    expect(nextSkill({ kind: 'piece', piece })).toBe('Settle into a beat');
    expect(nextSkill({ kind: 'piece', piece: { ...piece, next: { passageId: 'a' } } })).toBe('');
    expect(nextSkill({ kind: 'piece', piece: { ...piece, next: null } })).toBe('');
    expect(nextSkill({ kind: 'piece', piece: { ...piece, gold: 3 } })).toBe('');
    expect(nextSkill({ kind: 'course', course: {} })).toBe('');
  });
  it('numbers the next lesson on its own, for the course card', () => {
    expect(lessonNumber({ completed: 47, next: { title: 'Lesson 51 | Jingle Bells', position: 48 } })).toBe('51');
    expect(lessonNumber({ completed: 98, next: { title: 'x' } })).toBe('99');
    expect(lessonNumber({ completed: 5, next: null })).toBe('');
  });
  it('steps through a child\'s cards like a carousel, wrapping both ways', () => {
    const cards = [{ kind: 'piece' }, { kind: 'course' }];
    expect(swipeTarget(cards, 'piece', 'left').kind).toBe('course');
    expect(swipeTarget(cards, 'course', 'left').kind).toBe('piece');
    expect(swipeTarget(cards, 'piece', 'right').kind).toBe('course');
    const three = [{ kind: 'a' }, { kind: 'b' }, { kind: 'c' }];
    expect(swipeTarget(three, 'a', 'right').kind).toBe('c');
    expect(swipeTarget(three, 'c', 'left').kind).toBe('a');
    expect(swipeTarget([{ kind: 'piece' }], 'piece', 'left')).toBeNull();
  });
  it('names a piece card with its Polish stone for a screen reader', () => {
    expect(pieceLabel('Kid', { silver: 3, total: 3 })).toBe('Kid: 3 of 3 Silver');
    expect(pieceLabel('Kid', { silver: 3, total: 3, polish: { gem: true, diamond: false } })).toBe('Kid: 3 of 3 Silver, Polish gem');
    expect(pieceLabel('Kid', { silver: 3, total: 3, polish: { gem: true, diamond: true } })).toBe('Kid: 3 of 3 Silver, Polish diamond');
  });
  it('shows the chosen activity, else the most recent one', () => {
    const pieceCard = { kind: 'piece', at: '2026-11-18T10:00:00Z' };
    const courseCard = { kind: 'course', at: '2026-11-18T11:00:00Z' };
    const both = { userId: 'a', cards: [pieceCard, courseCard] };
    expect(shownCard(both)).toBe(courseCard);
    expect(shownCard(both, 'piece')).toBe(pieceCard);
    expect(shownCard(both, 'course')).toBe(courseCard);
    expect(shownCard({ userId: 'a', cards: [{ ...pieceCard, at: '2026-11-18T12:00:00Z' }, courseCard] }).kind).toBe('piece');
    // A choice the child no longer has falls back to what they do have.
    expect(shownCard({ userId: 'a', cards: [pieceCard] }, 'course')).toBe(pieceCard);
    // A card with no time loses to one with a time; a tie keeps the piece.
    expect(shownCard({ userId: 'a', cards: [{ kind: 'piece', at: '' }, courseCard] })).toBe(courseCard);
    expect(shownCard({ userId: 'a', cards: [{ kind: 'piece', at: 'x' }, { kind: 'course', at: 'x' }] }).kind).toBe('piece');
    expect(shownCard({ userId: 'a', cards: [] })).toBeNull();
  });
});
