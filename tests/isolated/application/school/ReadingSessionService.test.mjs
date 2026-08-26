import { describe, it, expect } from 'vitest';
import { ReadingSessionService } from '#apps/school/ReadingSessionService.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };

describe('ReadingSessionService', () => {
  it('has no session at a location until a card opens one', () => {
    expect(new ReadingSessionService({ logger: silent }).current('livingroom')).toBeNull();
  });

  it('opens a session for a learner at a location', () => {
    const s = new ReadingSessionService({ clock: () => new Date('2026-08-26T18:00:00Z'), logger: silent });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    expect(s.current('livingroom')).toMatchObject({ learnerId: 'learner-c', location: 'livingroom' });
    expect(s.current('livingroom').openedAt).toBe('2026-08-26T18:00:00.000Z');
  });

  it('a second card REPLACES the first — last tap wins', () => {
    const s = new ReadingSessionService({ logger: silent });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    s.open({ location: 'livingroom', learnerId: 'learner-d' });
    expect(s.current('livingroom').learnerId).toBe('learner-d');
  });

  it('scopes sessions per location', () => {
    const s = new ReadingSessionService({ logger: silent });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    expect(s.current('study')).toBeNull();
  });

  it('closes a session', () => {
    const s = new ReadingSessionService({ logger: silent });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    s.close('livingroom');
    expect(s.current('livingroom')).toBeNull();
  });

  it('broadcasts the open so the screen can render it', () => {
    const sent = [];
    const s = new ReadingSessionService({
      eventBus: { broadcast: (t, p) => sent.push({ topic: t, payload: p }) }, logger: silent,
    });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    expect(sent[0]).toMatchObject({
      topic: 'reading:livingroom',
      payload: { event: 'session-open', learnerId: 'learner-c' },
    });
  });

  it('broadcasts the close too', () => {
    const sent = [];
    const s = new ReadingSessionService({
      eventBus: { broadcast: (t, p) => sent.push({ topic: t, payload: p }) }, logger: silent,
    });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    s.close('livingroom');
    expect(sent[1]).toMatchObject({
      topic: 'reading:livingroom',
      payload: { event: 'session-close', learnerId: 'learner-c' },
    });
  });

  it('does not broadcast a close for a location with no session', () => {
    const sent = [];
    const s = new ReadingSessionService({
      eventBus: { broadcast: (t, p) => sent.push({ topic: t, payload: p }) }, logger: silent,
    });
    expect(s.close('livingroom')).toBeNull();
    expect(sent).toEqual([]);
  });

  // A card tap has to answer. A dead bus costs the screen an update; it must
  // never cost the child the session they just opened.
  it('opens even when the event bus throws', () => {
    const s = new ReadingSessionService({
      eventBus: { broadcast: () => { throw new Error('bus down'); } }, logger: silent,
    });
    expect(() => s.open({ location: 'livingroom', learnerId: 'learner-c' })).not.toThrow();
    expect(s.current('livingroom').learnerId).toBe('learner-c');
  });

  it('closes even when the event bus throws', () => {
    const s = new ReadingSessionService({
      eventBus: { broadcast: () => { throw new Error('bus down'); } }, logger: silent,
    });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    expect(() => s.close('livingroom')).not.toThrow();
    expect(s.current('livingroom')).toBeNull();
  });

  it('refuses an open with no location or no learner', () => {
    const s = new ReadingSessionService({ logger: silent });
    expect(() => s.open({ learnerId: 'learner-c' })).toThrow();
    expect(() => s.open({ location: 'livingroom' })).toThrow();
  });

  // The session's STATE (prompt / confirm / reading) is what the interceptor
  // reads to decide whether a book tap lands mid-story. It is stored; the
  // MODE (assignment/browsing) never is — that is derived on every evaluation.
  it('opens at the prompt state', () => {
    const s = new ReadingSessionService({ logger: silent });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    expect(s.current('livingroom').state).toBe('prompt');
  });

  it('updates a session in place and broadcasts the update', () => {
    const sent = [];
    const s = new ReadingSessionService({
      eventBus: { broadcast: (t, p) => sent.push({ topic: t, payload: p }) }, logger: silent,
    });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    const updated = s.update('livingroom', { state: 'reading' });
    expect(updated).toMatchObject({ learnerId: 'learner-c', state: 'reading' });
    expect(s.current('livingroom').state).toBe('reading');
    expect(sent[1]).toMatchObject({
      topic: 'reading:livingroom',
      payload: { event: 'session-update', learnerId: 'learner-c', state: 'reading' },
    });
  });

  it('updating a location with no session answers null and changes nothing', () => {
    const s = new ReadingSessionService({ logger: silent });
    expect(s.update('livingroom', { state: 'reading' })).toBeNull();
    expect(s.current('livingroom')).toBeNull();
  });

  it('an update cannot reassign the learner — a swap is a new open', () => {
    const s = new ReadingSessionService({ logger: silent });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    s.update('livingroom', { learnerId: 'learner-d', location: 'study', state: 'reading' });
    expect(s.current('livingroom')).toMatchObject({
      learnerId: 'learner-c', location: 'livingroom', state: 'reading',
    });
  });

  it('a session is frozen — nobody mutates it through the handle they were given', () => {
    const s = new ReadingSessionService({ logger: silent });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    expect(Object.isFrozen(s.current('livingroom'))).toBe(true);
  });
});
