// @vitest-environment node
import os from 'node:os';
import path from 'node:path';
import fs from 'fs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { cachedEvidenceLabels, cachedWeekPreview, cachedSheetRewards, createEconomyEarningsRuntime } from "./earnings.mjs";
import { createEconomyApi } from "./economyApi.mjs";

const quiet = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child() { return this; } });

describe('cachedEvidenceLabels', () => {
  const lines = [{ ref: 'line:1', label: 'Green day' }, { ref: 'line:2', label: null }, { ref: null, label: 'x' }];
  const makePreview = (day = '2026-10-20') => ({
    currentStudyDay: vi.fn(() => day),
    preview: vi.fn(async ({ learnerId }) => {
      if (learnerId === 'stranger') throw new EntityNotFoundError('learner', learnerId);
      if (learnerId === 'broken') throw new Error('rings down');
      return { lines };
    }),
  });

  it('maps the current week\'s preview lines, ref → label', async () => {
    const labels = cachedEvidenceLabels({ preview: makePreview(), now: () => 0 });
    expect(await labels('kid')).toEqual(new Map([['line:1', 'Green day']]));
  });
  it('serves a repeat from the cache, per learner and week, until the TTL runs out', async () => {
    let now = 0;
    const preview = makePreview();
    const labels = cachedEvidenceLabels({ preview, now: () => now, ttlMs: 60_000 });
    await labels('kid');
    now = 59_999;
    await labels('kid');
    expect(preview.preview).toHaveBeenCalledTimes(1);
    await labels('sibling');
    expect(preview.preview).toHaveBeenCalledTimes(2);
    now = 60_000;
    await labels('kid');
    expect(preview.preview).toHaveBeenCalledTimes(3);
  });
  it('concurrent misses for one key share one preview; a rejection is evicted', async () => {
    let release;
    const preview = makePreview();
    preview.preview.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const labels = cachedEvidenceLabels({ preview, now: () => 0 });
    const both = Promise.all([labels('kid'), labels('kid')]);
    release({ lines });
    const [a, b] = await both;
    expect(a).toBe(b);
    expect(preview.preview).toHaveBeenCalledTimes(1);
    preview.preview.mockImplementationOnce(() => Promise.reject(new Error('flaky')));
    const failing = cachedEvidenceLabels({ preview, now: () => 0 });
    await expect(Promise.all([failing('kid'), failing('kid')])).rejects.toThrow('flaky');
    expect(preview.preview).toHaveBeenCalledTimes(2);
    expect(await failing('kid')).toEqual(new Map([['line:1', 'Green day']]));
    expect(preview.preview).toHaveBeenCalledTimes(3);
  });
  it('a new week is a new key', async () => {
    const preview = makePreview();
    const labels = cachedEvidenceLabels({ preview, now: () => 0 });
    await labels('kid');
    preview.currentStudyDay.mockReturnValue('2026-10-26');
    await labels('kid');
    expect(preview.preview).toHaveBeenCalledTimes(2);
  });
  it('a learner off the roster gets null; any other failure is thrown and not cached', async () => {
    const preview = makePreview();
    const labels = cachedEvidenceLabels({ preview, now: () => 0 });
    expect(await labels('stranger')).toBeNull();
    await expect(labels('broken')).rejects.toThrow('rings down');
    await expect(labels('broken')).rejects.toThrow('rings down');
    expect(preview.preview.mock.calls.filter(([a]) => a.learnerId === 'broken')).toHaveLength(2);
  });
});

