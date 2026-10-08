import { describe, it, expect } from 'vitest';
import {
  emptyRegistry,
  normalizeScreenName,
  buildScreenView,
  renameScreen,
  setScreenRoom,
  touchScreen,
  addScreen,
  mergeScreens,
  retireScreen,
  restoreScreen,
  unmergeScreen,
  resolveScreenId,
  aliasesOf,
  SCREEN_DEFAULTS,
  roomAdjacencyView,
  setRoomNeighbours,
} from './screenRegistry.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-03T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const configured = [
  { id: 'fleet:livingroom-tv', screenId: 'livingroom-tv', name: 'Living Room TV', room: 'Living Room', type: 'shield-tv' },
  { id: 'fleet:office-tv', screenId: 'office-tv', name: 'Office Screen', room: 'Office', type: 'linux-pc' },
];

function seen(state, id, name, at = NOW) {
  return touchScreen(state, id, { name, at: iso(at) }).state;
}

describe('normalizeScreenName', () => {
  it('trims, collapses spaces and bounds the length; empty is null', () => {
    expect(normalizeScreenName('  Kitchen   tablet ')).toBe('Kitchen tablet');
    expect(normalizeScreenName('x'.repeat(100))).toHaveLength(SCREEN_DEFAULTS.maxNameLength);
    expect(normalizeScreenName('   ')).toBeNull();
    expect(normalizeScreenName(7)).toBeNull();
  });
});

describe('touchScreen (a browser announcing itself)', () => {
  it('registers a new browser with firstSeen/lastSeen and its own name', () => {
    const { state, screen } = touchScreen(emptyRegistry(), 'browser:abc12345-x', { name: 'Kitchen tablet', at: iso(NOW) }, { configured });
    expect(screen).toMatchObject({ name: 'Kitchen tablet', firstSeen: iso(NOW), lastSeen: iso(NOW), source: 'seen' });
    expect(state.screens['browser:abc12345-x'].name).toBe('Kitchen tablet');
  });
  it('suffixes a name another screen already holds (case-insensitive) with the id prefix', () => {
    let state = seen(emptyRegistry(), 'browser:aaaa1111-x', 'Kitchen tablet');
    const { screen } = touchScreen(state, 'browser:bbbb2222-y', { name: 'KITCHEN TABLET', at: iso(NOW) }, { configured });
    expect(screen.name).toBe('KITCHEN TABLET (bbbb2222)');
    const tv = touchScreen(state, 'browser:cccc3333-z', { name: 'living room tv', at: iso(NOW) }, { configured });
    expect(tv.screen.name).toBe('living room tv (cccc3333)');
  });
  it('keeps the registry name once set: a later announce only refreshes lastSeen', () => {
    let state = seen(emptyRegistry(), 'browser:a', 'Kitchen tablet', NOW - DAY);
    state = renameScreen(state, 'browser:a', 'Poo', { at: iso(NOW - DAY), configured }).state;
    const { screen } = touchScreen(state, 'browser:a', { name: 'Kitchen tablet', at: iso(NOW) }, { configured });
    expect(screen.name).toBe('Poo');
    expect(screen.lastSeen).toBe(iso(NOW));
  });
  it('an announce from a merged duplicate refreshes the screen it was merged into', () => {
    let state = seen(emptyRegistry(), 'browser:old', 'Kitchen tablet', NOW - 10 * DAY);
    state = seen(state, 'browser:new', 'Kitchen tablet 2', NOW - DAY);
    state = mergeScreens(state, 'browser:new', 'browser:old', { at: iso(NOW - DAY) }).state;
    const { state: next, id } = touchScreen(state, 'browser:new', { name: 'whatever', at: iso(NOW) }, { configured });
    expect(id).toBe('browser:old');
    expect(next.screens['browser:old'].lastSeen).toBe(iso(NOW));
    expect(next.screens['browser:new']).toBeUndefined();
  });
});

