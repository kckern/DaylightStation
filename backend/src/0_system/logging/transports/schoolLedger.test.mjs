import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSchoolLedgerTransport } from './schoolLedger.mjs';

let base;

const read = () => {
  const dir = path.join(base, 'school');
  const files = fs.readdirSync(dir);
  return {
    files,
    lines: fs.readFileSync(path.join(dir, files[0]), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),
  };
};

beforeEach(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'school-ledger-')); });
afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

describe('school ledger transport', () => {
  it('writes school events as JSONL into a dated file', () => {
    const t = createSchoolLedgerTransport({ baseDir: base });
    t.send({ ts: 'x', level: 'info', event: 'school.enrollment.materialized', data: { learnerId: 'learner3' } });
    const { files, lines } = read();
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.jsonl$/);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: 'school.enrollment.materialized', data: { learnerId: 'learner3' } });
  });

  it('ignores events belonging to other subsystems', () => {
    const t = createSchoolLedgerTransport({ baseDir: base });
    t.send({ ts: 'x', level: 'info', event: 'school.grade.recorded', data: {} });
    t.send({ ts: 'x', level: 'info', event: 'fitness.session.started', data: {} });
    t.send({ ts: 'x', level: 'info', event: 'piano.loop.saved', data: {} });
    expect(read().lines.map((l) => l.event)).toEqual(['school.grade.recorded']);
  });

  it('does not throw on a malformed event', () => {
    const t = createSchoolLedgerTransport({ baseDir: base });
    expect(() => {
      t.send({ level: 'info', data: {} });   // no event name
      t.send(null);
      t.send({ event: 42 });
    }).not.toThrow();
  });

  // The whole point of the guard: this transport is constructed during boot, so
  // an unwritable media volume must cost the ledger, not the server.
  it('degrades to a no-op when its directory cannot be created', () => {
    const blocked = path.join(base, 'blocked');
    fs.writeFileSync(blocked, 'not a directory');
    let t;
    expect(() => { t = createSchoolLedgerTransport({ baseDir: blocked }); }).not.toThrow();
    expect(() => t.send({ ts: 'x', level: 'info', event: 'school.grade.recorded', data: {} })).not.toThrow();
  });

  it('prunes dated files older than maxAgeDays and keeps recent ones', () => {
    const dir = path.join(base, 'school');
    fs.mkdirSync(dir, { recursive: true });
    const old = path.join(dir, '2020-01-01.jsonl');
    const recent = path.join(dir, '2026-08-13.jsonl');
    fs.writeFileSync(old, '{}\n');
    fs.writeFileSync(recent, '{}\n');
    const longAgo = Date.now() - 500 * 86400000;
    fs.utimesSync(old, longAgo / 1000, longAgo / 1000);

    createSchoolLedgerTransport({ baseDir: base, maxAgeDays: 400 });

    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
  });

  it('leaves files it does not recognise alone when pruning', () => {
    const dir = path.join(base, 'school');
    fs.mkdirSync(dir, { recursive: true });
    const stray = path.join(dir, 'notes.txt');
    fs.writeFileSync(stray, 'keep me');
    const longAgo = Date.now() - 500 * 86400000;
    fs.utimesSync(stray, longAgo / 1000, longAgo / 1000);

    createSchoolLedgerTransport({ baseDir: base, maxAgeDays: 400 });

    expect(fs.existsSync(stray)).toBe(true);
  });
});
