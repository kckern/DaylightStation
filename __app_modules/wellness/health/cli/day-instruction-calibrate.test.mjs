import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { readJevApiKey } from './day-instruction-calibrate.mjs';

const CANARY = 'synthetic-canary-value';
const writeAuth = content => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'day-instruction-calibrate-'));
  fs.mkdirSync(path.join(base, 'data/system/auth'), { recursive: true });
  fs.writeFileSync(path.join(base, 'data/system/auth/jev.yml'), content);
  return base;
};

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
    const base = content === null ? fs.mkdtempSync(path.join(os.tmpdir(), 'day-instruction-calibrate-')) : writeAuth(content);
    expect(() => readJevApiKey(base)).toThrow('Unreadable system/auth/jev.yml');
  });
});
