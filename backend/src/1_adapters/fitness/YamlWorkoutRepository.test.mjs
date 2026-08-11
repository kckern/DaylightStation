// backend/src/1_adapters/fitness/YamlWorkoutRepository.test.mjs
//
// Exercises the repository against a REAL temp directory — the thing under test is where
// bytes land and in what shape, and a fake filesystem would assert the fake instead.
// FileIO is partially mocked: the real implementations still run, wrapped in spies, so
// "which write function did it call" is observable without giving up real files.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

vi.mock('#system/utils/FileIO.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    saveYamlToPathAtomic: vi.fn(actual.saveYamlToPathAtomic),
    saveYamlToPath: vi.fn(actual.saveYamlToPath),
    writeFile: vi.fn(actual.writeFile),
  };
});

import * as FileIO from '#system/utils/FileIO.mjs';
import { YamlWorkoutRepository, isValidWorkoutId } from './YamlWorkoutRepository.mjs';

let dataDir;
let clockValue;

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function makeConfigService(root) {
  return {
    getDataDir: () => root,
    getHouseholdPath: (relativePath, householdId = null) => path.join(
      root,
      householdId ? `household-${householdId}` : 'household',
      relativePath,
    ),
  };
}

function makeRepo() {
  return new YamlWorkoutRepository({
    configService: makeConfigService(dataDir),
    logger: silentLogger,
    clock: () => new Date(clockValue),
  });
}

/** Where a workout file is expected to land, spelled out rather than asked of the code. */
function expectedFile(id, household = 'household') {
  return path.join(dataDir, household, 'apps', 'fitness', 'workouts', `${id}.yml`);
}

const SAMPLE = {
  id: 'leg-day-a1b2',
  title: 'Leg Day',
  author: 'kckern',
  groups: [
    { rounds: 3, exercises: [{ slug: 'back-squat', sets: 2, reps: 8, load: '135 lb', restSeconds: 60 }] },
  ],
};

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workout-repo-'));
  clockValue = '2026-08-11T10:00:00.000Z';
  vi.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('YamlWorkoutRepository — storage location and shape', () => {
  it('writes one household-scoped file per workout at the documented path', () => {
    const repo = makeRepo();
    const result = repo.save(SAMPLE);

    expect(result).toMatchObject({ id: 'leg-day-a1b2', created: true });
    const file = expectedFile('leg-day-a1b2');
    expect(fs.existsSync(file)).toBe(true);

    const stored = yaml.load(fs.readFileSync(file, 'utf8'));
    expect(stored.id).toBe('leg-day-a1b2');
    expect(stored.title).toBe('Leg Day');
    expect(stored.author).toBe('kckern');
    expect(stored.createdAt).toBe('2026-08-11T10:00:00.000Z');
    expect(stored.updatedAt).toBe('2026-08-11T10:00:00.000Z');
    expect(stored.groups).toEqual([
      {
        rounds: 3,
        exercises: [
          { slug: 'back-squat', sets: 2, reps: 8, seconds: null, load: '135 lb', restSeconds: 60 },
        ],
      },
    ]);
  });

  it('files a second household beside the first, not on top of it', () => {
    const repo = makeRepo();
    repo.save(SAMPLE);
    repo.save({ ...SAMPLE, title: 'Other House Leg Day' }, 'two');

    expect(fs.existsSync(expectedFile('leg-day-a1b2'))).toBe(true);
    expect(fs.existsSync(expectedFile('leg-day-a1b2', 'household-two'))).toBe(true);
    expect(repo.get('leg-day-a1b2').title).toBe('Leg Day');
    expect(repo.get('leg-day-a1b2', 'two').title).toBe('Other House Leg Day');
  });

  it('writes ATOMICALLY — a Run player may be reading the file mid-save', () => {
    const repo = makeRepo();
    repo.save(SAMPLE);

    expect(FileIO.saveYamlToPathAtomic).toHaveBeenCalledTimes(1);
    expect(FileIO.saveYamlToPathAtomic).toHaveBeenCalledWith(
      expectedFile('leg-day-a1b2'),
      expect.objectContaining({ id: 'leg-day-a1b2' }),
    );
    // A non-atomic write would leave the same file behind, so the only way to see the
    // difference is that the tearing-prone entry points were never used.
    expect(FileIO.saveYamlToPath).not.toHaveBeenCalled();
    expect(FileIO.writeFile).not.toHaveBeenCalled();
    // ...and nothing staged is left lying around next to the finished file.
    const dir = path.dirname(expectedFile('leg-day-a1b2'));
    expect(fs.readdirSync(dir)).toEqual(['leg-day-a1b2.yml']);
  });
});

