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
  fs.mkdirSync(attemptsDir('felix'), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('attempt shard integrity (readiness Blocker 1)', () => {
  it('a CORRUPT day file refuses the append — never clobbered to a one-row list', () => {
    const ds = new YamlSchoolDatastore({ configService: cs(), logger });
    const file = path.join(attemptsDir('felix'), '2026-08-06.yml');
    fs.writeFileSync(file, '{ this is: [not, yaml');
    expect(() => ds.appendAttempt('felix', {
      id: 'att_1', at: '2026-08-06T10:00:00.000Z', bankId: 'b', itemId: 'q', correct: true,
    }))
      .toThrow(/corrupt/i);
    expect(fs.readFileSync(file, 'utf8')).toContain('this is'); // original bytes untouched
  });

  it('a corrupt read is LOUD (logged) and returns [], a missing file is quiet []', () => {
    const ds = new YamlSchoolDatastore({ configService: cs(), logger });
    const file = path.join(attemptsDir('felix'), '2026-08-06.yml');
    fs.writeFileSync(file, '{ nope: [');
    expect(ds.readAttemptDay('felix', '2026-08-06')).toEqual([]);
    expect(warns.some(([evt]) => evt === 'school.attempts.shard-corrupt')).toBe(true);
    warns = [];
    expect(ds.readAttemptDay('felix', '2026-08-05')).toEqual([]); // missing: no log
    expect(warns).toEqual([]);
  });

  it('a healthy append survives and rewrites ATOMICALLY (no partial file on interrupt is testable as: tmp is renamed, not written in place)', () => {
    const ds = new YamlSchoolDatastore({ configService: cs(), logger });
    ds.appendAttempt('felix', {
      id: 'att_1', at: '2026-08-06T10:00:00.000Z', bankId: 'b', itemId: 'q', correct: true,
    });
    ds.appendAttempt('felix', {
      id: 'att_2', at: '2026-08-06T10:01:00.000Z', bankId: 'b', itemId: 'q2', correct: false,
    });
    expect(ds.readAttemptDay('felix', '2026-08-06')).toHaveLength(2);
    // No leftover staging file from the atomic rename.
    expect(fs.readdirSync(attemptsDir('felix')).filter((f) => f.includes('.tmp-'))).toEqual([]);
  });
});
