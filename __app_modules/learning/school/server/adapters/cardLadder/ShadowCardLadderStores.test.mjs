import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { emptyDay, emptyStatusV3 } from "../../domain/cardLadder/index.mjs";
import { ShadowCardLadderStores } from "./ShadowCardLadderStores.mjs";
import { YamlCardLadderStore } from "./YamlCardLadderStore.mjs";

const real = {
  status: emptyStatusV3(), writes: 0,
  readStatus() { return structuredClone(this.status); },
  readDay(u, p, d) { return emptyDay(d); },
  transact() { this.writes += 1; },
  readTuning() { return { schema: 'school.word-ladder-tuning/v1', values: { 'round.size': 6 }, lastChanged: {}, lastTunedDay: '2026-09-21', history: [] }; },
  writeTuning() { this.writes += 1; },
};

const dictationReal = {
  ...real, writes: 0,
  dictationFileState() { return { list: 'ok', progress: 'ok' }; },
  readDictation() { return { schema: 'school.card-ladder-dictation/v1', week: '2026-W45', setAt: null, words: ['gawi'] }; },
  readDictationProgress() { return { week: '2026-W45', words: { gawi: { step: 'copy', blindPasses: 0, lastAttemptAt: null } } }; },
  writeDictation() { this.writes += 1; },
  writeDictationProgress() { this.writes += 1; },
};

describe('ShadowCardLadderStores', () => {
  it('snapshots, mutates only memory, never writes the real store', () => {
    const shadows = new ShadowCardLadderStores({ real, now: () => 0 });
    const token = shadows.create('test-learner', 'korean-vocab', '2026-09-22');
    const store = shadows.forToken(token);
    store.transact('test-learner', 'korean-vocab', '2026-09-22', ({ status, dayFile }) => ({ status: { ...status, decksSeen: ['d'] }, dayFile }));
    expect(store.readStatus('test-learner', 'korean-vocab').decksSeen).toEqual(['d']);
    expect(real.writes).toBe(0);
    expect(real.status.decksSeen).toEqual([]);
  });
  it('applies a seed and evicts after the TTL', () => {
    let t = 0;
    const shadows = new ShadowCardLadderStores({ real, now: () => t, ttlMs: 10 });
    const token = shadows.create('test-learner', 'korean-vocab', '2026-09-22', ({ status, dayFile }) => ({ status: { ...status, lastFoldedDay: 'seeded' }, dayFile }));
    expect(shadows.forToken(token).readStatus().lastFoldedDay).toBe('seeded');
    t = 11;
    expect(() => shadows.forToken(token)).toThrow(/test sitting/);
  });
  it('reads tuning from the real store and can never write it', () => {
    const shadows = new ShadowCardLadderStores({ real, now: () => 0 });
    const store = shadows.forToken(shadows.create('test-learner', 'korean-vocab', '2026-09-22'));
    expect(store.readTuning('test-learner', 'korean-vocab').values).toEqual({ 'round.size': 6 });
    expect(store.writeTuning).toBeUndefined();
    expect(real.writes).toBe(0);
  });
  it('dictation: reads the real list, keeps progress in memory only, never writes the real store', () => {
    const real = dictationReal;
    const shadows = new ShadowCardLadderStores({ real, now: () => 0 });
    const store = shadows.forToken(shadows.create('test-learner', 'korean-vocab', '2026-09-22'));
    expect(store.readDictation('test-learner', 'korean-vocab').words).toEqual(['gawi']);
    expect(store.readDictationProgress('test-learner', 'korean-vocab').words.gawi.step).toBe('copy');
    store.writeDictationProgress('test-learner', 'korean-vocab', { week: '2026-W45', words: { gawi: { step: 'blind', blindPasses: 1, lastAttemptAt: null } } });
    expect(store.readDictationProgress('test-learner', 'korean-vocab').words.gawi.step).toBe('blind');
    expect(real.readDictationProgress().words.gawi.step).toBe('copy');
    expect(store.dictationFileState('test-learner', 'korean-vocab')).toEqual({ list: 'ok', progress: 'ok' });
    expect(store.writeDictation).toBeUndefined();
    expect(real.writes).toBe(0);
    // A fresh sitting starts from the real progress again.
    const other = shadows.forToken(shadows.create('test-learner', 'korean-vocab', '2026-09-22'));
    expect(other.readDictationProgress('test-learner', 'korean-vocab').words.gawi.step).toBe('copy');
  });
  it('peek: a seeded, read-only snapshot that is never kept (the start card)', () => {
    const shadows = new ShadowCardLadderStores({ real, now: () => 0, max: 1 });
    const kept = shadows.create('test-learner', 'korean-vocab', '2026-09-22');
    const store = shadows.peek('test-learner', 'korean-vocab', '2026-09-22', ({ status, dayFile }) => ({ status: { ...status, lastFoldedDay: 'seeded' }, dayFile }));
    expect(store.readStatus().lastFoldedDay).toBe('seeded');
    expect(store.readDay('test-learner', 'korean-vocab', '2026-09-22').day).toBe('2026-09-22');
    expect(store.transact).toBeUndefined();
    // A peek takes no slot: the one kept shadow (max 1) survives it.
    expect(() => shadows.forToken(kept)).not.toThrow();
    expect(real.writes).toBe(0);
  });
});

