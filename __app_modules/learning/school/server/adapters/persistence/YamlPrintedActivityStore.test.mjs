import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { PageAlreadyOpenError, YamlPrintedActivityStore } from './YamlPrintedActivityStore.mjs';
import { IPrintedActivityStore } from '../../application/ports/IPrintedActivityStore.mjs';

const silentLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

let root;
const configService = { getHouseholdPath: (suffix) => path.join(root, suffix) };
const FIXED = new Date('2026-11-14T17:00:00.000Z');
const store = (over = {}) => new YamlPrintedActivityStore({
  configService, logger: silentLogger(), clock: () => FIXED, ...over,
});

const dir = () => path.join(root, 'school/records/printed-activities');
const fileFor = (learnerId) => path.join(dir(), `${learnerId}.yml`);
const write = (learnerId, text) => {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(fileFor(learnerId), text);
};
const bytes = (learnerId) => fs.readFileSync(fileFor(learnerId), 'utf8');
const read = (learnerId) => yaml.load(bytes(learnerId));

const issuance = (over = {}) => ({
  issuanceId: 'pa_k3j9x2qd', learnerId: 'learner_a', programId: 'printed-activity', corpusId: 'beeloo:maze',
  platform: 'beeloo', externalId: 'glD5B71Bj', title: 'North End Labyrinth', kind: 'maze', level: 3,
  issuedAt: '2026-11-14T16:02:11.000Z', issuedStudyDay: '2026-11-14', ...over,
});
const done = { at: '2026-11-14T18:00:00.000Z', studyDay: '2026-11-14', device: 'kitchen-scanner' };

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'printed-activity-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('YamlPrintedActivityStore', () => {
  it('requires a configService and implements the port', () => {
    expect(() => new YamlPrintedActivityStore({})).toThrow(/configService/);
    expect(store()).toBeInstanceOf(IPrintedActivityStore);
  });

  it('round-trips an appended issuance, open', async () => {
    const subject = store();
    await subject.append(issuance());
    const rows = await subject.listForLearner('learner_a');
    expect(rows).toEqual([{
      ...issuance(), completedAt: null, completedStudyDay: null, completedVia: null,
    }]);
    expect(read('learner_a').issuances).toHaveLength(1);
  });

  it('finds the open issuance for a page across learners, and none after completion', async () => {
    const subject = store();
    await subject.append(issuance());
    await subject.append(issuance({ issuanceId: 'pa_b', learnerId: 'learner_b', externalId: 'XyZ' }));
    expect((await subject.findOpen({ platform: 'beeloo', externalId: 'XyZ' })).learnerId).toBe('learner_b');
    expect((await subject.findOpen({ platform: 'beeloo', externalId: 'glD5B71Bj' })).learnerId).toBe('learner_a');
    expect(await subject.findOpen({ platform: 'other', externalId: 'XyZ' })).toBeNull();

    await subject.complete('learner_b', 'pa_b', done);
    expect(await subject.findOpen({ platform: 'beeloo', externalId: 'XyZ' })).toBeNull();
  });

  it('completes once: persisted, then already with no write, unknown is missing', async () => {
    const subject = store();
    await subject.append(issuance());

    const first = await subject.complete('learner_a', 'pa_k3j9x2qd', done);
    expect(first.status).toBe('completed');
    expect(first.issuance).toMatchObject({
      completedAt: done.at, completedStudyDay: '2026-11-14', completedVia: 'kitchen-scanner',
    });
    expect(read('learner_a').issuances[0]).toMatchObject({
      completedAt: done.at, completedStudyDay: '2026-11-14', completedVia: 'kitchen-scanner',
    });

    const before = bytes('learner_a');
    const second = await subject.complete('learner_a', 'pa_k3j9x2qd', {
      at: '2026-11-15T09:00:00.000Z', studyDay: '2026-11-15', device: 'other',
    });
    expect(second.status).toBe('already');
    expect(second.issuance.completedStudyDay).toBe('2026-11-14');
    expect(bytes('learner_a')).toBe(before);

    expect(await subject.complete('learner_a', 'pa_nope', done)).toEqual({ status: 'missing', issuance: null });
  });

  it('refuses a completion with no instant or study day', async () => {
    const subject = store();
    await subject.append(issuance());
    await expect(subject.complete('learner_a', 'pa_k3j9x2qd', { studyDay: '2026-11-14' })).rejects.toThrow(/at/);
    await expect(subject.complete('learner_a', 'pa_k3j9x2qd', { at: done.at })).rejects.toThrow(/studyDay/);
  });

  it('lists completions for one corpus on one study day', async () => {
    const subject = store();
    await subject.append(issuance({ issuanceId: 'm1' }));
    await subject.append(issuance({ issuanceId: 'm2', externalId: 'p2' }));
    await subject.append(issuance({ issuanceId: 's1', corpusId: 'beeloo:sudoku', externalId: 'p3' }));
    await subject.append(issuance({ issuanceId: 'm3', externalId: 'p4' }));
    await subject.complete('learner_a', 'm1', done);
    await subject.complete('learner_a', 'm2', { ...done, studyDay: '2026-11-13' });
    await subject.complete('learner_a', 's1', done);

    const rows = await subject.listCompletedForDay('learner_a', 'beeloo:maze', '2026-11-14');
    expect(rows.map((r) => r.issuanceId)).toEqual(['m1']);
  });

  it('lists open issuances from every learner, and only open ones', async () => {
    const subject = store();
    await subject.append(issuance({ issuanceId: 'a1' }));
    await subject.append(issuance({ issuanceId: 'a2', externalId: 'p2' }));
    await subject.append(issuance({ issuanceId: 'b1', learnerId: 'learner_b', externalId: 'p3' }));
    await subject.complete('learner_a', 'a1', done);

    const open = await subject.listOpenAll();
    expect(open.map((r) => r.issuanceId).sort()).toEqual(['a2', 'b1']);
  });

  it('findAny returns the most recent issuance of a page, completed or not', async () => {
    const subject = store();
    await subject.append(issuance());
    await subject.complete('learner_a', 'pa_k3j9x2qd', done);
    const found = await subject.findAny({ platform: 'beeloo', externalId: 'glD5B71Bj' });
    expect(found).toMatchObject({ issuanceId: 'pa_k3j9x2qd', completedAt: done.at });

    await subject.append(issuance({
      issuanceId: 'pa_later', learnerId: 'learner_b', issuedAt: '2026-11-20T10:00:00.000Z',
    }));
    expect((await subject.findAny({ platform: 'beeloo', externalId: 'glD5B71Bj' })).issuanceId).toBe('pa_later');
    expect(await subject.findAny({ platform: 'beeloo', externalId: 'never' })).toBeNull();
  });

  it('a corrupt file reads as empty with an error log, and a write side-files its bytes first', async () => {
    const CORRUPT = 'issuances: [ {issuanceId: pa_old, ::: not yaml\n';
    write('learner_a', CORRUPT);
    const logger = silentLogger();
    const subject = store({ logger });

    expect(await subject.listForLearner('learner_a')).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith('school.printed-activity.store-corrupt', expect.any(Object));
    expect(bytes('learner_a')).toBe(CORRUPT); // reads have no side effects

    await subject.append(issuance());
    const sideFile = `${fileFor('learner_a')}.corrupt-2026-11-14T17-00-00-000Z`;
    expect(fs.readFileSync(sideFile, 'utf8')).toBe(CORRUPT);
    expect(logger.error).toHaveBeenCalledWith('school.printed-activity.corrupt-side-filed', expect.any(Object));
    expect(read('learner_a').issuances.map((r) => r.issuanceId)).toEqual(['pa_k3j9x2qd']);
    // The side-file is not mistaken for a learner file.
    expect((await subject.listOpenAll()).map((r) => r.issuanceId)).toEqual(['pa_k3j9x2qd']);
  });

  it('refuses an unsafe learner id on write and answers [] on read', async () => {
    const subject = store();
    await expect(subject.append(issuance({ learnerId: '../x' }))).rejects.toThrow(/unsafe learnerId/);
    expect(await subject.listForLearner('../x')).toEqual([]);
    await expect(subject.complete('../x', 'pa_k3j9x2qd', done)).rejects.toThrow(/unsafe learnerId/);
  });

  it('refuses a missing key field and a duplicate issuanceId', async () => {
    const subject = store();
    await expect(subject.append(issuance({ externalId: '' }))).rejects.toThrow(/externalId/);
    await subject.append(issuance());
    await expect(subject.append(issuance({ externalId: 'other' }))).rejects.toThrow(/already on record/);
    expect(read('learner_a').issuances).toHaveLength(1);
  });

  it('carries a non-issuance entry through a complete() rewrite', async () => {
    write('learner_a', yaml.dump({ issuances: [
      'North End Labyrinth — pasted by hand',
      { ...issuance(), completedAt: null, completedStudyDay: null, completedVia: null },
    ] }));
    const subject = store();
    expect(await subject.listForLearner('learner_a')).toHaveLength(1);

    expect((await subject.complete('learner_a', 'pa_k3j9x2qd', done)).status).toBe('completed');
    const after = read('learner_a').issuances;
    expect(after[0]).toBe('North End Labyrinth — pasted by hand');
    expect(after[1].completedAt).toBe(done.at);
  });

  describe('one open issuance per page, across learners', () => {
    it('refuses a second learner appending a page that is open', async () => {
      const subject = store();
      await subject.append(issuance());
      const err = await subject.append(issuance({ issuanceId: 'pa_b', learnerId: 'learner_b' })).catch((e) => e);
      expect(err).toBeInstanceOf(PageAlreadyOpenError);
      expect(err.code).toBe('PAGE_ALREADY_OPEN');
      expect(fs.existsSync(fileFor('learner_b'))).toBe(false);
    });

    it('allows the page again once the open issuance is completed', async () => {
      const subject = store();
      await subject.append(issuance());
      await subject.complete('learner_a', 'pa_k3j9x2qd', done);
      await expect(subject.append(issuance({ issuanceId: 'pa_b', learnerId: 'learner_b' }))).resolves.toMatchObject({ learnerId: 'learner_b' });
    });

    it('lets exactly one of two concurrent appends of the same page through', async () => {
      const subject = store();
      const results = await Promise.allSettled([
        subject.append(issuance()),
        subject.append(issuance({ issuanceId: 'pa_b', learnerId: 'learner_b' })),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected').reason).toBeInstanceOf(PageAlreadyOpenError);
    });
  });

  it('cross-learner lookups survive a corrupt learner file and warn that they are partial', async () => {
    const logger = silentLogger();
    const subject = store({ logger });
    await subject.append(issuance({ issuanceId: 'pa_b', learnerId: 'learner_b' }));
    write('learner_a', 'issuances: [ {::: not yaml\n');

    expect((await subject.findOpen({ platform: 'beeloo', externalId: 'glD5B71Bj' })).learnerId).toBe('learner_b');
    expect((await subject.listOpenAll()).map((r) => r.learnerId)).toEqual(['learner_b']);
    expect((await subject.findAny({ platform: 'beeloo', externalId: 'glD5B71Bj' })).learnerId).toBe('learner_b');
    expect(logger.warn).toHaveBeenCalledWith('school.printed-activity.lookup-partial',
      expect.objectContaining({ learnerIds: ['learner_a'] }));
  });

  it('complete() on a corrupt file writes nothing and side-files nothing', async () => {
    write('learner_a', 'issuances: [ {::: not yaml\n');
    const subject = store();
    expect(await subject.complete('learner_a', 'pa_k3j9x2qd', done)).toEqual({ status: 'missing', issuance: null });
    expect(await subject.complete('learner_a', 'pa_k3j9x2qd', done)).toEqual({ status: 'missing', issuance: null });
    expect(fs.readdirSync(dir())).toEqual(['learner_a.yml']);
  });

  it('findAny compares issue instants as times and breaks ties by file position', async () => {
    write('learner_a', yaml.dump({ issuances: [
      { ...issuance({ issuanceId: 'offset', issuedAt: '2026-11-14T10:00:00-07:00' }), completedAt: 'x' },
      { ...issuance({ issuanceId: 'utc', issuedAt: '2026-11-14T16:00:00.000Z' }), completedAt: 'x' },
      { ...issuance({ issuanceId: 'tie', issuedAt: '2026-11-14T17:00:00.000Z' }), completedAt: 'x' },
      { ...issuance({ issuanceId: 'garbage', issuedAt: 'not a date' }), completedAt: 'x' },
    ] }));
    // 10:00-07:00 is 17:00Z, so it ties 'tie'; the later row in the file wins, and garbage never does.
    expect((await store().findAny({ platform: 'beeloo', externalId: 'glD5B71Bj' })).issuanceId).toBe('tie');
  });

  it('ignores .yaml files, which are not learner files', async () => {
    write('learner_a', '');
    fs.writeFileSync(path.join(dir(), 'learner_c.yaml'), yaml.dump({ issuances: [{ ...issuance({ learnerId: 'learner_c' }), completedAt: null }] }));
    expect(await store().listOpenAll()).toEqual([]);
  });

  it('answers [] and logs when the directory cannot be listed', async () => {
    fs.mkdirSync(path.dirname(dir()), { recursive: true });
    fs.writeFileSync(dir(), 'a file where the directory should be');
    const logger = silentLogger();
    expect(await store({ logger }).listOpenAll()).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith('school.printed-activity.list-failed', expect.any(Object));
  });

  it('an unreadable file makes a write throw, and the write chain survives it', async () => {
    fs.mkdirSync(fileFor('learner_a'), { recursive: true }); // exists, cannot be read as a file
    const subject = store();
    await expect(subject.append(issuance())).rejects.toThrow(/cannot be read/);
    await expect(subject.append(issuance({ issuanceId: 'pa_b', learnerId: 'learner_b' }))).resolves.toMatchObject({ learnerId: 'learner_b' });
    expect(read('learner_b').issuances).toHaveLength(1);
  });
});
