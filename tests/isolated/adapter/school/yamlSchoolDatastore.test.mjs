import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlSchoolDatastore } from '#adapters/persistence/yaml/YamlSchoolDatastore.mjs';

const USER = 'kid1';
let tmp, ds;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'school-ds-'));
  const configService = {
    getDataDir: () => tmp,
    getUserDir: (id) => path.join(tmp, 'users', id),
    getUserProfile: (id) => (id === USER ? { username: id } : null),
  };
  ds = new YamlSchoolDatastore({ configService });
});

const att = (over = {}) => ({ id: 'att_1', at: '2026-07-21T10:00:00.000Z', sessionId: 'ses_1', bankId: 'b', itemId: 'q1', itemType: 'multiple_choice', mode: 'quiz', given: 'x', correct: true, attributedTo: USER, ...over });

describe('attempt log', () => {
  it('appends two attempts on one day and both survive', () => {
    ds.appendAttempt(USER, att({ id: 'att_1' }));
    ds.appendAttempt(USER, att({ id: 'att_2' }));
    const day = ds.readAttemptDay(USER, '2026-07-21');
    expect(day.map((a) => a.id)).toEqual(['att_1', 'att_2']);
  });
  it('shards a second day into a second file and readAll returns date order', () => {
    ds.appendAttempt(USER, att({ id: 'att_2', at: '2026-07-22T09:00:00.000Z' }));
    ds.appendAttempt(USER, att({ id: 'att_1', at: '2026-07-21T09:00:00.000Z' }));
    expect(fs.existsSync(path.join(tmp, 'users', USER, 'apps', 'school', 'attempts', '2026-07-21.yml'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'users', USER, 'apps', 'school', 'attempts', '2026-07-22.yml'))).toBe(true);
    expect(ds.readAllAttempts(USER).map((a) => a.id)).toEqual(['att_1', 'att_2']);
  });
  it('unknown user: append returns null, reads return []', () => {
    expect(ds.appendAttempt('ghost', att())).toBe(null);
    expect(ds.readAllAttempts('ghost')).toEqual([]);
  });
  it('rejects a path-traversal day and does not leak another user\'s attempt file', () => {
    // Plant a "secret" attempt log for a different user, outside kid1's tree.
    const otherDir = path.join(tmp, 'users', 'otherKid', 'apps', 'school', 'attempts');
    fs.mkdirSync(otherDir, { recursive: true });
    fs.writeFileSync(path.join(otherDir, '2026-07-21.yml'), '- id: secret_att\n  attributedTo: otherKid\n');

    const kid1Dir = path.join(tmp, 'users', USER, 'apps', 'school', 'attempts');
    const traversalDay = path.relative(kid1Dir, path.join(otherDir, '2026-07-21'));

    expect(ds.readAttemptDay(USER, traversalDay)).toEqual([]);
  });
  it('rejects a malformed day string (not matching YYYY-MM-DD)', () => {
    ds.appendAttempt(USER, att());
    expect(ds.readAttemptDay(USER, '2026-07-21-extra')).toEqual([]);
    expect(ds.readAttemptDay(USER, 'not-a-day')).toEqual([]);
  });
  it('non-string day (e.g. duplicated query param arriving as an array) returns [] instead of throwing', () => {
    ds.appendAttempt(USER, att());
    expect(() => ds.readAttemptDay(USER, ['2026-07-21', '2026-07-22'])).not.toThrow();
    expect(ds.readAttemptDay(USER, ['2026-07-21', '2026-07-22'])).toEqual([]);
    expect(() => ds.readAttemptDay(USER, null)).not.toThrow();
    expect(ds.readAttemptDay(USER, null)).toEqual([]);
  });
});

