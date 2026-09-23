import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YamlCardLadderStore } from './YamlCardLadderStore.mjs';

let dir;
const configService = { getUserDir: (id) => path.join(dir, id), getUserProfile: (id) => (id === 'test-learner' ? { id } : null) };
const base = () => path.join(dir, 'test-learner', 'apps', 'school', 'word-ladder', 'korean-vocab');

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('YamlCardLadderStore v3', () => {
  it('empty status and day for a new learner', () => {
    const store = new YamlCardLadderStore({ configService });
    expect(store.readStatus('test-learner', 'korean-vocab').schema).toBe('school.word-ladder-status/v3');
    expect(store.readDay('test-learner', 'korean-vocab', '2026-09-22').day).toBe('2026-09-22');
  });
  it('migrates a v1 file and writes v3 + the day file on transact', () => {
    fs.mkdirSync(base(), { recursive: true });
    fs.writeFileSync(path.join(base(), 'status.yml'), yaml.dump({ schema: 'school.word-ladder-status/v1', words: { gawi: { state: 'known', step: 0, nextCheckDay: '2026-09-25' } } }));
    const store = new YamlCardLadderStore({ configService });
    expect(store.readStatus('test-learner', 'korean-vocab').words.gawi).toMatchObject({ state: 'mastered', stage: 1 });
    store.transact('test-learner', 'korean-vocab', '2026-09-22', ({ status, dayFile }) => ({ status, dayFile: { ...dayFile, activeMs: 5 } }));
    expect(yaml.load(fs.readFileSync(path.join(base(), 'status.yml'), 'utf8')).schema).toBe('school.word-ladder-status/v3');
    expect(yaml.load(fs.readFileSync(path.join(base(), 'days', '2026-09-22.yml'), 'utf8')).activeMs).toBe(5);
  });
  it('a v3 file written before the sign-off flags loads with them (ruling 2026-09-23); old mastered words are grandfathered', () => {
    fs.mkdirSync(base(), { recursive: true });
    fs.writeFileSync(path.join(base(), 'status.yml'), yaml.dump({
      schema: 'school.word-ladder-status/v3', decksSeen: [],
      words: { gawi: { state: 'mastered', stage: 2, dueDay: '2026-09-25' }, pul: { state: 'familiar' } },
    }));
    const { words } = new YamlCardLadderStore({ configService }).readStatus('test-learner', 'korean-vocab');
    expect(words.gawi).toMatchObject({ state: 'mastered', recognizedCount: 2, matched: true, typedSignedOff: null });
    expect(words.pul).toMatchObject({ state: 'familiar', recognizedCount: 0, matched: false, typedSignedOff: null });
  });
  it('a transaction that leaves a missing day file empty writes status only (a day file means the day was opened)', () => {
    const store = new YamlCardLadderStore({ configService });
    store.transact('test-learner', 'korean-vocab', '2026-09-22', ({ status, dayFile }) => ({ status: { ...status, decksSeen: ['deck'] }, dayFile }));
    expect(yaml.load(fs.readFileSync(path.join(base(), 'status.yml'), 'utf8')).decksSeen).toEqual(['deck']);
    expect(fs.existsSync(path.join(base(), 'days', '2026-09-22.yml'))).toBe(false);
    expect(store.listDays('test-learner', 'korean-vocab')).toEqual([]);
    // An existing day file is still rewritten, even unchanged.
    store.transact('test-learner', 'korean-vocab', '2026-09-22', ({ status, dayFile }) => ({ status, dayFile: { ...dayFile, activeMs: 3 } }));
    store.transact('test-learner', 'korean-vocab', '2026-09-22', (x) => x);
    expect(yaml.load(fs.readFileSync(path.join(base(), 'days', '2026-09-22.yml'), 'utf8')).activeMs).toBe(3);
  });
  it('refuses to overwrite a corrupt status', () => {
    fs.mkdirSync(base(), { recursive: true });
    fs.writeFileSync(path.join(base(), 'status.yml'), 'schema: [broken');
    const store = new YamlCardLadderStore({ configService, logger: { error() {} } });
    expect(() => store.transact('test-learner', 'korean-vocab', '2026-09-22', (x) => x)).toThrow(/corrupt/);
  });
});