describe('renameScreen', () => {
  it('rejects a name another screen holds, with a free suggestion', () => {
    const state = seen(emptyRegistry(), 'browser:a', 'Kitchen tablet');
    expect(() => renameScreen(state, 'browser:b', 'kitchen tablet', { at: iso(NOW), configured }))
      .toThrow(expect.objectContaining({ code: 'NAME_TAKEN', details: expect.objectContaining({ suggestion: 'kitchen tablet (2)' }) }));
    expect(() => renameScreen(state, 'browser:b', 'Office screen', { at: iso(NOW), configured }))
      .toThrow(expect.objectContaining({ code: 'NAME_TAKEN' }));
  });
  it('suffixes instead when asked', () => {
    const state = seen(emptyRegistry(), 'browser:a', 'Kitchen tablet');
    expect(renameScreen(state, 'browser:b', 'Kitchen tablet', { at: iso(NOW), configured, onCollision: 'suffix' }).screen.name)
      .toBe('Kitchen tablet (2)');
  });
  it('records rename history; the view shows (was …) for a week', () => {
    let state = seen(emptyRegistry(), 'browser:a', 'Kitchen tablet', NOW - 2 * DAY);
    state = renameScreen(state, 'browser:a', 'Poo', { at: iso(NOW - DAY), configured }).state;
    expect(state.screens['browser:a'].renames).toEqual([{ from: 'Kitchen tablet', to: 'Poo', at: iso(NOW - DAY) }]);
    const view = buildScreenView({ configured: [], state, now: NOW });
    expect(view.screens[0]).toMatchObject({ name: 'Poo', wasName: 'Kitchen tablet', renamedAt: iso(NOW - DAY) });
    const later = buildScreenView({ configured: [], state, now: NOW + 7 * DAY });
    expect(later.screens[0].wasName).toBeNull();
  });
  it('renaming to its own name in another case is allowed (no collision with itself)', () => {
    const state = seen(emptyRegistry(), 'browser:a', 'Kitchen tablet');
    expect(renameScreen(state, 'browser:a', 'kitchen Tablet', { at: iso(NOW), configured }).screen.name).toBe('kitchen Tablet');
  });
  it('a configured screen keeps devices.yml untouched: the override lives in the registry', () => {
    const { state } = renameScreen(emptyRegistry(), 'fleet:office-tv', 'Study TV', { at: iso(NOW), configured });
    const view = buildScreenView({ configured, state, now: NOW });
    const office = view.screens.find((s) => s.id === 'fleet:office-tv');
    expect(office).toMatchObject({ name: 'Study TV', configuredName: 'Office Screen', wasName: 'Office Screen', configured: true });
  });
  it('rejects an empty name and an unknown screen', () => {
    expect(() => renameScreen(emptyRegistry(), 'browser:a', '  ', { at: iso(NOW), configured }))
      .toThrow(expect.objectContaining({ code: 'INVALID_NAME' }));
    expect(() => renameScreen(emptyRegistry(), 'nope', 'x', { at: iso(NOW), configured }))
      .toThrow(expect.objectContaining({ code: 'INVALID_SCREEN_ID' }));
  });
});

describe('addScreen / setScreenRoom', () => {
  it('adds a named screen with a room under a screen: id; a taken name is refused', () => {
    const { state, screen, id } = addScreen(emptyRegistry(), { name: 'Garage tablet', room: 'Garage', at: iso(NOW) }, { configured });
    expect(id).toBe('screen:garage-tablet');
    expect(screen).toMatchObject({ name: 'Garage tablet', room: 'Garage', source: 'added', lastSeen: null });
    expect(() => addScreen(state, { name: 'garage tablet', at: iso(NOW) }, { configured })).toThrow(expect.objectContaining({ code: 'NAME_TAKEN' }));
  });
  it('sets and clears a room', () => {
    let state = setScreenRoom(emptyRegistry(), 'fleet:livingroom-tv', 'Den', { configured }).state;
    expect(buildScreenView({ configured, state, now: NOW }).screens.find((s) => s.id === 'fleet:livingroom-tv').room).toBe('Den');
    state = setScreenRoom(state, 'fleet:livingroom-tv', null, { configured }).state;
    expect(buildScreenView({ configured, state, now: NOW }).screens.find((s) => s.id === 'fleet:livingroom-tv').room).toBe('Living Room');
  });
});

