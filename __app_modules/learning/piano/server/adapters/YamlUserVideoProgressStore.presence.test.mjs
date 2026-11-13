import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YamlUserVideoProgressStore } from './YamlUserVideoProgressStore.mjs';

const USER = 'test-learner';
let root;
let piano;

function configService() {
  return {
    getUserProfile: (id) => (id === USER ? { id } : null),
    getUserDir: (id) => path.join(root, id),
    getHouseholdAppConfig: () => piano,
  };
}
const EXP = { '100': { plexId: '100', showKey: '7', seasonKey: '70' } };
const expectations = { get: (id) => EXP[String(id).replace(/^plex:/, '')] ?? null };
const practice = (sittingId, extra = {}) => ({
  sittingId, humanNotes: 0, practiceNotes: 0, playedSec: 60, drillsPassed: 0, checkIns: 3, checkInsAnswered: 3, scaleCheckIns: 2, penalties: {}, ...extra,
});

function make({ records = expectations } = {}) {
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), sampled: vi.fn() };
  const sittingLog = { upsert: vi.fn() };
  const store = new YamlUserVideoProgressStore({ configService: configService(), logger, lessonExpectations: records, sittingLog });
  return { store, sittingLog, logger };
}
const topRungLogs = (logger) => logger.info.mock.calls.filter((c) => c[0] === 'piano.presence-ladder.top-rung').map((c) => c[1]);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'uvps-presence-'));
  piano = { videos: { completion_threshold_percent: 90, practice: {} } };
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('progress store: the presence ladder per sitting', () => {
  it('a sitting keeps its peak rung and minimal check-ins (max-merge across posts)', () => {
    const { store } = make();
    store.record({ userId: USER, plexId: '100', percent: 20, engaged: true, practice: practice('s1', { peakRung: 3, minimalCheckIns: 2 }) });
    const e = store.record({ userId: USER, plexId: '100', percent: 30, engaged: true, practice: practice('s1', { peakRung: 1, minimalCheckIns: 1 }) });
    expect(e.practice.sittings.s1).toMatchObject({ peakRung: 3, minimalCheckIns: 2 });
  });

  it('the sitting row carries peakRung and minimalCheckIns', () => {
    const { store, sittingLog } = make();
    store.record({ userId: USER, plexId: '100', percent: 20, engaged: true, practice: practice('s1', { peakRung: 3, minimalCheckIns: 2 }) });
    expect(sittingLog.upsert).toHaveBeenCalledWith(USER, expect.objectContaining({ peakRung: 3, minimalCheckIns: 2 }));
  });

  it('a new sitting of the same lesson starts from nothing — nothing carries over (owner, 2026-11-13)', () => {
    const { store } = make();
    store.record({ userId: USER, plexId: '100', percent: 20, engaged: true, practice: practice('s1', { peakRung: 4, minimalCheckIns: 5 }) });
    const e = store.record({ userId: USER, plexId: '100', percent: 10, engaged: true, practice: practice('s2', { peakRung: 0, minimalCheckIns: 0 }) });
    expect(e.practice.sittings.s2).toMatchObject({ peakRung: 0, minimalCheckIns: 0 });
    expect(e).not.toHaveProperty('presenceLadder');
    const [item] = store.enrich([{ plex: '100' }], USER);
    expect(item).not.toHaveProperty('userPresence');
  });

  it('piano.presence-ladder.top-rung is logged once, when a sitting first reaches the top rung', () => {
    const { store, logger } = make();
    store.record({ userId: USER, plexId: '100', percent: 20, engaged: true, practice: practice('s1', { peakRung: 3, minimalCheckIns: 2 }) });
    expect(topRungLogs(logger)).toHaveLength(0);
    store.record({ userId: USER, plexId: '100', percent: 30, engaged: true, practice: practice('s1', { peakRung: 4, minimalCheckIns: 3 }) });
    store.record({ userId: USER, plexId: '100', percent: 40, engaged: true, practice: practice('s1', { peakRung: 4, minimalCheckIns: 4 }) });
    expect(topRungLogs(logger)).toEqual([{ userId: USER, key: 'plex:100', sittingId: 's1', minimalCheckIns: 3, preschool: false }]);
  });

  it('a malformed rung is clamped or ignored, never stored as NaN', () => {
    const { store } = make();
    let e = store.record({ userId: USER, plexId: '100', percent: 20, engaged: true, practice: practice('a', { peakRung: 'x', minimalCheckIns: 'y' }) });
    expect(e.practice.sittings.a).toMatchObject({ peakRung: 0, minimalCheckIns: 0 });
    e = store.record({ userId: USER, plexId: '100', percent: 20, engaged: true, practice: practice('b', { peakRung: 9 }) });
    expect(e.practice.sittings.b.peakRung).toBe(4);
    e = store.record({ userId: USER, plexId: '100', percent: 20, engaged: true, practice: practice('c', { peakRung: -1 }) });
    expect(e.practice.sittings.c.peakRung).toBe(0);
  });

  it('a School material store (no lesson index) ignores the ladder fields', () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const store = new YamlUserVideoProgressStore({ configService: configService(), logger, app: 'school', filename: 'material-progress' });
    const e = store.record({ userId: USER, plexId: '100', percent: 20, engaged: true, practice: practice('s1', { peakRung: 4 }) });
    expect(e.practice).toBeUndefined();
    expect(topRungLogs(logger)).toHaveLength(0);
  });
});
