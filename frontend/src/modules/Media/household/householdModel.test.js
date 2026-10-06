import { describe, it, expect } from 'vitest';
import {
  createScreenNamer, formatDuration, formatLeft, differingSpots, resumePlan,
  toItem, spotsSummary, whereLine, playedAtLabel, nowOnScreenIds, bareScreenId, spotLine,
} from './householdModel.js';

const screens = {
  screens: [
    { id: 'fleet:livingroom-tv', screenId: 'livingroom-tv', name: 'Living Room TV', aliases: ['browser:old1'] },
    { id: 'browser:kid', screenId: null, name: "Kid's tablet", aliases: [] },
  ],
  notSeenLately: [{ id: 'fleet:garage-tv', screenId: 'garage-tv', name: 'Garage TV', aliases: [] }],
  retired: [],
};

describe('createScreenNamer', () => {
  const name = createScreenNamer(screens, { selfId: 'browser:me' });
  it('names a screen by id, bare devices.yml key, or alias', () => {
    expect(name('fleet:livingroom-tv')).toBe('Living Room TV');
    expect(name('livingroom-tv')).toBe('Living Room TV');
    expect(name('browser:old1')).toBe('Living Room TV');
    expect(name('fleet:garage-tv')).toBe('Garage TV');
  });
  it('calls this device "this device" and never shows a raw id', () => {
    expect(name('browser:me')).toBe('this device');
    expect(name('browser:unknown')).toBe('a browser');
    expect(name('fleet:den-tv')).toBe('Den TV');
    expect(name(null)).toBeNull();
  });
});

describe('formatDuration / formatLeft', () => {
  it('reads like a person would say it', () => {
    expect(formatDuration(4800)).toBe('1 h 20 m');
    expect(formatDuration(720)).toBe('12 m');
    expect(formatDuration(30)).toBe('under a minute');
    expect(formatLeft(720, 2760)).toBe('34 min left');
    expect(formatLeft(0, 7200)).toBe('2 h left');
    expect(formatLeft(7190, 7200)).toBe('almost done');
    expect(formatLeft(10, null)).toBeNull();
  });
});

describe('spots', () => {
  const entry = {
    spots: [
      { deviceId: 'fleet:livingroom-tv', screenId: 'livingroom-tv', playhead: 4800, duration: 7200, open: true, lastPlayed: '2026-10-01 21:00:00' },
      { deviceId: 'browser:kid', playhead: 720, duration: 7200, open: true, lastPlayed: '2026-10-02 08:00:00' },
      { deviceId: 'browser:closed', playhead: 7100, duration: 7200, open: false },
    ],
  };
  it('lists open spots that differ, newest first', () => {
    expect(differingSpots(entry).map(s => s.deviceId)).toEqual(['browser:kid', 'fleet:livingroom-tv']);
  });
  it('treats spots within 30 s of each other as the same spot', () => {
    const same = { spots: [
      { deviceId: 'a', playhead: 100, open: true, lastPlayed: '2026-10-01 10:00:00' },
      { deviceId: 'b', playhead: 120, open: true, lastPlayed: '2026-10-01 11:00:00' },
    ] };
    expect(differingSpots(same)).toHaveLength(1);
    expect(resumePlan(same)).toEqual({ kind: 'continue', spot: expect.objectContaining({ deviceId: 'b' }) });
  });
  it('plans: choose when spots differ, continue for one, start when none', () => {
    expect(resumePlan(entry).kind).toBe('choose');
    expect(resumePlan({ spots: [] })).toEqual({ kind: 'start' });
    expect(resumePlan(null)).toEqual({ kind: 'start' });
    expect(resumePlan({ spots: [], playhead: 300, duration: 3000, percent: 10, finished: false }))
      .toEqual({ kind: 'continue', spot: expect.objectContaining({ playhead: 300 }) });
  });
  it('summarises differing spots with screen names', () => {
    const name = createScreenNamer(screens);
    expect(spotsSummary(entry, name)).toBe("12 m on Kid's tablet · 1 h 20 m on Living Room TV");
  });
});

describe('toItem', () => {
  it('maps a household entry or suggestion to a dispatchable item', () => {
    expect(toItem({ contentId: 'plex:1', title: 'A', thumbnail: '/t', type: 'movie' }))
      .toEqual({ id: 'plex:1', title: 'A', thumbnail: '/t', type: 'movie' });
    expect(toItem({ id: 'plex:9', kind: 'collection', type: 'show', title: 'Bluey' }))
      .toEqual({ id: 'plex:9', title: 'Bluey', thumbnail: null, type: 'show', itemType: 'container' });
    expect(toItem({ id: 'plex:9', kind: 'item', type: 'episode', title: 'Bike' }).itemType).toBe('leaf');
  });
});

describe('where and when', () => {
  const name = createScreenNamer(screens);
  it('says where an item last played', () => {
    expect(whereLine({ playedOn: { deviceId: 'fleet:livingroom-tv' } }, name)).toBe('Living Room TV');
    expect(whereLine({ playedOn: 'fleet:livingroom-tv' }, name)).toBe('Living Room TV');
    expect(whereLine({ playedOn: null, plays: [{ deviceId: 'browser:kid' }] }, name)).toBe("Kid's tablet");
    expect(whereLine({ playedOn: null }, name)).toBeNull();
  });
  it('labels a time played relative to now', () => {
    const now = new Date('2026-10-03T12:00:00');
    expect(playedAtLabel(new Date('2026-10-03T09:05:00').toISOString(), now)).toMatch(/^Today 9:05/);
    expect(playedAtLabel(new Date('2026-10-02T21:30:00').toISOString(), now)).toMatch(/^Yesterday 9:30/);
    expect(playedAtLabel('2026-10-02 21:30:00', now)).toMatch(/^Yesterday 9:30/);
    expect(playedAtLabel(null, now)).toBeNull();
  });
  it('collects the screens playing each item now', () => {
    const map = nowOnScreenIds([{ contentId: 'plex:1', deviceId: 'fleet:livingroom-tv' }]);
    expect(map.get('plex:1')).toEqual(['fleet:livingroom-tv']);
    expect(bareScreenId('fleet:livingroom-tv')).toBe('livingroom-tv');
    expect(bareScreenId('browser:x')).toBe('browser:x');
  });
});

describe('spots saved before per-screen spots (review)', () => {
  const name = createScreenNamer(screens);
  it('never calls them "Legacy" or "another screen"', () => {
    expect(name('legacy')).toBe('earlier');
    expect(spotLine({ deviceId: null, playhead: 720 }, name)).toBe('12 m, saved earlier');
    expect(spotLine({ deviceId: 'legacy', kind: 'unknown', playhead: 720 }, name)).toBe('12 m, saved earlier');
    expect(spotLine({ deviceId: 'fleet:livingroom-tv', playhead: 4800 }, name)).toBe('1 h 20 m on Living Room TV');
    expect(spotsSummary({ spots: [
      { deviceId: 'legacy', playhead: 720, open: true, lastPlayed: '2026-10-02 08:00:00' },
      { deviceId: 'fleet:livingroom-tv', playhead: 4800, open: true, lastPlayed: '2026-10-01 21:00:00' },
    ] }, name)).toBe('12 m, saved earlier · 1 h 20 m on Living Room TV');
  });
});
