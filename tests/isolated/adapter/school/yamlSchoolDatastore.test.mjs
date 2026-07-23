import { describe, it, expect, beforeEach } from 'vitest';
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

describe('banks', () => {
  it('lists yml basenames and reads a bank by id', () => {
    const dir = path.join(tmp, 'content', 'quizzes');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'caps.yml'), 'id: caps\ntitle: Caps\nitems:\n  - id: q1\n');
    expect(ds.listBankIds()).toEqual(['caps']);
    expect(ds.readBankRaw('caps')).toMatchObject({ id: 'caps', title: 'Caps' });
  });
  it('empty/missing dir lists nothing; unknown or path-traversal id reads null', () => {
    expect(ds.listBankIds()).toEqual([]);
    expect(ds.readBankRaw('nope')).toBe(null);
    expect(ds.readBankRaw('../secrets')).toBe(null);
  });
  it('lists and reads a .yaml bank (not just .yml)', () => {
    const dir = path.join(tmp, 'content', 'quizzes');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'states.yaml'), 'id: states\ntitle: States\nitems:\n  - id: q1\n');
    expect(ds.listBankIds()).toEqual(['states']);
    expect(ds.readBankRaw('states')).toMatchObject({ id: 'states', title: 'States' });
  });
  it('excludes AppleDouble hidden sidecar files from listings', () => {
    const dir = path.join(tmp, 'content', 'quizzes');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'caps.yml'), 'id: caps\ntitle: Caps\nitems:\n  - id: q1\n');
    fs.writeFileSync(path.join(dir, '._caps.yml'), 'garbage-not-yaml-safe-content');
    expect(ds.listBankIds()).toEqual(['caps']);
  });

  // The audiobook banks are foldered by series/work so the tree stays browsable
  // instead of being one flat dump of several hundred files.
  it('lists nested banks by relative path and reads one back', () => {
    const dir = path.join(tmp, 'content', 'quizzes', 'i-survived', '01-titanic-1912');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '01-two-am-on-deck.yml'), 'id: i-survived/01-titanic-1912/01-two-am-on-deck\ntitle: Two AM on Deck\nitems:\n  - id: q1\n');
    expect(ds.listBankIds()).toEqual(['i-survived/01-titanic-1912/01-two-am-on-deck']);
    expect(ds.readBankRaw('i-survived/01-titanic-1912/01-two-am-on-deck'))
      .toMatchObject({ title: 'Two AM on Deck' });
  });
  it('mixes flat and nested banks in one sorted listing', () => {
    const root = path.join(tmp, 'content', 'quizzes');
    fs.mkdirSync(path.join(root, 'shakespeare-tales', 'hamlet'), { recursive: true });
    fs.writeFileSync(path.join(root, 'caps.yml'), 'id: caps\ntitle: Caps\nitems:\n  - id: q1\n');
    fs.writeFileSync(path.join(root, 'shakespeare-tales', 'hamlet', '01-the-ghost.yml'), 'id: x\ntitle: Ghost\nitems:\n  - id: q1\n');
    expect(ds.listBankIds()).toEqual(['caps', 'shakespeare-tales/hamlet/01-the-ghost']);
  });
  it('a nested id cannot be used to climb out of the banks directory', () => {
    const root = path.join(tmp, 'content', 'quizzes');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(tmp, 'content', 'secrets.yml'), 'id: secrets\ntitle: Secret\nitems:\n  - id: q1\n');
    expect(ds.readBankRaw('../secrets')).toBe(null);
    expect(ds.readBankRaw('i-survived/../../secrets')).toBe(null);
    expect(ds.readBankRaw('/etc/passwd')).toBe(null);
    expect(ds.readBankRaw('i-survived/./secrets')).toBe(null);
  });
  it('skips dot-directories when walking the bank tree', () => {
    const root = path.join(tmp, 'content', 'quizzes');
    fs.mkdirSync(path.join(root, '.trash'), { recursive: true });
    fs.writeFileSync(path.join(root, 'caps.yml'), 'id: caps\ntitle: Caps\nitems:\n  - id: q1\n');
    fs.writeFileSync(path.join(root, '.trash', 'old.yml'), 'id: old\ntitle: Old\nitems:\n  - id: q1\n');
    expect(ds.listBankIds()).toEqual(['caps']);
  });
});