describe('YamlWorkoutRepository — reads', () => {
  it('returns null for an unknown id and an empty list before anything is saved', () => {
    const repo = makeRepo();
    expect(repo.list()).toEqual([]);
    expect(repo.get('never-saved')).toBeNull();
    expect(repo.exists('never-saved')).toBe(false);
    // The directory must not have been conjured by a read.
    expect(fs.existsSync(path.join(dataDir, 'household'))).toBe(false);
  });

  it('normalizes a hand-edited file on read rather than trusting it', () => {
    const repo = makeRepo();
    const file = expectedFile('hand-edited');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, yaml.dump({
      id: 'hand-edited',
      title: '  Hand Edited  ',
      groups: [{ rounds: '2', exercises: [{ slug: 'plank', sets: '3', reps: 5, seconds: 30 }] }],
    }), 'utf8');

    const workout = repo.get('hand-edited');
    expect(workout.title).toBe('Hand Edited');
    expect(workout.groups[0].rounds).toBe(2);
    expect(workout.groups[0].exercises[0].sets).toBe(3);
    expect(workout.groups[0].exercises[0].reps).toBe(5);
    // reps wins over seconds — the domain's rule, still applied to a file it never wrote.
    expect(workout.groups[0].exercises[0].seconds).toBeNull();
  });

  it('skips an unparseable file instead of failing the whole list', () => {
    const repo = makeRepo();
    repo.save(SAMPLE);
    const junk = expectedFile('corrupt');
    fs.writeFileSync(junk, 'this: [is: not: valid: yaml', 'utf8');

    expect(repo.list().map((w) => w.id)).toEqual(['leg-day-a1b2']);
  });
});

describe('YamlWorkoutRepository — list summaries', () => {
  it('returns summaries only — never the full body', () => {
    const repo = makeRepo();
    repo.save({
      id: 'summary-check',
      title: 'Summary Check',
      author: 'kckern',
      groups: [
        { rounds: 3, exercises: [{ slug: 'back-squat', sets: 2, reps: 8 }] },
        { rounds: 1, exercises: [{ slug: 'plank', seconds: 30 }, { slug: 'row', reps: 10 }] },
      ],
    });

    const [summary] = repo.list();
    expect(Object.keys(summary).sort()).toEqual([
      'author', 'createdAt', 'exerciseCount', 'groupCount', 'id', 'setCount', 'title', 'updatedAt',
    ]);
    expect(summary).not.toHaveProperty('groups');
    expect(summary.title).toBe('Summary Check');
    expect(summary.author).toBe('kckern');
    expect(summary.groupCount).toBe(2);
    expect(summary.exerciseCount).toBe(3);
    // 3 rounds x 2 sets of the squat, plus one pass of the two-exercise group.
    expect(summary.setCount).toBe(8);
  });

  it('orders most-recently-updated first, whatever order the files were written in', () => {
    const repo = makeRepo();
    // Written oldest-title-last on purpose: alphabetical, insertion and mtime orderings
    // would each produce a different answer than the one asserted below.
    clockValue = '2026-08-01T00:00:00.000Z';
    repo.save({ id: 'aaa-oldest', title: 'A', groups: [] });
    clockValue = '2026-08-09T00:00:00.000Z';
    repo.save({ id: 'zzz-newest', title: 'Z', groups: [] });
    clockValue = '2026-08-05T00:00:00.000Z';
    repo.save({ id: 'mmm-middle', title: 'M', groups: [] });

    expect(repo.list().map((w) => w.id)).toEqual(['zzz-newest', 'mmm-middle', 'aaa-oldest']);
  });
});

describe('YamlWorkoutRepository — updates and deletes', () => {
  it('preserves createdAt across an update and advances updatedAt', () => {
    const repo = makeRepo();
    const first = repo.save(SAMPLE);
    expect(first.created).toBe(true);

    clockValue = '2026-08-12T18:30:00.000Z';
    const second = repo.save({ ...SAMPLE, title: 'Leg Day (heavier)' });

    expect(second.created).toBe(false);
    expect(second.createdAt).toBe('2026-08-11T10:00:00.000Z');
    expect(second.updatedAt).toBe('2026-08-12T18:30:00.000Z');
    expect(repo.get('leg-day-a1b2').title).toBe('Leg Day (heavier)');
    expect(repo.list()).toHaveLength(1);
  });

  it('deletes once and reports the second attempt as unknown', () => {
    const repo = makeRepo();
    repo.save(SAMPLE);
    expect(repo.delete('leg-day-a1b2')).toBe(true);
    expect(fs.existsSync(expectedFile('leg-day-a1b2'))).toBe(false);
    expect(repo.delete('leg-day-a1b2')).toBe(false);
    expect(repo.get('leg-day-a1b2')).toBeNull();
  });
});

describe('YamlWorkoutRepository — id containment', () => {
  it.each([
    '../../../etc/passwd',
    'nested/id',
    '-leading-dash',
    '',
    'has space',
  ])('refuses %j as a workout id', (badId) => {
    expect(isValidWorkoutId(badId)).toBe(false);
    const repo = makeRepo();
    expect(() => repo.save({ ...SAMPLE, id: badId })).toThrow(/invalid workout id/);
    expect(repo.get(badId)).toBeNull();
    expect(repo.delete(badId)).toBe(false);
  });

  it('never writes outside the workouts directory', () => {
    const repo = makeRepo();
    expect(() => repo.save({ ...SAMPLE, id: '../escape' })).toThrow();
    expect(FileIO.saveYamlToPathAtomic).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dataDir, 'household', 'apps', 'fitness', 'escape.yml'))).toBe(false);
  });
});
