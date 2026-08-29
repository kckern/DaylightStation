import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSchoolLedgerTransport } from './SchoolLedgerTransport.mjs';

let base;
const read = () => {
  const directory = path.join(base, 'school');
  const files = fs.readdirSync(directory);
  return { files, lines: fs.readFileSync(path.join(directory, files[0]), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) };
};
beforeEach(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'school-ledger-')); });
afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

describe('school ledger transport', () => {
  it('writes only school events to dated JSONL', () => {
    const transport = createSchoolLedgerTransport({ baseDir: base });
    transport.send({ event: 'school.grade.recorded', data: { learnerId: 'kid' } });
    transport.send({ event: 'fitness.session.started' });
    const { files, lines } = read();
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.jsonl$/);
    expect(lines).toEqual([{ event: 'school.grade.recorded', data: { learnerId: 'kid' } }]);
  });
  it('degrades when its directory cannot be created', () => {
    const blocked = path.join(base, 'blocked');
    fs.writeFileSync(blocked, 'not a directory');
    expect(() => createSchoolLedgerTransport({ baseDir: blocked })).not.toThrow();
  });
  it('prunes only old recognized ledger files', () => {
    const directory = path.join(base, 'school');
    fs.mkdirSync(directory, { recursive: true });
    const old = path.join(directory, '2020-01-01.jsonl');
    const stray = path.join(directory, 'notes.txt');
    fs.writeFileSync(old, '{}\n');
    fs.writeFileSync(stray, 'keep');
    const longAgo = Date.now() - 500 * 86400000;
    fs.utimesSync(old, longAgo / 1000, longAgo / 1000);
    fs.utimesSync(stray, longAgo / 1000, longAgo / 1000);
    createSchoolLedgerTransport({ baseDir: base, maxAgeDays: 400 });
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(stray)).toBe(true);
  });
});