describe('ShadowCardLadderStores over the real YAML store — test mode never writes either directory', () => {
  it('reads a pre-rename package in place and never copies it to card-ladder/ or writes word-ladder/', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-'));
    try {
      const configService = { getUserDir: (id) => path.join(dir, id), getUserProfile: (id) => (id === 'test-learner' ? { id } : null) };
      const school = path.join(dir, 'test-learner', 'apps', 'school');
      const legacy = path.join(school, 'word-ladder', 'korean-vocab');
      fs.mkdirSync(path.join(legacy, 'days'), { recursive: true });
      fs.writeFileSync(path.join(legacy, 'status.yml'), yaml.dump({ schema: 'school.word-ladder-status/v3', decksSeen: ['deck'], words: {} }));
      fs.writeFileSync(path.join(legacy, 'days', '2026-09-22.yml'), yaml.dump({ schema: 'school.word-ladder-day/v1', day: '2026-09-22', activeMs: 7, items: {} }));
      const bytes = () => fs.readdirSync(legacy, { recursive: true }).map((f) => [f, fs.statSync(path.join(legacy, f)).isFile() ? fs.readFileSync(path.join(legacy, f), 'utf8') : null]);
      const before = bytes();
      const shadows = new ShadowCardLadderStores({ real: new YamlCardLadderStore({ configService }), now: () => 0 });
      const peeked = shadows.peek('test-learner', 'korean-vocab', '2026-09-22');
      expect(peeked.readStatus().decksSeen).toEqual(['deck']);
      const token = shadows.create('test-learner', 'korean-vocab', '2026-09-22');
      const store = shadows.forToken(token);
      expect(store.readDay('test-learner', 'korean-vocab', '2026-09-22').activeMs).toBe(7);
      store.transact('test-learner', 'korean-vocab', '2026-09-22', ({ status, dayFile }) => ({ status: { ...status, decksSeen: ['x'] }, dayFile: { ...dayFile, activeMs: 1 } }));
      expect(store.readTuning('test-learner', 'korean-vocab')).toMatchObject({ values: {} });
      expect(fs.existsSync(path.join(school, 'card-ladder'))).toBe(false);
      expect(bytes()).toEqual(before);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('ShadowCardLadderStores dictation over the real YAML store', () => {
  it('reads the list, keeps progress in memory, and writes no file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-dict-'));
    try {
      const configService = { getUserDir: (id) => path.join(dir, id), getUserProfile: (id) => (id === 'test-learner' ? { id } : null) };
      const realStore = new YamlCardLadderStore({ configService });
      realStore.writeDictation('test-learner', 'korean-vocab', { schema: 'school.card-ladder-dictation/v1', week: 'w', setAt: null, words: ['gawi'] });
      const root = path.join(dir, 'test-learner');
      const bytes = () => fs.readdirSync(root, { recursive: true }).map((f) => [f, fs.statSync(path.join(root, f)).isFile() ? fs.readFileSync(path.join(root, f), 'utf8') : null]);
      const before = bytes();
      const shadows = new ShadowCardLadderStores({ real: realStore, now: () => 0 });
      const store = shadows.forToken(shadows.create('test-learner', 'korean-vocab', '2026-09-22'));
      expect(store.readDictation('test-learner', 'korean-vocab').words).toEqual(['gawi']);
      store.writeDictationProgress('test-learner', 'korean-vocab', { week: 'w', words: { gawi: { step: 'copy', blindPasses: 0, lastAttemptAt: null } } });
      expect(store.readDictationProgress('test-learner', 'korean-vocab').words.gawi.step).toBe('copy');
      expect(bytes()).toEqual(before);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
