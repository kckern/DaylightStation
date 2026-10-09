import { describe, expect, it } from 'vitest';
import {
  STATE, emptySlot, isPrefixLine, markAbandoned, pinGame, recordIntoSlot, selectResumable,
} from './resumeSlot.mjs';
import incident from './__fixtures__/incident-74ply.json' with { type: 'json' };

const NOW = new Date('2026-10-09T15:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600e3);
const mv = (ply, from, to, undone = false) => ({ ply, from, to, san: `${from}${to}`, undone });
const rec = (id, over = {}) => ({
  game_id: id, user_id: 'kid', started_at: '2026-10-09T10:00:00Z', ended_at: '2026-10-09T10:05:00Z',
  completed: false, ended_by: 'in_progress', initial_fen: 'X',
  moves: [mv(1, 'e2', 'e4'), mv(2, 'e7', 'e5')], ...over,
});
const put = (slot, record, at) => recordIntoSlot(slot, record, at).slot;

describe('selectResumable', () => {
  it('returns nothing for an empty slot', () => {
    expect(selectResumable(emptySlot(), { now: NOW })).toBeNull();
  });
  it('excludes finished and abandoned games', () => {
    let slot = put(emptySlot(), rec('a', { completed: true, ended_by: 'game_over' }), hoursAgo(1));
    slot = put(slot, rec('b', { ended_by: 'restarted' }), hoursAgo(1));
    expect(selectResumable(slot, { now: NOW })).toBeNull();
  });
  it('honours the window and maxDays 0 turns it off', () => {
    const slot = put(emptySlot(), rec('a'), hoursAgo(60));
    expect(selectResumable(slot, { now: NOW, maxDays: 3 }).gameId).toBe('a');
    expect(selectResumable(slot, { now: NOW, maxDays: 2 })).toBeNull();
    expect(selectResumable(slot, { now: NOW, maxDays: 0 })).toBeNull();
  });
  it('newest wins', () => {
    let slot = put(emptySlot(), rec('old', { moves: [mv(1, 'd2', 'd4')] }), hoursAgo(20));
    slot = put(slot, rec('new', { moves: [mv(1, 'c2', 'c4')] }), hoursAgo(2));
    expect(selectResumable(slot, { now: NOW }).gameId).toBe('new');
  });
  it('a pin wins over a newer game and ignores the window', () => {
    let slot = put(emptySlot(), rec('night', { started_at: '2026-10-08T20:00:00Z', moves: [mv(1, 'd2', 'd4')] }), hoursAgo(200));
    const pinned = pinGame(slot, slot.games.night.record, hoursAgo(1));
    slot = put(pinned.slot, rec('morning', { moves: [mv(1, 'c2', 'c4')] }), hoursAgo(0.5));
    const pick = selectResumable(slot, { now: NOW, maxDays: 0 });
    expect(pick).toMatchObject({ gameId: 'night', pinned: true });
  });
  it('a superseded game is never selected, and pinning supersedes newer open games without deleting them', () => {
    let slot = put(emptySlot(), rec('night', { started_at: '2026-10-08T20:00:00Z', moves: [mv(1, 'd2', 'd4')] }), hoursAgo(15));
    slot = put(slot, rec('morning', { moves: [mv(1, 'c2', 'c4')] }), hoursAgo(1));
    const { slot: pinnedSlot, superseded } = pinGame(slot, slot.games.night.record, NOW);
    expect(superseded).toEqual(['morning']);
    expect(pinnedSlot.games.morning.state).toBe(STATE.SUPERSEDED);
    expect(pinnedSlot.games.morning.record.game_id).toBe('morning');
  });
});

describe('recordIntoSlot', () => {
  it('is idempotent by game_id', () => {
    const a = recordIntoSlot(emptySlot(), rec('g'), hoursAgo(1)).slot;
    const b = recordIntoSlot(a, rec('g'), hoursAgo(1)).slot;
    expect(Object.keys(b.games)).toEqual(['g']);
  });
  it('ignores a stale, out-of-order save', () => {
    const slot = put(emptySlot(), rec('g', { ended_at: '2026-10-09T10:10:00Z', moves: [mv(1, 'e2', 'e4'), mv(2, 'e7', 'e5'), mv(3, 'g1', 'f3')] }), hoursAgo(1));
    const r = recordIntoSlot(slot, rec('g', { ended_at: '2026-10-09T10:05:00Z' }), hoursAgo(0.5));
    expect(r.applied).toBe(false);
    expect(r.slot.games.g.record.moves).toHaveLength(3);
  });
  it('a late progress save cannot resurrect a finished or abandoned game', () => {
    let slot = put(emptySlot(), rec('g', { completed: true, ended_by: 'game_over' }), hoursAgo(1));
    expect(recordIntoSlot(slot, rec('g'), hoursAgo(0.5)).applied).toBe(false);
    slot = put(emptySlot(), rec('h'), hoursAgo(1));
    slot = markAbandoned(slot, 'h').slot;
    expect(selectResumable(slot, { now: NOW })).toBeNull();
    expect(recordIntoSlot(slot, rec('h'), hoursAgo(0.5)).applied).toBe(false);
  });
  it('leaving (ended_by left) keeps a game resumable; restarting closes it', () => {
    const left = put(emptySlot(), rec('g', { ended_by: 'left' }), hoursAgo(1));
    expect(selectResumable(left, { now: NOW }).gameId).toBe('g');
    const restarted = put(left, rec('g', { ended_by: 'restarted' }), hoursAgo(0.5));
    expect(selectResumable(restarted, { now: NOW })).toBeNull();
  });
  it('a resumed continuation under a new id supersedes its earlier self, so abandoning it does not resurface the old one', () => {
    let slot = put(emptySlot(), rec('a'), hoursAgo(10));
    slot = put(slot, rec('b', { moves: [mv(1, 'e2', 'e4'), mv(2, 'e7', 'e5'), mv(3, 'g1', 'f3')] }), hoursAgo(1));
    expect(slot.games.a.state).toBe(STATE.SUPERSEDED);
    slot = put(slot, rec('b', { ended_by: 'restarted', moves: slot.games.b.record.moves }), hoursAgo(0.5));
    expect(selectResumable(slot, { now: NOW })).toBeNull();
  });
  it('refuses to pin a finished game', () => {
    expect(() => pinGame(emptySlot(), rec('g', { completed: true, ended_by: 'game_over' }))).toThrow(/finished/);
  });
  it('prefix detection compares played moves only', () => {
    expect(isPrefixLine(rec('a'), rec('b', { moves: [...rec('a').moves, mv(3, 'g1', 'f3')] }))).toBe(true);
    expect(isPrefixLine(rec('a'), rec('b', { moves: [mv(1, 'd2', 'd4')] }))).toBe(false);
  });
  it('files the real incident game as resumable', () => {
    const slot = put(emptySlot(), { ...incident, ended_by: 'left' }, hoursAgo(12.7));
    expect(selectResumable(slot, { now: NOW }).gameId).toBe('chess-1791514906380');
  });
});

describe('continuations', () => {
  it('a finished continuation closes its earlier self too', () => {
    let slot = put(emptySlot(), rec('a'), hoursAgo(10));
    slot = put(slot, rec('b', { completed: true, ended_by: 'game_over', moves: [...rec('a').moves, mv(3, 'g1', 'f3')] }), hoursAgo(1));
    expect(selectResumable(slot, { now: NOW })).toBeNull();
  });
});
