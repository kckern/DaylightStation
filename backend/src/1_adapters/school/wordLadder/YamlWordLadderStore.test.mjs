import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YamlWordLadderStore } from './YamlWordLadderStore.mjs';
import { emptyStatus } from '#domains/school/wordLadder/index.mjs';

let root;
const configService = () => ({ getUserProfile: (id) => (id === 'kid' ? { id } : null), getUserDir: (id) => path.join(root, 'users', id) });
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'wl-store-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('YamlWordLadderStore', () => {
  it('reads an empty status for a learner with no file', () => {
    expect(new YamlWordLadderStore({ configService: configService() }).read('kid')).toEqual(emptyStatus());
  });
  it('round-trips words, frozen days and dates as strings at the documented path', async () => {
    const store = new YamlWordLadderStore({ configService: configService() });
    store.update('kid', (status) => ({
      ...status,
      words: { gawi: { state: 'known', step: 1, claimedDay: null, nextCheckDay: '2026-09-30', history: [{ at: '2026-09-22T16:05:12-07:00', day: '2026-09-22', event: 'claim' }] } },
      days: { '2026-09-23': { deckId: 'language/korean/week-01-classroom', checks: [{ wordId: 'gawi', direction: 'korean_to_english' }], study: [], reviewQuiz: [] } },
      paperAttemptsFolded: ['att_1'], lastFoldedDay: '2026-09-23',
    }));
    const file = path.join(root, 'users/kid/apps/school/korean-vocab/status.yml');
    expect(await readFile(file, 'utf8')).toMatch(/schema: school\.word-ladder-status\/v1/);
    const again = new YamlWordLadderStore({ configService: configService() }).read('kid');
    expect(again.words.gawi.nextCheckDay).toBe('2026-09-30');
    expect(again.words.gawi.history[0].at).toBe('2026-09-22T16:05:12-07:00');
    expect(Object.keys(again.days)).toEqual(['2026-09-23']);
    expect(again.lastFoldedDay).toBe('2026-09-23');
  });
  it('refuses to overwrite a corrupt file and refuses unknown learners', async () => {
    const dir = path.join(root, 'users/kid/apps/school/korean-vocab');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'status.yml'), 'schema: something-else\nwords: []\n');
    const logger = { error: vi.fn() };
    const store = new YamlWordLadderStore({ configService: configService(), logger });
    expect(store.read('kid')).toEqual(emptyStatus());
    expect(logger.error).toHaveBeenCalledWith('school.word-ladder.status-corrupt', expect.objectContaining({ learnerId: 'kid' }));
    expect(() => store.update('kid', (status) => status)).toThrow(/corrupt/);
    expect(() => store.update('ghost', (status) => status)).toThrow(/cannot resolve/);
  });
});
