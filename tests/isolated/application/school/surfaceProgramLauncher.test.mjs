/**
 * SurfaceProgramLauncher (Task 12, spec §6 "Surface programs — how daily PE
 * actually exists"): one generic `IProgramLauncher` for a `school.yml`
 * `programs:` entry. `launch()` is a thin DoNow call; `status()` derives
 * `doneToday` from the DoNow dispatch log across the two UTC shards that can
 * span one household study day.
 */
import { describe, it, expect, vi } from 'vitest';
import { SurfaceProgramLauncher } from '#apps/school/SurfaceProgramLauncher.mjs';

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

class FakeDoNowDatastore {
  constructor(rowsByDay = {}) {
    this.rowsByDay = rowsByDay;
    this.calls = [];
  }

  async listDispatches({ dayStamp } = {}) {
    this.calls.push(dayStamp);
    return this.rowsByDay[dayStamp] ?? [];
  }
}

const build = ({
  rowsByDay = {}, donowDispatch, nowIso = '2026-07-30T12:00:00Z', timezone = null,
  id = 'pe-daily', surface = 'garage-fitness', action = { episodeId: 'plex:1' },
  label = 'P.E.', subject = 'skills',
} = {}) => {
  const datastore = new FakeDoNowDatastore(rowsByDay);
  const donow = { dispatch: donowDispatch ?? vi.fn(async () => ({ decision: 'dispatched', message: 'Starting now.' })) };
  const launcher = new SurfaceProgramLauncher({
    id, label, surface, action, subject, donow, datastore,
    timezone, clock: () => new Date(nowIso), logger: silentLogger,
  });
  return { launcher, datastore, donow };
};

