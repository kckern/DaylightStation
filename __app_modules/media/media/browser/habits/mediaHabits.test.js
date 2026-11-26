import { describe, it, expect, beforeEach } from 'vitest';
import { createHabitsStore, rankByHabits, normalizeQuery, itemKind, HABITS_KEY } from './mediaHabits.js';
import { resolvePlayDestination, destinationLabels, canPlayOn } from './playDestination.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
  };
}

const DAY = 24 * 60 * 60 * 1000;

describe('habits: picks (search words → what was chosen)', () => {
  let storage; let clock; let store;
  beforeEach(() => {
    storage = memoryStorage();
    clock = 1_800_000_000_000;
    store = createHabitsStore({ getStorage: () => storage, now: () => clock });
  });

  // The interview case, with the real result order "sonic" returned on
  // 2026-11-25: album, track, episode, album, show, then the film.
  const SONIC = [
    { id: 'plex:675543', title: 'Sonic' },
    { id: 'plex:539131', title: 'Sonic City' },
    { id: 'plex:7401', title: 'Sonic Breakout' },
    { id: 'plex:142332', title: 'Sonic Firestorm' },
    { id: 'plex:68196', title: 'Sonic the Hedgehog (show)' },
    { id: 'plex:775444', title: 'Sonic the Hedgehog' },
  ];

  it('puts the film picked last time first for the same words', () => {
    store.recordPick('sonic', SONIC[5]);
    const ranked = rankByHabits(SONIC, store.scoresFor('sonic'));
    expect(ranked[0].id).toBe('plex:775444');
    // Everything else keeps the order it came in.
    expect(ranked.slice(1).map(r => r.id)).toEqual(SONIC.slice(0, 5).map(r => r.id));
  });

  it('lifts it while the words are still being typed, and when they run on', () => {
    store.recordPick('sonic', SONIC[5]);
    expect(rankByHabits(SONIC, store.scoresFor('son'))[0].id).toBe('plex:775444');
    expect(rankByHabits(SONIC, store.scoresFor('Sonic the'))[0].id).toBe('plex:775444');
    // Two letters is too little to mean anything.
    expect(rankByHabits(SONIC, store.scoresFor('so'))).toBe(SONIC);
  });

  it('ignores case, spacing and punctuation in the words', () => {
    store.recordPick('  Sonic!! ', SONIC[5]);
    expect(normalizeQuery('  Sonic!! ')).toBe('sonic');
    expect(store.scoresFor('SONIC').get('plex:775444')).toBeGreaterThan(0);
  });

  it('a pick made more often, or more lately, wins', () => {
    store.recordPick('sonic', SONIC[4]);
    clock += 40 * DAY;
    store.recordPick('sonic', SONIC[5]);
    const ranked = rankByHabits(SONIC, store.scoresFor('sonic'));
    expect(ranked.slice(0, 2).map(r => r.id)).toEqual(['plex:775444', 'plex:68196']);
  });

  it('a remembered pick holds row 1 before the search answers, and the real row replaces it in place', () => {
    store.recordPick('sonic', { ...SONIC[5], type: 'movie', thumbnail: '/t.jpg' });
    const early = rankByHabits([SONIC[0]], store.scoresFor('sonic'), store.rememberedFor('sonic'));
    expect(early.map(r => r.id)).toEqual(['plex:775444', 'plex:675543']);
    expect(early[0]).toMatchObject({ title: 'Sonic the Hedgehog', type: 'movie', thumbnail: '/t.jpg', remembered: true });
    const late = rankByHabits(SONIC, store.scoresFor('sonic'), store.rememberedFor('sonic'));
    expect(late[0]).toBe(SONIC[5]);
    // Row 1 never moved: only what is drawn in it was replaced.
    expect(late[0].id).toBe(early[0].id);
  });

  it('returns the very same list when nothing was learned (callers can tell)', () => {
    expect(rankByHabits(SONIC, store.scoresFor('sonic'))).toBe(SONIC);
  });

  it('survives a reload (it lives in this browser) and rereads when storage is cleared', () => {
    store.recordPick('sonic', SONIC[5]);
    const again = createHabitsStore({ getStorage: () => storage, now: () => clock });
    expect(again.scoresFor('sonic').has('plex:775444')).toBe(true);
    storage.removeItem(HABITS_KEY);
    expect(again.scoresFor('sonic').size).toBe(0);
  });

  it('ignores unreadable or foreign-version storage instead of breaking', () => {
    storage.setItem(HABITS_KEY, '{not json');
    const broken = createHabitsStore({ getStorage: () => storage });
    expect(broken.scoresFor('sonic').size).toBe(0);
    storage.setItem(HABITS_KEY, JSON.stringify({ v: 99, picks: { sonic: {} } }));
    expect(createHabitsStore({ getStorage: () => storage }).scoresFor('sonic').size).toBe(0);
  });
});

