import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import { YamlSchoolDatastore } from '#adapters/persistence/yaml/YamlSchoolDatastore.mjs';

let root;
let warns;
const logger = { warn: (...a) => warns.push(a), error: (...a) => warns.push(a) };
const cs = () => ({
  getDataDir: () => root,
  getUserDir: (id) => path.join(root, 'users', id),
  getUserProfile: (id) => ({ id }),
  getHouseholdPath: (rel) => path.join(root, 'household', rel),
});
// Real shard layout (verified against YamlSchoolDatastore#attemptsDir /
// appendAttempt): <userDir>/apps/school/attempts/{YYYY-MM-DD}.yml — NOT
// "attempts-{day}.yml" as a first draft of this fixture assumed.
const attemptsDir = (u) => path.join(root, 'users', u, 'apps', 'school', 'attempts');

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'shard-'));
  warns = [];
  fs.mkdirSync(attemptsDir('learner4'), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('attempt shard integrity (readiness Blocker 1)', () => {
  it('a CORRUPT day file refuses the append — never clobbered to a one-row list', () => {
    const ds = new YamlSchoolDatastore({ configService: cs(), logger });
    const file = path.join(attemptsDir('learner4'), '2026-08-06.yml');
    fs.writeFileSync(file, '{ this is: [not, yaml');
    expect(() => ds.appendAttempt('learner4', {
      id: 'att_1', at: '2026-08-06T10:00:00.000Z', bankId: 'b', itemId: 'q', correct: true,
    }))
      .toThrow(/corrupt/i);
    expect(fs.readFileSync(file, 'utf8')).toContain('this is'); // original bytes untouched
  });

  it('a corrupt read is LOUD (logged) and returns [], a missing file is quiet []', () => {
    const ds = new YamlSchoolDatastore({ configService: cs(), logger });
    const file = path.join(attemptsDir('learner4'), '2026-08-06.yml');
    fs.writeFileSync(file, '{ nope: [');
    expect(ds.readAttemptDay('learner4', '2026-08-06')).toEqual([]);
    expect(warns.some(([evt]) => evt === 'school.attempts.shard-corrupt')).toBe(true);
    warns = [];
    expect(ds.readAttemptDay('learner4', '2026-08-05')).toEqual([]); // missing: no log
    expect(warns).toEqual([]);
  });

  it('a healthy append survives and rewrites ATOMICALLY (no partial file on interrupt is testable as: tmp is renamed, not written in place)', () => {
    const ds = new YamlSchoolDatastore({ configService: cs(), logger });
    ds.appendAttempt('learner4', {
      id: 'att_1', at: '2026-08-06T10:00:00.000Z', bankId: 'b', itemId: 'q', correct: true,
    });
    ds.appendAttempt('learner4', {
      id: 'att_2', at: '2026-08-06T10:01:00.000Z', bankId: 'b', itemId: 'q2', correct: false,
    });
    expect(ds.readAttemptDay('learner4', '2026-08-06')).toHaveLength(2);
    // No leftover staging file from the atomic rename.
    expect(fs.readdirSync(attemptsDir('learner4')).filter((f) => f.includes('.tmp-'))).toEqual([]);
  });

  it('moveAttempts refuses a CORRUPT destination shard — never clobbers it down to just the moved rows', () => {
    const ds = new YamlSchoolDatastore({ configService: cs(), logger });
    fs.mkdirSync(attemptsDir('penny'), { recursive: true });
    const fromFile = path.join(attemptsDir('learner4'), '2026-08-06.yml');
    fs.writeFileSync(fromFile, [
      '- id: att_1',
      '  at: \'2026-08-06T10:00:00.000Z\'',
      '  sessionId: sess_1',
      '  bankId: b',
      '  itemId: q',
      '  correct: true',
      '',
    ].join('\n'));
    const toFile = path.join(attemptsDir('penny'), '2026-08-06.yml');
    fs.writeFileSync(toFile, '{ nope: [');
    expect(() => ds.moveAttempts({
      fromUserId: 'learner4', toUserId: 'penny', day: '2026-08-06', assessmentId: 'sess_1',
    })).toThrow(/corrupt/i);
    // Destination bytes untouched — not overwritten with just the moved row.
    expect(fs.readFileSync(toFile, 'utf8')).toContain('nope');
    // Source untouched too: refusing the destination means nothing moved.
    expect(fs.readFileSync(fromFile, 'utf8')).toContain('att_1');
  });

  it('readAttemptsInRange logs a corrupt day and still returns the healthy days around it', () => {
    const ds = new YamlSchoolDatastore({ configService: cs(), logger });
    ds.appendAttempt('learner4', {
      id: 'att_1', at: '2026-08-05T10:00:00.000Z', bankId: 'b', itemId: 'q', correct: true,
    });
    fs.writeFileSync(path.join(attemptsDir('learner4'), '2026-08-06.yml'), '{ nope: [');
    ds.appendAttempt('learner4', {
      id: 'att_3', at: '2026-08-07T10:00:00.000Z', bankId: 'b', itemId: 'q', correct: true,
    });
    const rows = ds.readAttemptsInRange('learner4', '2026-08-05', '2026-08-07');
    expect(rows.map((a) => a.id)).toEqual(['att_1', 'att_3']);
    expect(warns.some(([evt]) => evt === 'school.attempts.shard-corrupt')).toBe(true);
  });
});
