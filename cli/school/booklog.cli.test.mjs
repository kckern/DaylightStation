import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigration } from './booklog.cli.mjs';

let root;
const booksDir = () => path.join(root, 'household', 'school', 'records', 'books');
const fileFor = (learnerId) => path.join(booksDir(), `${learnerId}.yml`);
const NOW = '2026-09-06T20:00:00.000Z';

const write = (learnerId, doc) => {
  fs.mkdirSync(booksDir(), { recursive: true });
  fs.writeFileSync(fileFor(learnerId), typeof doc === 'string' ? doc : yaml.dump(doc));
};

/** The real v1 shapes: a book in progress, a set-aside one, a backdated finish. */
const v1 = () => ({
  items: [
    {
      itemId: 'learner_a:9780064400558:e1',
      bookId: '9780064400558', progressMode: 'page', pageCount: 192,
      openedAt: '2026-09-05T19:13:46.320Z',
      events: [
        { kind: 'started', at: '2026-09-05T19:13:46.320Z', entryId: 'e1' },
        { kind: 'progress', at: '2026-09-05T19:13:46.320Z', page: 24, entryId: 'p1' },
        { kind: 'progress', at: '2026-09-06T15:02:47.747Z', page: 120, entryId: 'p2' },
        { kind: 'set-aside', at: '2026-09-06T15:03:26.078Z', entryId: 's1' },
      ],
    },
    {
      itemId: 'learner_a:9780062910806:e2',
      bookId: '9780062910806', progressMode: 'page', pageCount: 112,
      openedAt: '2026-09-04T12:00:00.000Z',
      events: [
        { kind: 'started', at: '2026-09-04T12:00:00.000Z', entryId: 'e2' },
        { kind: 'finished', at: '2026-09-04T12:00:00.000Z', entryId: 'f1' },
      ],
    },
  ],
});