describe('YamlCardLadderStore tuning + study days', () => {
  it('reads an empty tuning record when there is no tuning.yml', () => {
    const store = new YamlCardLadderStore({ configService });
    expect(store.readTuning('test-learner', 'korean-vocab')).toEqual({
      schema: 'school.word-ladder-tuning/v1', values: {}, lastChanged: {}, lastTunedDay: null, history: [],
    });
  });
  it('writes tuning.yml beside status.yml and keeps only the last 60 history rows', () => {
    const store = new YamlCardLadderStore({ configService });
    const history = Array.from({ length: 65 }, (_, i) => ({ day: `d${i}`, status: 'on-track', notes: '', applied: [], dropped: [] }));
    store.writeTuning('test-learner', 'korean-vocab', { values: { 'round.size': 6 }, lastChanged: { 'round.size': '2026-09-21' }, lastTunedDay: '2026-09-21', history });
    const raw = yaml.load(fs.readFileSync(path.join(base(), 'tuning.yml'), 'utf8'));
    expect(raw.schema).toBe('school.word-ladder-tuning/v1');
    expect(raw.history).toHaveLength(60);
    expect(raw.history[0].day).toBe('d5');
    const back = store.readTuning('test-learner', 'korean-vocab');
    expect(back).toMatchObject({ values: { 'round.size': 6 }, lastChanged: { 'round.size': '2026-09-21' }, lastTunedDay: '2026-09-21' });
  });
  it('a corrupt tuning.yml reads as empty, reports its state, logs per file kind and is never overwritten', () => {
    fs.mkdirSync(base(), { recursive: true });
    fs.writeFileSync(path.join(base(), 'tuning.yml'), 'values: [broken');
    const logger = { error: vi.fn() };
    const store = new YamlCardLadderStore({ configService, logger });
    expect(store.tuningState('test-learner', 'korean-vocab')).toBe('corrupt');
    expect(store.readTuning('test-learner', 'korean-vocab').values).toEqual({});
    expect(logger.error).toHaveBeenCalledWith('school.card-ladder.store-corrupt', expect.objectContaining({ kind: 'tuning', file: 'tuning', learnerId: 'test-learner' }));
    expect(() => store.writeTuning('test-learner', 'korean-vocab', { values: {} })).toThrow(/corrupt/);
  });
  it('tuningState is missing / ok', () => {
    const store = new YamlCardLadderStore({ configService });
    expect(store.tuningState('test-learner', 'korean-vocab')).toBe('missing');
    store.writeTuning('test-learner', 'korean-vocab', { values: {} });
    expect(store.tuningState('test-learner', 'korean-vocab')).toBe('ok');
  });
  it('coerces hand-edited unquoted dates to YYYY-MM-DD strings', () => {
    fs.mkdirSync(base(), { recursive: true });
    fs.writeFileSync(path.join(base(), 'tuning.yml'), [
      'schema: school.word-ladder-tuning/v1', 'values: { round.size: 6 }', 'lastChanged: { round.size: 2026-09-20 }',
      'lastTunedDay: 2026-09-21', 'history:', '  - { day: 2026-09-21, status: on-track, notes: [], applied: [], dropped: [] }', '',
    ].join('\n'));
    const t = new YamlCardLadderStore({ configService }).readTuning('test-learner', 'korean-vocab');
    expect(t.lastTunedDay).toBe('2026-09-21');
    expect(t.lastChanged).toEqual({ 'round.size': '2026-09-20' });
    expect(t.history[0].day).toBe('2026-09-21');
  });
  it('a corrupt status logs store-corrupt with kind status', () => {
    fs.mkdirSync(base(), { recursive: true });
    fs.writeFileSync(path.join(base(), 'status.yml'), 'schema: [broken');
    const logger = { error: vi.fn() };
    new YamlCardLadderStore({ configService, logger }).readStatus('test-learner', 'korean-vocab');
    expect(logger.error).toHaveBeenCalledWith('school.card-ladder.store-corrupt', expect.objectContaining({ kind: 'status', file: 'status' }));
  });
  it('an unknown learner reads empty tuning and cannot write', () => {
    const store = new YamlCardLadderStore({ configService });
    expect(store.readTuning('nobody', 'korean-vocab').lastTunedDay).toBeNull();
    expect(() => store.writeTuning('nobody', 'korean-vocab', { values: {} })).toThrow();
  });
  it('lists the study days that have a day file, oldest first', () => {
    const store = new YamlCardLadderStore({ configService });
    expect(store.listDays('test-learner', 'korean-vocab')).toEqual([]);
    for (const day of ['2026-09-22', '2026-09-19', '2026-09-20']) store.transact('test-learner', 'korean-vocab', day, ({ status, dayFile }) => ({ status, dayFile: { ...dayFile, activeMs: 1 } }));
    fs.writeFileSync(path.join(base(), 'days', 'notes.yml'), 'x: 1');
    expect(store.listDays('test-learner', 'korean-vocab')).toEqual(['2026-09-19', '2026-09-20', '2026-09-22']);
    expect(store.listDays('nobody', 'korean-vocab')).toEqual([]);
  });
});