describe('habits: screens (what kind of thing → where it was played)', () => {
  it('one "Play here" does not undo a habit; a new habit takes over within a few plays', () => {
    const storage = memoryStorage();
    let clock = 1_800_000_000_000;
    const store = createHabitsStore({ getStorage: () => storage, now: () => clock });
    for (let i = 0; i < 3; i++) { store.recordScreen('video', ['office-tv']); clock += DAY; }
    store.recordScreen('video', []);
    expect(store.screenFor('video')).toEqual(['office-tv']);
    for (let i = 0; i < 4; i++) { clock += DAY; store.recordScreen('video', ['livingroom-tv']); }
    expect(store.screenFor('video')).toEqual(['livingroom-tv']);
  });

  it('drops the first release\'s screens (they counted default plays as choices)', () => {
    const storage = memoryStorage();
    storage.setItem(HABITS_KEY, JSON.stringify({ v: 1, picks: {}, screens: { video: { targetIds: [], at: 1 } } }));
    expect(createHabitsStore({ getStorage: () => storage }).screenFor('video')).toBeNull();
  });

  it('remembers the last deliberate screen per kind', () => {
    const storage = memoryStorage();
    const store = createHabitsStore({ getStorage: () => storage });
    expect(store.screenFor('video')).toBeNull();
    store.recordScreen('video', ['office-tv']);
    store.recordScreen('audio', []);
    expect(store.screenFor('video')).toEqual(['office-tv']);
    expect(store.screenFor('audio')).toEqual([]);
    expect(store.recordScreen(null, ['x'])).toBe(false);
  });

  it('knows a film from a song', () => {
    expect(itemKind({ metadata: { type: 'movie' } })).toBe('video');
    expect(itemKind({ type: 'episode' })).toBe('video');
    expect(itemKind({ mediaType: 'audio' })).toBe('audio');
    expect(itemKind({ format: 'video' })).toBe('video');
    expect(itemKind({ format: 'dash_video' })).toBe('video');
    expect(itemKind({ format: 'hls_video' })).toBe('video');
    expect(itemKind({ metadata: { type: 'album' } })).toBe('audio');
    expect(itemKind({ type: 'game' })).toBeNull();
  });
});

describe('where a ▶ goes', () => {
  const office = { id: 'office-tv', name: 'Office Screen', type: 'linux-pc', content_control: { type: 'websocket' } };
  const garage = { id: 'garage-tv', name: 'Garage Gym TV', type: 'linux-pc', fleet: true };
  const headset = { id: 'speaker-red', name: 'Red Headset', type: 'speaker', fleet: true };
  const devices = [office, garage, headset];

  it('the aim wins over anything learned', () => {
    const d = resolvePlayDestination({ aimIds: ['speaker-red'], learnedIds: ['office-tv'], devices, kind: 'video' });
    expect(d).toMatchObject({ targetIds: ['speaker-red'], source: 'aim' });
  });

  it('an explicit This device plays here, over a learned screen, without asking', () => {
    const d = resolvePlayDestination({ here: true, learnedIds: ['office-tv'], devices, kind: 'video' });
    expect(d).toMatchObject({ targetIds: [], source: 'here' });
    expect(resolvePlayDestination({ here: true, devices, kind: 'video' }).source).toBe('here');
    // A screen aimed still wins (here only means something with nothing aimed).
    expect(resolvePlayDestination({ here: true, aimIds: ['office-tv'], devices, kind: 'video' }).source).toBe('aim');
  });

  it('with nothing aimed, the learned screen', () => {
    const d = resolvePlayDestination({ learnedIds: ['office-tv'], devices, kind: 'video' });
    expect(d).toMatchObject({ targetIds: ['office-tv'], source: 'learned' });
    expect(destinationLabels(d)).toEqual({ short: 'Office Screen', sentence: 'Play on Office Screen' });
  });

  it('never a learned screen that cannot take it, is gone, or is this browser', () => {
    // A film with no usable learned screen ASKS; a chosen "this browser" is here.
    expect(resolvePlayDestination({ learnedIds: ['speaker-red'], devices, kind: 'video' }).source).toBe('ask');
    expect(resolvePlayDestination({ learnedIds: ['den-tv'], devices, kind: 'video' }).source).toBe('ask');
    expect(resolvePlayDestination({ learnedIds: ['browser:me'], devices, localId: 'browser:me', kind: 'video' }).source).toBe('here');
    expect(destinationLabels(resolvePlayDestination({ devices, kind: 'video' }))).toEqual({ short: 'Play on…', sentence: 'Play on…' });
    expect(destinationLabels(resolvePlayDestination({ devices }))).toEqual({ short: 'Play', sentence: 'Play here' });
  });

  it('a headset plays sound only; a house-view-only display takes nothing', () => {
    expect(canPlayOn(headset, 'audio')).toBe(true);
    expect(canPlayOn(headset, 'video')).toBe(false);
    expect(canPlayOn(garage, 'video')).toBe(false);
    expect(canPlayOn(garage, null)).toBe(false);
    expect(canPlayOn(office, 'video')).toBe(true);
    expect(canPlayOn({ id: 'browser:abc', type: 'browser' }, 'video')).toBe(true);
  });
});