describe('readAttemptsInRange', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns only attempts from day files inside [fromDay, toDay], oldest first', () => {
    ds.appendAttempt(USER, att({ id: 'att_old', at: '2025-01-01T09:00:00.000Z' }));
    ds.appendAttempt(USER, att({ id: 'att_2', at: '2026-07-22T09:00:00.000Z' }));
    ds.appendAttempt(USER, att({ id: 'att_1', at: '2026-07-21T09:00:00.000Z' }));
    ds.appendAttempt(USER, att({ id: 'att_future', at: '2026-08-01T09:00:00.000Z' }));

    expect(ds.readAttemptsInRange(USER, '2026-07-21', '2026-07-22').map((a) => a.id))
      .toEqual(['att_1', 'att_2']);
  });

  it('never parses a day file outside the requested range (fake io counts the loads)', () => {
    ds.appendAttempt(USER, att({ id: 'att_old', at: '2025-01-01T09:00:00.000Z' }));
    ds.appendAttempt(USER, att({ id: 'att_in', at: '2026-07-21T09:00:00.000Z' }));
    ds.appendAttempt(USER, att({ id: 'att_future', at: '2026-08-01T09:00:00.000Z' }));

    const reads = vi.spyOn(fs, 'readFileSync');
    const result = ds.readAttemptsInRange(USER, '2026-07-21', '2026-07-21');

    expect(result.map((a) => a.id)).toEqual(['att_in']);
    const readPaths = reads.mock.calls.map(([p]) => String(p));
    expect(readPaths.some((p) => p.includes('2026-07-21'))).toBe(true);
    expect(readPaths.some((p) => p.includes('2025-01-01'))).toBe(false);
    expect(readPaths.some((p) => p.includes('2026-08-01'))).toBe(false);
  });

  it('an empty/out-of-range window returns []', () => {
    ds.appendAttempt(USER, att({ id: 'att_1', at: '2026-07-21T09:00:00.000Z' }));
    expect(ds.readAttemptsInRange(USER, '2026-01-01', '2026-01-31')).toEqual([]);
  });

  it('unknown user or malformed day bounds return [] instead of throwing', () => {
    expect(ds.readAttemptsInRange('ghost', '2026-07-21', '2026-07-22')).toEqual([]);
    ds.appendAttempt(USER, att());
    expect(() => ds.readAttemptsInRange(USER, 'not-a-day', '2026-07-22')).not.toThrow();
    expect(ds.readAttemptsInRange(USER, 'not-a-day', '2026-07-22')).toEqual([]);
  });
});