const migrate = (over = {}) => runMigration({
  dataDir: root, learnerId: 'learner_a', now: NOW, timezone: 'UTC', ...over,
});

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'booklog-migrate-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('school booklog migrate', () => {
  it('DRY RUN by default: verifies everything and writes nothing', () => {
    write('learner_a', v1());
    const before = fs.readFileSync(fileFor('learner_a'), 'utf8');

    const report = migrate();

    expect(report.errors).toEqual([]);
    expect(report.applied).toBe(false);
    expect(report.readings).toHaveLength(2);
    expect(report.readings.every((reading) => reading.verified)).toBe(true);
    // The data tree is shared and synced: a migration is live the moment it
    // runs, so nothing may move without being asked for.
    expect(fs.readFileSync(fileFor('learner_a'), 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(booksDir(), 'learner_a.v1.bak'))).toBe(false);
  });

  it('--apply writes v2 beside a .v1.bak of the original bytes', () => {
    write('learner_a', v1());
    const before = fs.readFileSync(fileFor('learner_a'), 'utf8');

    const report = migrate({ apply: true });

    expect(report.applied).toBe(true);
    expect(fs.readFileSync(path.join(booksDir(), 'learner_a.v1.bak'), 'utf8')).toBe(before);

    const converted = yaml.load(fs.readFileSync(fileFor('learner_a'), 'utf8'));
    expect(converted.schema).toBe('school.book-log/v2');
    expect(converted.readings).toHaveLength(2);
    expect(converted.readings.map((reading) => reading.status)).toEqual(['set-aside', 'finished']);
  });

  it('mints opaque ids that name nothing, and keeps the old one in the conversion revision', () => {
    write('learner_a', v1());
    const report = migrate({ apply: true });
    const [first] = yaml.load(fs.readFileSync(fileFor('learner_a'), 'utf8')).readings;

    expect(first.id).toMatch(/^rdg_/);
    expect(first.id).not.toContain('learner_a');
    expect(first.id).not.toContain('9780064400558');
    expect(first.entries.every((entry) => entry.id.startsWith('ent_'))).toBe(true);

    const [revision] = first.revisions;
    expect(revision).toMatchObject({ by: 'migration', verb: 'convert', toldChild: false, at: NOW });
    // The whole v1 item, not just its id: the state-change events that became
    // fields live nowhere else in the new file.
    expect(revision.before).toMatchObject({ itemId: 'learner_a:9780064400558:e1' });
    expect(revision.before.events).toHaveLength(4);
    expect(report.readings[0].from).toBe('learner_a:9780064400558:e1');
  });

  it('turns state changes into fields and evidence into dated rows', () => {
    write('learner_a', v1());
    migrate({ apply: true });
    const [aside, finished] = yaml.load(fs.readFileSync(fileFor('learner_a'), 'utf8')).readings;

    expect(aside).toMatchObject({
      learnerId: 'learner_a', status: 'set-aside',
      book: { isbn: '9780064400558', pageCount: 192 },
      openedOn: '2026-09-05', finishedOn: null, idempotencyKey: 'e1',
    });
    // `started` and `set-aside` are gone as rows — which is exactly why they
    // were distorting daysRead.
    expect(aside.entries.map((entry) => [entry.on, entry.page])).toEqual([
      ['2026-09-05', 24], ['2026-09-06', 120],
    ]);
    expect(aside.entries[0].idempotencyKey).toBe('p1');

    expect(finished).toMatchObject({ status: 'finished', finishedOn: '2026-09-04' });
    expect(finished.entries.map((entry) => entry.on)).toEqual(['2026-09-04']);
  });

  it('applies the household day rule, so a late-evening read keeps its day', () => {
    write('learner_a', {
      items: [{
        itemId: 'learner_a:b:e1', bookId: 'b', progressMode: 'page', pageCount: 184,
        openedAt: '2026-09-07T02:20:14.112Z',
        events: [
          { kind: 'started', at: '2026-09-07T02:20:14.112Z', entryId: 'e1' },
          { kind: 'progress', at: '2026-09-07T02:20:14.112Z', page: 30, entryId: 'p1' },
        ],
      }],
    });
    // 7:20pm Pacific on the 6th. A UTC slice would file it under the 7th and
    // move real reading into a week the gradebook has already reported on.
    const report = migrate({ apply: true, timezone: 'America/Los_Angeles' });
    expect(report.errors).toEqual([]);
    const [reading] = yaml.load(fs.readFileSync(fileFor('learner_a'), 'utf8')).readings;
    expect(reading.entries[0].on).toBe('2026-09-06');
    expect(reading.openedOn).toBe('2026-09-06');
  });

  it('ABORTS the learner and leaves v1 in place when a projection disagrees', () => {
    write('learner_a', v1());
    const before = fs.readFileSync(fileFor('learner_a'), 'utf8');

    // A conversion that drops a page: the kind of mistake the verification
    // exists to catch, injected here so the abort path is proven, not assumed.
    const report = migrate({
      apply: true,
      convert: (reading) => ({ ...reading, entries: reading.entries.slice(0, 1) }),
    });

    expect(report.applied).toBe(false);
    expect(report.errors.join(' ')).toMatch(/page/);
    expect(report.errors.join(' ')).toMatch(/learner_a:9780064400558:e1/);
    expect(fs.readFileSync(fileFor('learner_a'), 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(booksDir(), 'learner_a.v1.bak'))).toBe(false);
  });

  it('catches a disagreement no projection would show, in the obligation measure', () => {
    write('learner_a', v1());
    const report = migrate({
      apply: true,
      // The furthest page survives, so status/page/percent/daysRead all match;
      // only a windowed pages measurement can see the day that moved.
      convert: (reading) => ({
        ...reading,
        entries: reading.entries.map((entry, index) => (index === 0 ? { ...entry, on: '2026-08-01' } : entry)),
      }),
    });
    expect(report.applied).toBe(false);
    expect(report.errors.join(' ')).toMatch(/pages|checkins/);
  });

  it('refuses a file that is already v2, rather than converting it twice', () => {
    write('learner_a', { schema: 'school.book-log/v2', readings: [] });
    const report = migrate({ apply: true });
    expect(report.status).toBe('already-v2');
    expect(report.applied).toBe(false);
  });

  it('reports a missing shelf and a damaged one without touching either', () => {
    expect(migrate().status).toBe('missing');

    write('learner_a', 'this: [is: not: valid');
    const damaged = migrate({ apply: true });
    expect(damaged.status).toBe('unreadable');
    expect(damaged.applied).toBe(false);
    expect(fs.readFileSync(fileFor('learner_a'), 'utf8')).toBe('this: [is: not: valid');
  });

  it('refuses a learner id that could escape the books directory', () => {
    expect(() => migrate({ learnerId: '../escape' })).toThrow(/learnerId/);
  });

  it('refuses to overwrite an existing backup', () => {
    write('learner_a', v1());
    fs.writeFileSync(path.join(booksDir(), 'learner_a.v1.bak'), 'an earlier run');
    const report = migrate({ apply: true });
    expect(report.applied).toBe(false);
    expect(report.errors.join(' ')).toMatch(/v1\.bak/);
  });
});
