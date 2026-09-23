import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { YamlWordLadderStore } from './YamlWordLadderStore.mjs';

let dir;
const configService = { getUserDir: (id) => path.join(dir, id), getUserProfile: (id) => (id === 'test-learner' ? { id } : null) };
const base = () => path.join(dir, 'test-learner', 'apps', 'school', 'word-ladder', 'korean-vocab');

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('YamlWordLadderStore v3', () => {
  it('empty status and day for a new learner', () => {
    const store = new YamlWordLadderStore({ configService });
    expect(store.readStatus('test-learner', 'korean-vocab').schema).toBe('school.word-ladder-status/v3');
    expect(store.readDay('test-learner', 'korean-vocab', '2026-09-22').day).toBe('2026-09-22');
  });
  it('migrates a v1 file and writes v3 + the day file on transact', () => {
    fs.mkdirSync(base(), { recursive: true });
    fs.writeFileSync(path.join(base(), 'status.yml'), yaml.dump({ schema: 'school.word-ladder-status/v1', words: { gawi: { state: 'known', step: 0, nextCheckDay: '2026-09-25' } } }));
    const store = new YamlWordLadderStore({ configService });
    expect(store.readStatus('test-learner', 'korean-vocab').words.gawi).toMatchObject({ state: 'mastered', stage: 1 });
    store.transact('test-learner', 'korean-vocab', '2026-09-22', ({ status, dayFile }) => ({ status, dayFile: { ...dayFile, activeMs: 5 } }));
    expect(yaml.load(fs.readFileSync(path.join(base(), 'status.yml'), 'utf8')).schema).toBe('school.word-ladder-status/v3');
    expect(yaml.load(fs.readFileSync(path.join(base(), 'days', '2026-09-22.yml'), 'utf8')).activeMs).toBe(5);
  });
  it('refuses to overwrite a corrupt status', () => {
    fs.mkdirSync(base(), { recursive: true });
    fs.writeFileSync(path.join(base(), 'status.yml'), 'schema: [broken');
    const store = new YamlWordLadderStore({ configService, logger: { error() {} } });
    expect(() => store.transact('test-learner', 'korean-vocab', '2026-09-22', (x) => x)).toThrow(/corrupt/);
  });
});