describe('banks', () => {
  // Banks live inside their work: content/school/<subject>/<work>/quizzes/<rest>.
  // The id keeps subject and work but NOT the `quizzes` segment, so three
  // segments are the minimum a bank id can have.
  const writeBank = (subject, work, rest, body) => {
    const file = path.join(tmp, 'content', 'school', subject, work, 'quizzes', rest);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };
  const BANK = 'title: Caps\nitems:\n  - id: q1\n';

  it('lists ids as <subject>/<work>/<rest> and reads one back', () => {
    writeBank('history', 'us-capitals', 'caps.yml', `id: history/us-capitals/caps\n${BANK}`);
    expect(ds.listBankIds()).toEqual(['history/us-capitals/caps']);
    expect(ds.readBankRaw('history/us-capitals/caps')).toMatchObject({ title: 'Caps' });
  });

  it('empty/missing dir lists nothing; unknown or path-traversal id reads null', () => {
    expect(ds.listBankIds()).toEqual([]);
    expect(ds.readBankRaw('history/us-capitals/nope')).toBe(null);
    expect(ds.readBankRaw('../secrets')).toBe(null);
  });

  it('an id shorter than <subject>/<work>/<rest> resolves to nothing', () => {
    writeBank('history', 'us-capitals', 'caps.yml', `id: x\n${BANK}`);
    expect(ds.readBankRaw('history')).toBe(null);
    expect(ds.readBankRaw('history/us-capitals')).toBe(null);
  });

  it('a first segment that is not one of the nine shelves is not a bank', () => {
    // `civ` was a real folder before the 2026-07-30 restructure; it is not a shelf.
    writeBank('history', 'us-capitals', 'caps.yml', `id: x\n${BANK}`);
    writeBank('civ', 'literature', 'x.yml', `id: x\n${BANK}`);
    expect(ds.readBankRaw('civ/literature/x')).toBe(null);
    expect(ds.listBankIds()).toEqual(['history/us-capitals/caps']);
  });

  it('lists and reads a .yaml bank (not just .yml)', () => {
    writeBank('history', 'us-capitals', 'states.yaml', `id: history/us-capitals/states\ntitle: States\nitems:\n  - id: q1\n`);
    expect(ds.listBankIds()).toEqual(['history/us-capitals/states']);
    expect(ds.readBankRaw('history/us-capitals/states')).toMatchObject({ title: 'States' });
  });

  it('excludes AppleDouble hidden sidecar files from listings', () => {
    writeBank('history', 'us-capitals', 'caps.yml', `id: x\n${BANK}`);
    writeBank('history', 'us-capitals', '._caps.yml', 'garbage-not-yaml-safe-content');
    expect(ds.listBankIds()).toEqual(['history/us-capitals/caps']);
  });

  // The audiobook banks are foldered by volume so the tree stays browsable
  // instead of being one flat dump of several hundred files.
  it('lists deeply nested banks by relative path and reads one back', () => {
    writeBank('history', 'i-survived', path.join('01-titanic-1912', '01-two-am-on-deck.yml'),
      'id: history/i-survived/01-titanic-1912/01-two-am-on-deck\ntitle: Two AM on Deck\nitems:\n  - id: q1\n');
    expect(ds.listBankIds()).toEqual(['history/i-survived/01-titanic-1912/01-two-am-on-deck']);
    expect(ds.readBankRaw('history/i-survived/01-titanic-1912/01-two-am-on-deck'))
      .toMatchObject({ title: 'Two AM on Deck' });
  });

  it('mixes works and shelves in one sorted listing', () => {
    writeBank('history', 'us-capitals', 'caps.yml', `id: x\n${BANK}`);
    writeBank('english', 'shakespeare-tales', path.join('hamlet', '01-the-ghost.yml'), `id: x\n${BANK}`);
    expect(ds.listBankIds()).toEqual([
      'english/shakespeare-tales/hamlet/01-the-ghost',
      'history/us-capitals/caps',
    ]);
  });

  it('a nested id cannot be used to climb out of the banks directory', () => {
    writeBank('history', 'us-capitals', 'caps.yml', `id: x\n${BANK}`);
    fs.writeFileSync(path.join(tmp, 'content', 'secrets.yml'), `id: secrets\n${BANK}`);
    expect(ds.readBankRaw('../secrets')).toBe(null);
    expect(ds.readBankRaw('history/../../secrets')).toBe(null);
    expect(ds.readBankRaw('/etc/passwd')).toBe(null);
    expect(ds.readBankRaw('history/./secrets')).toBe(null);
  });

  it('skips dot-directories when walking the bank tree', () => {
    writeBank('history', 'us-capitals', 'caps.yml', `id: x\n${BANK}`);
    writeBank('history', 'us-capitals', path.join('.trash', 'old.yml'), `id: old\n${BANK}`);
    expect(ds.listBankIds()).toEqual(['history/us-capitals/caps']);
  });

  it('a dot in a filename is addressable — imported banks name half-steps that way', () => {
    writeBank('math', 'algebra', 'domain_and_range_0.5.yml', `id: x\ntitle: Half\nitems:\n  - id: q1\n`);
    expect(ds.listBankIds()).toEqual(['math/algebra/domain_and_range_0.5']);
    expect(ds.readBankRaw('math/algebra/domain_and_range_0.5')).toMatchObject({ title: 'Half' });
  });
});
