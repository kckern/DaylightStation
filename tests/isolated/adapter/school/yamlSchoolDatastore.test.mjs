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
});
