// backend/src/3_applications/school/WordLadderTestMode.test.mjs
/**
 * Safety test for test mode (spec §8 Test mode): a full sitting run through
 * `WordLadderSittingService` in `mode: 'test'`, driven against a
 * `ShadowWordLadderStores` shadow of a real learner's files, must never touch
 * a single byte on disk. This is a cross-layer integration test (it wires the
 * real adapters), which is why it lives as a `.test.mjs` file — the layer
 * audit's `walk()` excludes test files from the import-direction scan.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { YamlWordLadderStore } from '#adapters/school/wordLadder/YamlWordLadderStore.mjs';
import { ShadowWordLadderStores } from '#adapters/school/wordLadder/ShadowWordLadderStores.mjs';
import { MemoryJudgementCache } from '#adapters/school/wordLadder/YamlJudgementCache.mjs';
import { seedScenario, DEFAULT_SETTINGS } from '#domains/school/wordLadder/index.mjs';
import { WordLadderSittingService } from './WordLadderSittingService.mjs';
import { WordLadderTypedJudge } from './WordLadderTypedJudge.mjs';

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wltest-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const lexicon = {
  package: 'korean-vocab', program: { title: 'Korean words' }, language: { code: 'ko', name: 'Korean' }, gloss: { code: 'en', name: 'English' },
  entries: new Map([
    ['gawi', { id: 'gawi', group: 'w1', term: '가위', gloss: 'Scissors', kind: 'word', decoys: { term: ['a', 'b', 'c'], gloss: ['x', 'y', 'z'] } }],
    ['pul', { id: 'pul', group: 'w1', term: '풀', gloss: 'Glue', kind: 'word', decoys: { term: ['d', 'e', 'f'], gloss: ['u', 'v', 'w'] } }],
  ]),
};
const deck = { id: 'language/korean/w1', words: ['gawi', 'pul'], lexicon: 'media:language/korean-vocab/lexicon.yml' };

function snapshotFiles() {
  const out = {};
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else out[p] = fs.readFileSync(p, 'utf8'); } };
  walk(dir);
  return out;
}

describe('test mode never writes', () => {
  it('a full test sitting leaves every real file byte-identical', async () => {
    const configService = { getUserDir: (id) => path.join(dir, id), getUserProfile: () => ({}) };
    const real = new YamlWordLadderStore({ configService });
    real.transact('test-learner', 'korean-vocab', '2026-09-20', (x) => x); // create real files
    const before = snapshotFiles();
    const shadows = new ShadowWordLadderStores({ real });
    let t = Date.parse('2026-09-22T16:00:00-07:00');
    const service = new WordLadderSittingService({
      mode: 'test',
      stores: { open: (u, p, d, { scenario }) => { const token = shadows.create(u, p, d, (snap) => seedScenario(scenario ?? 'today', snap, { deckWords: deck.words, day: d })); return { store: shadows.forToken(token), token }; }, forToken: (tk) => shadows.forToken(tk) },
      decks: { getFlashcardDeck: async () => deck, listFlashcardDecks: async () => [deck] }, lexicons: { getLexicon: () => lexicon },
      assignments: { get: async () => ({ programs: [{ programId: 'flashcards', deckId: deck.id, policy: { mode: 'word-ladder' } }] }) },
      assets: { exists: () => false }, judge: new WordLadderTypedJudge({ cache: new MemoryJudgementCache() }),
      settings: () => DEFAULT_SETTINGS, timezone: 'America/Los_Angeles', now: () => (t += 3000), logger: { info() {}, warn() {}, error() {} },
    });
    let { sittingId, item } = await service.open({ userId: 'test-learner', deckId: deck.id, scenario: 'fresh' });
    expect(sittingId.startsWith('test.')).toBe(true);
    for (let i = 0; i < 80 && item.type !== 'summary'; i += 1) {
      const response = item.type === 'flashcard' ? (item.mode === 'intro' ? { seen: true } : { sort: 'claimed' })
        : item.type === 'copy' ? { typed: item.word.term } : item.type === 'typed' ? { typed: '가위' } : { choice: item.choices[0] };
      ({ item } = await service.respond({ userId: 'test-learner', sittingId, itemId: item.id, response }));
    }
    expect(item.type).toBe('summary');
    expect(snapshotFiles()).toEqual(before);
  });
});