describe('mergeScreens', () => {
  it('folds a duplicate into its earlier self: alias recorded, earliest firstSeen, latest lastSeen kept', () => {
    let state = seen(emptyRegistry(), 'browser:old', 'Kitchen tablet', NOW - 20 * DAY);
    state = seen(state, 'browser:new', 'Kitchen tablet (new)', NOW - DAY);
    const { state: merged } = mergeScreens(state, 'browser:new', 'browser:old', { at: iso(NOW) });
    expect(merged.screens['browser:new']).toBeUndefined();
    // The folded entry is kept on the alias, so the merge can be undone.
    expect(merged.aliases['browser:new']).toEqual({
      into: 'browser:old', mergedAt: iso(NOW), was: expect.objectContaining({ name: 'Kitchen tablet (new)', lastSeen: iso(NOW - DAY) }),
    });
    expect(merged.screens['browser:old']).toMatchObject({ firstSeen: iso(NOW - 20 * DAY), lastSeen: iso(NOW - DAY) });
    expect(resolveScreenId(merged, 'browser:new')).toBe('browser:old');
    expect(aliasesOf(merged, 'browser:old')).toEqual(['browser:old', 'browser:new']);
    const view = buildScreenView({ configured: [], state: merged, now: NOW });
    expect(view.screens).toHaveLength(1);
    expect(view.screens[0].aliases).toEqual(['browser:new']);
  });
  it('re-points aliases of the duplicate too (a chain never forms)', () => {
    let state = seen(emptyRegistry(), 'browser:a', 'A');
    state = seen(state, 'browser:b', 'B');
    state = seen(state, 'browser:c', 'C');
    state = mergeScreens(state, 'browser:c', 'browser:b', { at: iso(NOW) }).state;
    state = mergeScreens(state, 'browser:b', 'browser:a', { at: iso(NOW) }).state;
    expect(state.aliases['browser:c'].into).toBe('browser:a');
    expect(resolveScreenId(state, 'browser:c')).toBe('browser:a');
  });
  it('refuses to merge a screen into itself, a configured screen away, or into an unknown screen', () => {
    const state = seen(emptyRegistry(), 'browser:a', 'A');
    expect(() => mergeScreens(state, 'browser:a', 'browser:a', { at: iso(NOW) })).toThrow(expect.objectContaining({ code: 'INVALID_MERGE' }));
    expect(() => mergeScreens(state, 'fleet:office-tv', 'browser:a', { at: iso(NOW), configured })).toThrow(expect.objectContaining({ code: 'INVALID_MERGE' }));
    expect(() => mergeScreens(state, 'browser:a', 'browser:zzz', { at: iso(NOW) })).toThrow(expect.objectContaining({ code: 'SCREEN_NOT_FOUND' }));
  });
  it('can merge a browser into a configured screen (a kiosk that showed up as a browser)', () => {
    const state = seen(emptyRegistry(), 'browser:a', 'Office browser');
    const merged = mergeScreens(state, 'browser:a', 'fleet:office-tv', { at: iso(NOW), configured }).state;
    expect(aliasesOf(merged, 'fleet:office-tv')).toEqual(['fleet:office-tv', 'browser:a']);
  });
});

describe('unmergeScreen', () => {
  it('brings a merged duplicate back as its own screen, with its own name and times', () => {
    let state = seen(emptyRegistry(), 'browser:old', 'Kitchen tablet', NOW - 20 * DAY);
    state = seen(state, 'browser:new', 'Hall tablet', NOW - DAY);
    state = mergeScreens(state, 'browser:new', 'browser:old', { at: iso(NOW) }).state;
    const { state: back, screen, into } = unmergeScreen(state, 'browser:new', { at: iso(NOW + 1000), configured: [] });
    expect(into).toBe('browser:old');
    expect(back.aliases['browser:new']).toBeUndefined();
    expect(back.screens['browser:new']).toMatchObject({ name: 'Hall tablet', lastSeen: iso(NOW - DAY) });
    expect(screen).toMatchObject({ id: 'browser:new', name: 'Hall tablet' });
    expect(aliasesOf(back, 'browser:old')).toEqual(['browser:old']);
  });
  it('duplicates that came along through it go back with it', () => {
    let state = seen(emptyRegistry(), 'browser:a', 'A');
    state = seen(state, 'browser:b', 'B');
    state = seen(state, 'browser:c', 'C');
    state = mergeScreens(state, 'browser:c', 'browser:b', { at: iso(NOW) }).state;
    state = mergeScreens(state, 'browser:b', 'browser:a', { at: iso(NOW) }).state;
    const back = unmergeScreen(state, 'browser:b', { at: iso(NOW), configured: [] }).state;
    expect(resolveScreenId(back, 'browser:c')).toBe('browser:b');
  });
  it('suffixes its old name if another screen took it meanwhile; refuses an id that was never merged', () => {
    let state = seen(emptyRegistry(), 'browser:old', 'Kitchen tablet');
    state = seen(state, 'browser:new', 'Hall tablet');
    state = mergeScreens(state, 'browser:new', 'browser:old', { at: iso(NOW) }).state;
    state = seen(state, 'browser:third', 'Hall tablet');
    expect(unmergeScreen(state, 'browser:new', { at: iso(NOW), configured: [] }).screen.name).toBe('Hall tablet (2)');
    expect(() => unmergeScreen(state, 'browser:old', { at: iso(NOW), configured: [] })).toThrow(expect.objectContaining({ code: 'NOT_MERGED' }));
  });
});

