/**
 * The daily piano requirement's completion rule, which is the whole reason
 * this launcher exists rather than a config-driven `SurfaceProgramLauncher`:
 * the day is discharged by EVIDENCE (a lesson stamped complete inside today's
 * study day), not by a dispatch.
 *
 * The study-day boundary cases are the ones worth pinning: a lesson finished
 * at 11pm and a lesson finished at 1am the next morning are the SAME school
 * day (4am→4am), and a lesson finished at 5am is a new one. Getting that
 * wrong either double-charges a child or silently forgives a missed day.
 */
import { describe, it, expect } from 'vitest';
import { PianoCourseProgramLauncher } from '#apps/school/PianoCourseProgramLauncher.mjs';

const COURSE = 'plex:675689';
const TZ = 'America/Los_Angeles';

/** A fake `GetPlayableUnits` returning a fixed projection. */
const fakeUnits = (result, { ok = true, reason = null } = {}) => ({
  execute: async () => (ok ? { ok: true, result } : { ok: false, reason }),
});

const lesson = (id, { completedAt = null, watched = false, isReference = false, title = id } = {}) => ({
  id, title, isReference, userWatched: watched || !!completedAt, userCompletedAt: completedAt,
});

const launcherFor = (result, nowIso, opts) => new PianoCourseProgramLauncher({
  getPlayableUnits: fakeUnits(result, opts),
  timezone: TZ,
  clock: () => new Date(nowIso),
  logger: { warn() {}, info() {} },
});

