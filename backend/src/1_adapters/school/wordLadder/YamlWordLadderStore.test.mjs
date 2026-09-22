import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YamlWordLadderStore } from './YamlWordLadderStore.mjs';
import { emptyStatus } from '#domains/school/wordLadder/index.mjs';

let root;
const PKG = 'korean-vocab';
const configService = () => ({ getUserProfile: (id) => (id === 'kid' ? { id } : null), getUserDir: (id) => path.join(root, 'users', id) });
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'wl-store-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('YamlWordLadderStore', () => {
  it('reads an empty status for a learner with no file', () => {
    expect(new YamlWordLadderStore({ configService: configService() }).read('kid', PKG)).toEqual(emptyStatus());
  });
  it('round-trips words, frozen days and dates as strings at the documented path', async () => {
    const store = new YamlWordLadderStore({ configService: configService() });
    store.update('kid', PKG, (status) => ({
      ...status,
      words: { gawi: { state: 'known', step: 1, claimedDay: null, nextCheckDay: '2026-09-30', history: [{ at: '2026-09-22T16:05:12-07:00', day: '2026-09-22', event: 'claim' }] } },
      days: { '2026-09-23': { deckId: 'language/korean/week-01-classroom', checks: [{ wordId: 'gawi', direction: 'term_to_gloss' }], study: [], reviewQuiz: [] } },
      paperAttemptsFolded: ['att_1'], lastFoldedDay: '2026-09-23',
    }));
    const file = path.join(root, 'users/kid/apps/school/word-ladder/korean-vocab/status.yml');
    expect(await readFile(file, 'utf8')).toMatch(/schema: school\.word-ladder-status\/v1/);
    const again = new YamlWordLadderStore({ configService: configService() }).read('kid', PKG);
    expect(again.words.gawi.nextCheckDay).toBe('2026-09-30');
    expect(again.words.gawi.history[0].at).toBe('2026-09-22T16:05:12-07:00');
    expect(Object.keys(again.days)).toEqual(['2026-09-23']);
    expect(again.lastFoldedDay).toBe('2026-09-23');
  });
  it('keeps one status file per word package and refuses an unsafe package id', async () => {
    const store = new YamlWordLadderStore({ configService: configService() });
    store.update('kid', 'spanish-vocab', (status) => ({ ...status, lastFoldedDay: '2026-09-22' }));
    expect(await readFile(path.join(root, 'users/kid/apps/school/word-ladder/spanish-vocab/status.yml'), 'utf8')).toMatch(/lastFoldedDay/);
    expect(store.read('kid', PKG).lastFoldedDay).toBeNull();
    expect(() => store.read('kid', '../escape')).toThrow(/invalid word package/);
    expect(() => store.read('kid')).toThrow(/invalid word package/);
  });
  it('refuses to overwrite a corrupt file and refuses unknown learners', async () => {
    const dir = path.join(root, 'users/kid/apps/school/word-ladder/korean-vocab');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'status.yml'), 'schema: something-else\nwords: []\n');
    const logger = { error: vi.fn() };
    const store = new YamlWordLadderStore({ configService: configService(), logger });
    expect(store.read('kid', PKG)).toEqual(emptyStatus());
    expect(logger.error).toHaveBeenCalledWith('school.word-ladder.status-corrupt', expect.objectContaining({ learnerId: 'kid' }));
    expect(() => store.update('kid', PKG, (status) => status)).toThrow(/corrupt/);
    expect(() => store.update('ghost', PKG, (status) => status)).toThrow(/cannot resolve/);
  });
});