describe('SurfaceProgramLauncher', () => {
  it('exposes id/label/subject from its config', () => {
    const { launcher } = build({ id: 'pe-daily', label: 'P.E.', subject: 'skills' });
    expect(launcher.id).toBe('pe-daily');
    expect(launcher.label).toBe('P.E.');
    expect(launcher.subject).toBe('skills');
  });

  it('defaults label to id when config supplies none', () => {
    const launcher = new SurfaceProgramLauncher({
      id: 'pe-daily', surface: 'garage-fitness', donow: { dispatch: vi.fn() }, datastore: new FakeDoNowDatastore(),
    });
    expect(launcher.label).toBe('pe-daily');
  });

  it('requires id, surface, donow and datastore', () => {
    expect(() => new SurfaceProgramLauncher({ id: 'pe-daily' })).toThrow();
    expect(() => new SurfaceProgramLauncher({
      id: 'pe-daily', surface: 'garage-fitness', donow: { dispatch: vi.fn() },
    })).toThrow(/datastore/);
  });

  describe('launch', () => {
    it('dispatches through DoNow (requestedBy school-program, ref+programId = id) and returns the result verbatim', async () => {
      const canned = { decision: 'dispatched', message: 'Starting the garage fitness kiosk now.' };
      const { launcher, donow } = build({
        donowDispatch: vi.fn(async () => canned),
        id: 'pe-daily', surface: 'garage-fitness', action: { episodeId: 'plex:1' },
      });

      const result = await launcher.launch({ userId: 'kid1' });

      expect(result).toEqual(canned);
      expect(donow.dispatch).toHaveBeenCalledWith({
        surface: 'garage-fitness', action: { episodeId: 'plex:1' }, learnerId: 'kid1',
        requestedBy: 'school-program', ref: 'pe-daily', programId: 'pe-daily',
      });
    });

    it('hands back a pending_approval decision verbatim, never collapsing it to a boolean', async () => {
      const canned = {
        decision: 'pending_approval', approvalId: 'dnr_1', message: 'The garage fitness kiosk is busy — we asked a grown-up.',
      };
      const { launcher } = build({ donowDispatch: vi.fn(async () => canned) });

      const result = await launcher.launch({ userId: 'kid1' });

      expect(result).toEqual(canned);
    });
  });

  describe('status', () => {
    it('reports doneToday:false with no dispatch-log rows at all', async () => {
      const { launcher } = build();
      const status = await launcher.status({ userId: 'kid1' });
      expect(status).toEqual({ doneToday: false, progressLabel: null, score: null });
    });

    it('reports doneToday:true for a matching row in the current UTC shard', async () => {
      const { launcher } = build({
        id: 'pe-daily',
        rowsByDay: {
          '2026-07-30': [{
            at: '2026-07-30T09:00:00Z', surface: 'garage-fitness', decision: 'dispatch',
            learnerId: 'kid1', requestedBy: 'school-program', ref: 'pe-daily', programId: 'pe-daily',
          }],
        },
      });
      const status = await launcher.status({ userId: 'kid1' });
      expect(status).toEqual({ doneToday: true, progressLabel: null, score: null });
    });

    // REQUIRED TEST ROW (Task 12 brief, spec §6): the log shards by the UTC
    // date of the dispatch, not the household's local calendar day. A 5:01pm
    // PDT dispatch is already 00:01Z the NEXT day, so reading only "today's"
    // UTC shard would silently un-serve an evening PE dispatch by 8pm.
    it("a dispatch at 2026-07-30T00:01:00Z (5:01pm PDT) reports doneToday at 2026-07-30T03:00:00Z (8pm PDT, same evening)", async () => {
      const { launcher } = build({
        nowIso: '2026-07-30T03:00:00Z',
        timezone: 'America/Los_Angeles',
        id: 'pe-daily',
        rowsByDay: {
          '2026-07-30': [{
            at: '2026-07-30T00:01:00Z', surface: 'garage-fitness', decision: 'dispatch',
            learnerId: 'kid1', requestedBy: 'school-program', ref: 'pe-daily', programId: 'pe-daily',
          }],
        },
      });

      const status = await launcher.status({ userId: 'kid1' });

      expect(status.doneToday).toBe(true);
    });

    it('reads exactly the two UTC shards spanning now — today and yesterday', async () => {
      const { launcher, datastore } = build({ nowIso: '2026-07-30T12:00:00Z' });
      await launcher.status({ userId: 'kid1' });
      expect([...datastore.calls].sort()).toEqual(['2026-07-29', '2026-07-30']);
    });

    it('ignores a row for a different learner', async () => {
      const { launcher } = build({
        id: 'pe-daily',
        rowsByDay: {
          '2026-07-30': [{ at: '2026-07-30T09:00:00Z', learnerId: 'sibling', programId: 'pe-daily' }],
        },
      });
      const status = await launcher.status({ userId: 'kid1' });
      expect(status.doneToday).toBe(false);
    });

    it('ignores a row for a different program', async () => {
      const { launcher } = build({
        id: 'pe-daily',
        rowsByDay: {
          '2026-07-30': [{ at: '2026-07-30T09:00:00Z', learnerId: 'kid1', programId: 'other-program' }],
        },
      });
      const status = await launcher.status({ userId: 'kid1' });
      expect(status.doneToday).toBe(false);
    });

    // spec §9 row 8.
    it('ignores a same-surface, same-learner, same-day row that lacks a programId (a one-shot launch: unit)', async () => {
      const { launcher } = build({
        id: 'pe-daily', surface: 'garage-fitness',
        rowsByDay: {
          '2026-07-30': [{
            at: '2026-07-30T09:00:00Z', surface: 'garage-fitness', decision: 'dispatch',
            learnerId: 'kid1', requestedBy: 'school-scan', ref: 'ses_1',
            // no programId — this one is a per-unit `launch:` dispatch, not a
            // PE program dispatch, even though it landed on the same surface
            // for the same learner on the same day.
          }],
        },
      });
      const status = await launcher.status({ userId: 'kid1' });
      expect(status.doneToday).toBe(false);
    });

    it('a row from a prior study day does not count as done today', async () => {
      const { launcher } = build({
        id: 'pe-daily',
        rowsByDay: {
          '2026-07-29': [{ at: '2026-07-29T09:00:00Z', learnerId: 'kid1', programId: 'pe-daily' }],
        },
      });
      const status = await launcher.status({ userId: 'kid1' });
      expect(status.doneToday).toBe(false);
    });

    it('a datastore failure reports the null triple rather than throwing', async () => {
      const datastore = { listDispatches: async () => { throw new Error('disk unavailable'); } };
      const launcher = new SurfaceProgramLauncher({
        id: 'pe-daily', surface: 'garage-fitness', donow: { dispatch: vi.fn() }, datastore,
        clock: () => new Date('2026-07-30T12:00:00Z'), logger: silentLogger,
      });
      const status = await launcher.status({ userId: 'kid1' });
      expect(status).toEqual({ doneToday: false, progressLabel: null, score: null });
    });
  });
});