describe('PianoCourseProgramLauncher.status', () => {
  it('is done when a lesson completed earlier in the same study day', async () => {
    const launcher = launcherFor(
      { items: [lesson('a', { completedAt: '2026-08-25T18:00:00Z', title: 'Unit 3 Lesson 7' })] },
      '2026-08-25T20:00:00Z',
    );
    const status = await launcher.status({ userId: 'felix', programInstance: COURSE });
    expect(status.doneToday).toBe(true);
    expect(status.excused).toBeUndefined();
    expect(status.progressLabel).toContain('Unit 3 Lesson 7');
  });

  it('is NOT done when the only completion was the previous study day', async () => {
    // 2026-08-24 18:00Z is 11:00 PDT on the 24th; "now" is 11:00 PDT on the
    // 25th. Two different study days, one calendar day apart.
    const launcher = launcherFor(
      { items: [lesson('a', { completedAt: '2026-08-24T18:00:00Z' })] },
      '2026-08-25T18:00:00Z',
    );
    const status = await launcher.status({ userId: 'felix', programInstance: COURSE });
    expect(status.doneToday).toBe(false);
  });

  it('treats a late-night finish and the small hours after it as ONE study day', async () => {
    // 2026-08-26T06:30Z = 23:30 PDT on the 25th. "Now" is 2026-08-26T10:00Z
    // = 03:00 PDT on the 26th — before the 4am boundary, so still the 25th.
    const launcher = launcherFor(
      { items: [lesson('a', { completedAt: '2026-08-26T06:30:00Z' })] },
      '2026-08-26T10:00:00Z',
    );
    expect((await launcher.status({ userId: 'felix', programInstance: COURSE })).doneToday).toBe(true);
  });

  it('rolls over at 4am: the same completion no longer counts after the boundary', async () => {
    // Same completion as above, but "now" is 2026-08-26T12:30Z = 05:30 PDT,
    // past the boundary — a new school day that has had no lesson yet.
    const launcher = launcherFor(
      { items: [lesson('a', { completedAt: '2026-08-26T06:30:00Z' })] },
      '2026-08-26T12:30:00Z',
    );
    expect((await launcher.status({ userId: 'felix', programInstance: COURSE })).doneToday).toBe(false);
  });

  it('does not let a reference/practice unit discharge the day', async () => {
    // Reference units give no credit in the kiosk's own progression, so they
    // must not discharge the obligation either — otherwise a child "finishes"
    // school by replaying a warm-up they are never locked out of.
    const launcher = launcherFor(
      { items: [lesson('warmup', { completedAt: '2026-08-25T18:00:00Z', isReference: true })] },
      '2026-08-25T20:00:00Z',
    );
    expect((await launcher.status({ userId: 'felix', programInstance: COURSE })).doneToday).toBe(false);
  });

  it('excuses a co-progress lockout rather than leaving an impossible debt', async () => {
    const launcher = launcherFor(
      {
        items: [lesson('a', { watched: true }), lesson('b')],
        coProgressLock: { locked: true, waitingForId: 'milo', aheadBy: 3, buffer: 3 },
      },
      '2026-08-25T20:00:00Z',
    );
    const status = await launcher.status({ userId: 'felix', programInstance: COURSE });
    expect(status.doneToday).toBe(true);
    expect(status.excused).toBe(true);
    expect(status.progressLabel).toContain('milo');
  });

  it('reports a real completion as done, not excused, even while locked', async () => {
    // The child finished today AND is now blocked from the next one. That is
    // a discharged requirement, and the ceremony must be allowed to fire.
    const launcher = launcherFor(
      {
        items: [lesson('a', { completedAt: '2026-08-25T18:00:00Z' })],
        coProgressLock: { locked: true, waitingForId: 'milo', aheadBy: 3, buffer: 3 },
      },
      '2026-08-25T20:00:00Z',
    );
    const status = await launcher.status({ userId: 'felix', programInstance: COURSE });
    expect(status.doneToday).toBe(true);
    expect(status.excused).toBeUndefined();
  });

  it('names the next lesson when the day is still owed', async () => {
    const launcher = launcherFor(
      { items: [lesson('a', { watched: true }), lesson('b', { title: 'Unit 4 Lesson 1' })] },
      '2026-08-25T20:00:00Z',
    );
    const status = await launcher.status({ userId: 'felix', programInstance: COURSE });
    expect(status.doneToday).toBe(false);
    expect(status.progressLabel).toContain('next: Unit 4 Lesson 1');
    expect(status.score).toBe(50);
  });

  it('reports error (never a silent "done") when the course cannot be read', async () => {
    const launcher = launcherFor({}, '2026-08-25T20:00:00Z', { ok: false, reason: 'invalid_user' });
    expect(await launcher.status({ userId: 'nobody', programInstance: COURSE })).toEqual({ error: true });
  });

  it('reports error when the use case throws outright', async () => {
    const launcher = new PianoCourseProgramLauncher({
      getPlayableUnits: { execute: async () => { throw new Error('plex down'); } },
      timezone: TZ, clock: () => new Date('2026-08-25T20:00:00Z'), logger: { warn() {} },
    });
    expect(await launcher.status({ userId: 'felix', programInstance: COURSE })).toEqual({ error: true });
  });

  it('is not done, and does not throw, with no course assigned', async () => {
    const launcher = launcherFor({ items: [] }, '2026-08-25T20:00:00Z');
    const status = await launcher.status({ userId: 'felix', programInstance: null });
    expect(status.doneToday).toBe(false);
  });
});

describe('PianoCourseProgramLauncher launch contract', () => {
  it('declares itself unmountable so the agenda mints no QR and no panel code', () => {
    const launcher = launcherFor({ items: [] }, '2026-08-25T20:00:00Z');
    expect(launcher.mountable).toBe(false);
    expect(launcher.surface).toBe('piano-kiosk');
    expect(launcher.locationHint).toBe('at the piano');
  });

  it('refuses to launch rather than reporting a dispatch that cannot happen', async () => {
    const launcher = launcherFor({ items: [] }, '2026-08-25T20:00:00Z');
    const result = await launcher.launch({ userId: 'felix' });
    expect(result.decision).toBe('failed');
    expect(result.message).toMatch(/piano/i);
  });

  it('throws rather than handing back a launch target no surface can open', () => {
    const launcher = launcherFor({ items: [] }, '2026-08-25T20:00:00Z');
    expect(() => launcher.issueLaunchTarget({ userId: 'felix' })).toThrow(/cannot be opened remotely/);
  });
});
