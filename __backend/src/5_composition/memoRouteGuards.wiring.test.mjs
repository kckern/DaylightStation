/**
 * A quick-input route refuses a request from its headers before any body is
 * read, and answers no cross-origin preflight. Both depend on app.mjs keeping
 * the app-wide CORS and body-parser middleware off those paths.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const QUICK_INPUT_PATHS = [
  '/api/v1/journalist/memo',
  '/api/v1/journalist/text',
  '/api/v1/journalist/voice',
  '/api/v1/nutribot/photo',
  '/api/v1/nutribot/text',
  '/api/v1/nutribot/voice',
];

const app = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'app.mjs'), 'utf8');

describe('app.mjs keeps app-wide CORS and body parsing off self-guarded routes', () => {
  it('names every quick-input route as self-guarded', () => {
    const list = app.match(/const selfGuarded = exceptPaths\(\[([\s\S]*?)\]\);/)?.[1] ?? '';
    const paths = [...list.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
    expect(paths).toEqual(QUICK_INPUT_PATHS);
  });

  it('wraps cors and both body parsers', () => {
    expect(app).toMatch(/app\.use\(selfGuarded\(cors\(\)\)\);/);
    expect(app).toMatch(/app\.use\(selfGuarded\(express\.json\(/);
    expect(app).toMatch(/app\.use\(selfGuarded\(express\.urlencoded\(/);
  });

  it('mounts none of them bare', () => {
    expect(app).not.toMatch(/app\.use\(cors\(/);
    expect(app).not.toMatch(/app\.use\(express\.json\(/);
    expect(app).not.toMatch(/app\.use\(express\.urlencoded\(/);
  });
});
