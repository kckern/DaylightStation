/**
 * createPianoCourseTitleLookup — names a piano course (a Plex show, or a
 * season named by its show) for learner work, with a process-level TTL cache
 * and a per-call timeout so a slow Plex never holds up the weekly review.
 */
import { describe, it, expect } from 'vitest';
import { createPianoCourseTitleLookup } from '../../../../__app_modules/learning/school/server/composition/pianoCourseTitles.mjs';

function fakeTimers() {
  const pending = new Map();
  let next = 1;
  return {
    pending,
    setTimer: (fn, ms) => { const id = next++; pending.set(id, { fn, ms }); return id; },
    clearTimer: (id) => { pending.delete(id); },
    fire: () => { for (const [id, { fn }] of [...pending]) { pending.delete(id); fn(); } },
  };
}

function recordingLogger() {
  const events = [];
  const at = (level) => (event, data) => events.push({ level, event, data });
  return { events, info: at('info'), warn: at('warn'), debug: at('debug'), error: at('error') };
}

const meta = {
  694771: { type: 'show', title: 'Piano Adventures' },
  700: { type: 'season', title: 'Piano', parentTitle: 'My Music Workshop' },
};
function plexClient(calls = []) {
  return {
    getContainer: async (path) => {
      calls.push(path);
      const key = path.split('/').pop();
      return meta[key] ? { MediaContainer: { Metadata: [meta[key]] } } : { MediaContainer: { Metadata: [] } };
    },
  };
}

describe('createPianoCourseTitleLookup', () => {
  it('names a show by its title and a season by its show', async () => {
    const titleFor = createPianoCourseTitleLookup({ getPlexClient: () => plexClient(), ...fakeTimers() });
    expect(await titleFor('plex:694771')).toBe('Piano Adventures');
    expect(await titleFor('plex:700')).toBe('My Music Workshop');
    expect(await titleFor('plex:plex:694771')).toBe('Piano Adventures');
    expect(await titleFor('plex:999')).toBeNull();
    expect(await titleFor('other:1')).toBeNull();
    expect(await titleFor(null)).toBeNull();
  });

  it('caches titles across calls until the TTL passes', async () => {
    const calls = [];
    let clock = 0;
    const titleFor = createPianoCourseTitleLookup({
      getPlexClient: () => plexClient(calls), now: () => clock, ttlMs: 1000, ...fakeTimers(),
    });
    await titleFor('plex:694771');
    await titleFor('plex:plex:694771');
    clock = 999;
    await titleFor('plex:694771');
    expect(calls).toHaveLength(1);
    clock = 1000;
    await titleFor('plex:694771');
    expect(calls).toHaveLength(2);
  });

  it('shares one request between concurrent callers', async () => {
    const calls = [];
    const titleFor = createPianoCourseTitleLookup({ getPlexClient: () => plexClient(calls), ...fakeTimers() });
    const [a, b] = await Promise.all([titleFor('plex:694771'), titleFor('plex:694771')]);
    expect([a, b]).toEqual(['Piano Adventures', 'Piano Adventures']);
    expect(calls).toHaveLength(1);
  });

  it('bounds the cache, dropping the oldest entry', async () => {
    const calls = [];
    const titleFor = createPianoCourseTitleLookup({ getPlexClient: () => plexClient(calls), maxEntries: 2, ...fakeTimers() });
    await titleFor('plex:1');
    await titleFor('plex:2');
    await titleFor('plex:3');
    await titleFor('plex:2');
    expect(calls).toHaveLength(3);
    await titleFor('plex:1');
    expect(calls).toHaveLength(4);
  });

  it('answers null on timeout, logs it, does not cache it, and clears its timer on success', async () => {
    const timers = fakeTimers();
    const logger = recordingLogger();
    let resolveSlow;
    let slow = true;
    const client = {
      getContainer: (path) => (slow
        ? new Promise((r) => { resolveSlow = r; })
        : plexClient().getContainer(path)),
    };
    const titleFor = createPianoCourseTitleLookup({ getPlexClient: () => client, timeoutMs: 2500, logger, ...timers });
    const pending = titleFor('plex:694771');
    expect([...timers.pending.values()].map((t) => t.ms)).toEqual([2500]);
    timers.fire();
    expect(await pending).toBeNull();
    resolveSlow({ MediaContainer: { Metadata: [meta[694771]] } });
    expect(logger.events.find((e) => e.event === 'school.learner-work.piano-title-timeout')?.level).toBe('warn');
    slow = false;
    expect(await titleFor('plex:694771')).toBe('Piano Adventures');
    expect(timers.pending.size).toBe(0);
  });

  it('answers null when Plex throws or is absent, and retries next time', async () => {
    const logger = recordingLogger();
    let fail = true;
    const client = { getContainer: async (path) => { if (fail) throw new Error('plex down'); return plexClient().getContainer(path); } };
    const titleFor = createPianoCourseTitleLookup({ getPlexClient: () => client, logger, ...fakeTimers() });
    expect(await titleFor('plex:694771')).toBeNull();
    expect(logger.events.some((e) => e.event === 'school.learner-work.piano-title-failed')).toBe(true);
    fail = false;
    expect(await titleFor('plex:694771')).toBe('Piano Adventures');

    const none = createPianoCourseTitleLookup({ getPlexClient: () => null, ...fakeTimers() });
    expect(await none('plex:694771')).toBeNull();
  });
});