describe('cachedSheetRewards', () => {
  const TODAY = '2026-10-21';
  const weekOf = (state = 'obligated') => ({
    today: TODAY,
    windows: { school: { from: '2026-10-19', to: '2026-10-25' } },
    evidence: { school: 'ok', rings: 'ok' },
    work: { days: [] },
    lines: [
      { ruleId: 'korean-daily', kind: 'section-day', match: { subject: 'language' }, status: 'pending', overridden: false,
        priced: { reward: { silver: 2, gems: 0 }, multiplier: 1 }, evidence: [{ day: TODAY, state }], ref: 'r:1', label: 'Korean' },
    ],
  });
  const UNIT = { unitId: 'language.07', title: 'Korean 7', subject: 'language' };
  const setup = ({ mode = 'live', fail = null } = {}) => {
    const state = { mode };
    const preview = {
      currentStudyDay: vi.fn(() => TODAY),
      preview: vi.fn(async ({ learnerId }) => {
        if (learnerId === 'stranger') throw new EntityNotFoundError('learner', learnerId);
        if (fail) throw fail;
        return weekOf();
      }),
    };
    const logger = quiet();
    const weeks = cachedWeekPreview({ preview, now: () => 0 });
    const rewardFor = cachedSheetRewards({ weeks, config: { catalog: () => ({ mode: state.mode }) }, logger });
    return { state, preview, logger, weeks, rewardFor };
  };

  it('live: the section-day price for a subject still open today', async () => {
    const { rewardFor } = setup();
    expect(await rewardFor({ learnerId: 'kid', unit: UNIT })).toEqual({ silver: 2, gems: 0 });
  });
  it('off and dry-run: null, and no preview is run', async () => {
    const { state, preview, rewardFor } = setup({ mode: 'off' });
    expect(await rewardFor({ learnerId: 'kid', unit: UNIT })).toBeNull();
    state.mode = 'dry-run';
    expect(await rewardFor({ learnerId: 'kid', unit: UNIT })).toBeNull();
    expect(preview.preview).not.toHaveBeenCalled();
  });
  it('shares one cached preview with the bank\'s evidence labels', async () => {
    const { preview, weeks, rewardFor } = setup();
    const labels = cachedEvidenceLabels({ preview, weeks });
    await labels('kid');
    await rewardFor({ learnerId: 'kid', unit: UNIT });
    await rewardFor({ learnerId: 'kid', unit: UNIT });
    expect(preview.preview).toHaveBeenCalledTimes(1);
  });
  it('a failing preview is null, warned once per learner; off the roster is null, unwarned', async () => {
    const { rewardFor, logger } = setup({ fail: new Error('rings down') });
    expect(await rewardFor({ learnerId: 'kid', unit: UNIT })).toBeNull();
    expect(await rewardFor({ learnerId: 'kid', unit: UNIT })).toBeNull();
    expect(await rewardFor({ learnerId: 'stranger', unit: UNIT })).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('economy.sheet-reward.failed', { learnerId: 'kid', error: 'rings down' });
  });
  it('a config read that throws is null too, never thrown into the caller', async () => {
    const preview = { currentStudyDay: () => TODAY, preview: vi.fn() };
    const logger = quiet();
    const rewardFor = cachedSheetRewards({
      weeks: cachedWeekPreview({ preview }), config: { catalog: () => { throw new Error('bad yaml'); } }, logger,
    });
    expect(await rewardFor({ learnerId: 'kid', unit: UNIT })).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe('createEconomyApi + createEconomyEarningsRuntime', () => {
  let dir;
  afterEach(() => { vi.useRealTimers(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  const build = async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'econ-wiring-'));
    const configService = {
      getUserProfile: (id) => (id === 'kid' ? { id } : null),
      getUserDir: (id) => path.join(dir, id),
      getHouseholdAppConfig: () => ({ mode: 'off', earn: {}, passes: {} }),
      getHouseholdPath: (rel) => path.join(dir, rel ?? ''),
      getDataDir: () => dir,
    };
    const economyApi = createEconomyApi({ configService, logger: quiet(), timezone: 'America/Los_Angeles' });
    const bind = vi.spyOn(economyApi, 'useEvidenceLabels');
    const runtime = await createEconomyEarningsRuntime({
      schoolLifecycle: null, economyApi,
      fitnessRings: { standings: async () => [] },
      schoolLearnerDirectory: { listLearners: async () => [] },
      measuresTimezone: 'UTC', // ignored: the economy's study calendar wins
      rootLogger: quiet(),
    });
    return { economyApi, runtime, bind };
  };

  it('one timezone reaches the service and the preview: 03:59 PDT is still yesterday for both', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T10:59:00.000Z'));
    const { economyApi, runtime } = await build();
    expect(economyApi.studyCalendar).toEqual({ timezone: 'America/Los_Angeles', boundaryHour: 4 });
    expect(economyApi.economyService.currentStudyDay()).toBe('2026-10-19');
    expect(runtime.earningsPreview.currentStudyDay()).toBe('2026-10-19');
  });
  it('warns once at build when the process TZ (the week-close job\'s) differs from the household timezone', () => {
    const configService = { getHouseholdAppConfig: () => ({}), getUserProfile: () => null, getUserDir: () => '/nonexistent', getHouseholdPath: () => '/nonexistent' };
    const make = (processTimezone) => { const logger = quiet(); createEconomyApi({ configService, logger, timezone: 'America/Los_Angeles', processTimezone }); return logger.warn; };
    expect(make('UTC')).toHaveBeenCalledWith('economy.timezone-mismatch', { processTimezone: 'UTC', householdTimezone: 'America/Los_Angeles' });
    expect(make('America/Los_Angeles')).not.toHaveBeenCalled();
    expect(make(undefined)).not.toHaveBeenCalled();
  });
  it('the runtime binds the bank\'s evidence labels; a learner off the roster reads null', async () => {
    const { bind } = await build();
    expect(bind).toHaveBeenCalledTimes(1);
    const labels = bind.mock.calls[0][0];
    expect(await labels('kid')).toBeNull();
  });
  it('economyApi.rewardFor is null until the runtime binds the sheet rewards, then asks them', async () => {
    const { economyApi } = await build();
    const fresh = createEconomyApi({ configService: { getHouseholdAppConfig: () => ({}), getUserProfile: () => null, getUserDir: () => '/nonexistent', getHouseholdPath: () => '/nonexistent' }, logger: quiet() });
    expect(await fresh.rewardFor({ learnerId: 'kid', unit: { subject: 'language' } })).toBeNull();
    const bound = vi.fn(async () => ({ silver: 1, gems: 0 }));
    fresh.useSheetRewards(bound);
    expect(await fresh.rewardFor({ learnerId: 'kid', unit: { subject: 'language' } })).toEqual({ silver: 1, gems: 0 });
    // The real runtime bound one; mode off here, so it answers null.
    expect(await economyApi.rewardFor({ learnerId: 'kid', unit: { subject: 'language' } })).toBeNull();
  });
});
