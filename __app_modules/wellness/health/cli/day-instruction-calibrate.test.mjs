import { afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { readJevApiKey, readingInput, selectCases } from './day-instruction-calibrate.mjs';

const CANARY = 'synthetic-canary-value';
const tempDirs = [];
const makeBase = () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'day-instruction-calibrate-'));
  tempDirs.push(base);
  return base;
};
const writeAuth = content => {
  const base = makeBase();
  fs.mkdirSync(path.join(base, 'data/system/auth'), { recursive: true });
  fs.writeFileSync(path.join(base, 'data/system/auth/jev.yml'), content);
  return base;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('readJevApiKey', () => {
  it('returns the key from a valid file', () => {
    expect(readJevApiKey(writeAuth(`api_key: ${CANARY}\n`))).toBe(CANARY);
  });

  it('keeps the file content out of the error when the YAML is malformed', () => {
    const content = `api_key: "${CANARY}\n  : [\n`;
    // Guards the test itself: the raw parser error does quote this content.
    expect(() => yaml.load(content)).toThrow(CANARY);
    let caught;
    try { readJevApiKey(writeAuth(content)); } catch (error) { caught = error; }
    expect(caught.message).toBe('Unreadable system/auth/jev.yml');
    expect(caught.cause).toBeUndefined();
    expect(String(caught.stack)).not.toContain(CANARY);
  });

  it.each([['a missing file', null], ['a file with no key', 'other: value\n']])('gives the same error for %s', (_label, content) => {
    const base = content === null ? makeBase() : writeAuth(content);
    expect(() => readJevApiKey(base)).toThrow('Unreadable system/auth/jev.yml');
  });
});

describe('calibration cases', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/day-instruction-calibration.json', import.meta.url), 'utf8'));
  it('uses the standard day unless a case sets its own foods and latest capture', () => {
    expect(readingInput({ text: 'a banana' })).toMatchObject({ text: 'a banana', foods: expect.arrayContaining(['Oatmeal']), latest: ['Iced tea', 'Rice'] });
    expect(readingInput({ text: 'a banana', foods: [], latest: ['Milk'] })).toMatchObject({ foods: [], latest: ['Milk'] });
  });
  it('can place the latest capture on another day, which offers the viewed day as a destination', () => {
    expect(readingInput({ text: 'x' }).latestDate).toBeUndefined();
    expect(readingInput({ text: 'x', latestDate: '2026-11-17' })).toMatchObject({ date: '2026-11-18', latestDate: '2026-11-17' });
    expect(fixture.find(item => item.id === 'latest-elsewhere-to-today')).toEqual({ id: 'latest-elsewhere-to-today', text: 'move that to today', foods: ['Oatmeal'], latest: ['Pizza'], latestDate: '2026-11-17', intent: 'move', target: 'latest', toDay: '2026-11-18' });
  });
  it('covers an empty day: two dumps and a correction', () => {
    expect(fixture).toHaveLength(23);
    expect(fixture.slice(-3)).toEqual([
      { id: 'empty-dump', text: 'eggs for breakfast and a burrito at lunch', foods: [], latest: [], intent: 'add' },
      { id: 'empty-single', text: 'a banana', foods: [], latest: [], intent: 'add' },
      { id: 'empty-correct', text: 'that was actually whole milk', foods: [], latest: ['Milk'], intent: 'change', target: 'latest' },
    ]);
  });
  it('runs every case by default, or only the named ones', () => {
    const cases = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(selectCases(cases, [])).toEqual(cases);
    expect(selectCases(cases, ['--only', 'c,a'])).toEqual([{ id: 'a' }, { id: 'c' }]);
    expect(() => selectCases(cases, ['--only', 'z'])).toThrow('Unknown calibration case: z');
    expect(() => selectCases(cases, ['--only'])).toThrow('--only needs case IDs');
  });
});
