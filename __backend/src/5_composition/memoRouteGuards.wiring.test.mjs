/**
 * The voice memo route refuses a request from its headers before any body is
 * read, and answers no cross-origin preflight. Both depend on app.mjs keeping
 * the app-wide CORS and body-parser middleware off that one path.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const app = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'app.mjs'), 'utf8');

describe('app.mjs keeps app-wide CORS and body parsing off self-guarded routes', () => {
  it('names the memo route as self-guarded', () => {
    expect(app).toMatch(/exceptPaths\(\[\s*'\/api\/v1\/journalist\/memo'/);
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