describe('retire / restore and Not seen lately', () => {
  it('retired screens leave the list and free their name; restore brings them back', () => {
    let state = seen(emptyRegistry(), 'browser:a', 'Kitchen tablet');
    state = retireScreen(state, 'browser:a', { at: iso(NOW), configured }).state;
    let view = buildScreenView({ configured: [], state, now: NOW });
    expect(view.screens).toHaveLength(0);
    expect(view.retired.map((s) => s.id)).toEqual(['browser:a']);
    expect(renameScreen(seen(state, 'browser:b', 'x'), 'browser:b', 'Kitchen tablet', { at: iso(NOW), configured }).screen.name).toBe('Kitchen tablet');
    state = restoreScreen(state, 'browser:a', { configured }).state;
    view = buildScreenView({ configured: [], state, now: NOW });
    expect(view.screens.map((s) => s.id)).toEqual(['browser:a']);
  });
  it('folds screens silent for 30 days into notSeenLately; configured screens with no signal stay listed', () => {
    let state = seen(emptyRegistry(), 'browser:old', 'Old laptop', NOW - 31 * DAY);
    state = seen(state, 'browser:fresh', 'Fresh', NOW - 29 * DAY);
    const view = buildScreenView({ configured, state, now: NOW });
    expect(view.notSeenLately.map((s) => s.id)).toEqual(['browser:old']);
    expect(view.screens.map((s) => s.id)).toEqual(expect.arrayContaining(['browser:fresh', 'fleet:livingroom-tv', 'fleet:office-tv']));
  });
  it('live signals (liveness, ledger) refresh lastSeen without a registry write', () => {
    const state = seen(emptyRegistry(), 'browser:old', 'Old laptop', NOW - 31 * DAY);
    const view = buildScreenView({
      configured, state, now: NOW,
      signals: { 'browser:old': { lastSeen: iso(NOW - DAY) }, 'fleet:office-tv': { lastSeen: iso(NOW - 40 * DAY), online: false } },
    });
    expect(view.screens.find((s) => s.id === 'browser:old').lastSeen).toBe(iso(NOW - DAY));
    expect(view.notSeenLately.map((s) => s.id)).toEqual(['fleet:office-tv']);
  });
});

describe('room adjacency (PLACE.4a/AC6)', () => {
  it('is empty until set, and a link is mutual', () => {
    expect(roomAdjacencyView(emptyRegistry())).toEqual({});
    const { state, adjacency } = setRoomNeighbours(emptyRegistry(), 'Kitchen', ['Den', ' living room ']);
    expect(adjacency).toEqual({ Den: ['Kitchen'], Kitchen: ['Den', 'living room'], 'living room': ['Kitchen'] });
    expect(roomAdjacencyView(state)).toEqual(adjacency);
  });

  it('replaces a room\'s neighbours (removing the mirrored links), ignores itself and blanks, matches case-insensitively', () => {
    let { state } = setRoomNeighbours(emptyRegistry(), 'Kitchen', ['Den', 'Hall']);
    ({ state } = setRoomNeighbours(state, 'kitchen', ['Hall', 'KITCHEN', '']));
    expect(roomAdjacencyView(state)).toEqual({ Hall: ['kitchen'], kitchen: ['Hall'] });
    ({ state } = setRoomNeighbours(state, 'Hall', []));
    expect(roomAdjacencyView(state)).toEqual({});
  });

  it('rejects a blank room or a non-list', () => {
    expect(() => setRoomNeighbours(emptyRegistry(), '  ', [])).toThrow(/room/i);
    expect(() => setRoomNeighbours(emptyRegistry(), 'Den', 'Hall')).toThrow(/list/i);
  });

  it('survives renames and merges of screens (state is carried through clone)', () => {
    const { state } = setRoomNeighbours(emptyRegistry(), 'Kitchen', ['Den']);
    const renamed = setScreenRoom(state, 'fleet:livingroom-tv', 'Den', { configured, at: iso(NOW) });
    expect(roomAdjacencyView(renamed.state)).toEqual({ Den: ['Kitchen'], Kitchen: ['Den'] });
  });
});
