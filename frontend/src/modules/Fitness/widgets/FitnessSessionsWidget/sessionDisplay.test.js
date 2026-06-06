import { describe, it, expect } from 'vitest';
import { resolveSessionTitle, resolveSessionActivity } from './sessionDisplay.js';

const vidSession   = { media: { primary: { title: 'Looney Tunes Racing' } }, activities: [{ type: 'cycle-game', count: 9, items: [] }] };
const raceSession  = { media: null, activities: [{ type: 'cycle-game', count: 13, items: [] }] };
const stravaSession= { media: null, strava: { name: 'Morning Ride' }, activities: [] };
const plainSession = { media: null, activities: [] };
const oneRace      = { media: null, activities: [{ type: 'cycle-game', count: 1, items: [] }] };

describe('resolveSessionTitle', () => {
  it('prefers video media title', () => expect(resolveSessionTitle(vidSession)).toBe('Looney Tunes Racing'));
  it('uses activity label for no-video sessions', () => expect(resolveSessionTitle(raceSession)).toBe('13 races'));
  it('singular race', () => expect(resolveSessionTitle(oneRace)).toBe('1 race'));
  it('falls back to strava name', () => expect(resolveSessionTitle(stravaSession)).toBe('Morning Ride'));
  it('falls back to Workout', () => expect(resolveSessionTitle(plainSession)).toBe('Workout'));
});

describe('resolveSessionActivity', () => {
  it('returns the display for a no-video activity session', () => {
    const r = resolveSessionActivity(raceSession);
    expect(r.type).toBe('cycle-game');
    expect(r.count).toBe(13);
    expect(typeof r.display.label).toBe('function');
    expect(typeof r.display.Poster).toBe('function');
  });
  it('returns null when the session has video', () => expect(resolveSessionActivity(vidSession)).toBeNull());
  it('returns null when there are no activities', () => expect(resolveSessionActivity(plainSession)).toBeNull());
});
