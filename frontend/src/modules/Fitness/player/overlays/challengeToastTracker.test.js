import { describe, it, expect } from 'vitest';
import { createChallengeToastTracker, nextChallengeToast } from './challengeToastTracker.js';

describe('nextChallengeToast', () => {
  it('emits "start" the first time a challenge is seen pending', () => {
    const t0 = createChallengeToastTracker();
    const r = nextChallengeToast(t0, { id: 'c1', status: 'pending' });
    expect(r.event).toBe('start');
  });

  it('emits "end" when a started challenge becomes success', () => {
    let t = createChallengeToastTracker();
    t = nextChallengeToast(t, { id: 'c1', status: 'pending' }).tracker;
    const r = nextChallengeToast(t, { id: 'c1', status: 'success' });
    expect(r.event).toBe('end');
  });

  it('emits only "end" for a challenge first seen already in success (instant case)', () => {
    const t0 = createChallengeToastTracker();
    const r1 = nextChallengeToast(t0, { id: 'c2', status: 'success' });
    expect(r1.event).toBe('end');
    const r2 = nextChallengeToast(r1.tracker, { id: 'c2', status: 'pending' });
    expect(r2.event).toBeNull();
  });

  it('emits nothing for failed or null snapshots', () => {
    let t = createChallengeToastTracker();
    t = nextChallengeToast(t, { id: 'c3', status: 'pending' }).tracker;
    expect(nextChallengeToast(t, { id: 'c3', status: 'failed' }).event).toBeNull();
    expect(nextChallengeToast(t, null).event).toBeNull();
    expect(nextChallengeToast(t, { status: 'pending' }).event).toBeNull();
  });

  it('does not re-emit start or end on repeated identical snapshots', () => {
    let t = createChallengeToastTracker();
    const a = nextChallengeToast(t, { id: 'c4', status: 'pending' });
    expect(a.event).toBe('start');
    const b = nextChallengeToast(a.tracker, { id: 'c4', status: 'pending' });
    expect(b.event).toBeNull();
    const c = nextChallengeToast(b.tracker, { id: 'c4', status: 'success' });
    expect(c.event).toBe('end');
    const d = nextChallengeToast(c.tracker, { id: 'c4', status: 'success' });
    expect(d.event).toBeNull();
  });

  it('threads one tracker across a multi-challenge session sequence', () => {
    const events = [];
    let t = createChallengeToastTracker();
    const feed = (challenge) => {
      const r = nextChallengeToast(t, challenge);
      t = r.tracker;
      if (r.event) events.push(`${challenge.id}:${r.event}`);
    };

    feed({ id: 'A', status: 'pending' });
    feed({ id: 'A', status: 'pending' });
    feed({ id: 'A', status: 'success' });
    feed({ id: 'A', status: 'success' });
    feed(null);
    feed({ id: 'B', status: 'success' });
    feed(null);
    feed({ id: 'C', status: 'pending' });
    feed({ id: 'C', status: 'failed' });

    expect(events).toEqual(['A:start', 'A:end', 'B:end', 'C:start']);
  });
});
