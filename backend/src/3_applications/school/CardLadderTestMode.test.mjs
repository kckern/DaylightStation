// backend/src/3_applications/school/CardLadderTestMode.test.mjs
/**
 * Safety test for test mode (spec §8 Test mode): a full sitting run through
 * `CardLadderSittingService` in `mode: 'test'`, driven against a
 * `ShadowCardLadderStores` shadow of a real learner's files, must never touch
 * a single byte on disk. This is a cross-layer integration test (it wires the
 * real adapters), which is why it lives as a `.test.mjs` file — the layer
 * audit's `walk()` excludes test files from the import-direction scan.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { YamlCardLadderStore } from '#adapters/school/cardLadder/YamlCardLadderStore.mjs';
import { ShadowCardLadderStores } from '#adapters/school/cardLadder/ShadowCardLadderStores.mjs';
import { MemoryJudgementCache } from '#adapters/school/cardLadder/YamlJudgementCache.mjs';
import { DiscardingRecordings } from '#adapters/school/cardLadder/DiscardingRecordings.mjs';
import { seedScenario, DEFAULT_SETTINGS } from '#domains/school/cardLadder/index.mjs';
import { CardLadderSittingService } from './CardLadderSittingService.mjs';
import { CardLadderTypedJudge } from './CardLadderTypedJudge.mjs';

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

function testService({ assets = { exists: () => false }, recordings = null } = {}) {
  const configService = { getUserDir: (id) => path.join(dir, id), getUserProfile: () => ({}) };
  const real = new YamlCardLadderStore({ configService });
  real.transact('test-learner', 'korean-vocab', '2026-09-20', (x) => x); // create real files
  const shadows = new ShadowCardLadderStores({ real });
  let t = Date.parse('2026-09-22T16:00:00-07:00');
  return new CardLadderSittingService({
    mode: 'test', recordings, assets,
    stores: { open: (u, p, d, { scenario }) => { const token = shadows.create(u, p, d, (snap) => seedScenario(scenario ?? 'today', snap, { deckWords: deck.words, day: d })); return { store: shadows.forToken(token), token }; }, forToken: (tk) => shadows.forToken(tk) },
    decks: { getFlashcardDeck: async () => deck, listFlashcardDecks: async () => [deck] }, lexicons: { getLexicon: () => lexicon },
    assignments: { get: async () => ({ programs: [{ programId: 'flashcards', deckId: deck.id, policy: { mode: 'card-ladder' } }] }) },
    judge: new CardLadderTypedJudge({ cache: new MemoryJudgementCache() }),
    settings: () => DEFAULT_SETTINGS, timezone: 'America/Los_Angeles', now: () => (t += 3000), logger: { info() {}, warn() {}, error() {} },
  });
}

describe('test mode never writes', () => {
  it('a full test sitting leaves every real file byte-identical', async () => {
    const service = testService();
    const before = snapshotFiles();
    let { sittingId, item } = await service.open({ userId: 'test-learner', deckId: deck.id, scenario: 'fresh' });
    expect(sittingId.startsWith('test.')).toBe(true);
    for (let i = 0; i < 80 && item.type !== 'summary'; i += 1) {
      const response = item.type === 'flashcard' ? (item.mode === 'intro' ? { seen: true } : { sort: 'claimed' })
        : item.type === 'copy' ? { typed: item.word.term } : item.type === 'typed' ? { typed: '가위' }
          : item.type === 'match' ? { done: true } : { choice: item.choices[0] };
      ({ item } = await service.respond({ userId: 'test-learner', sittingId, itemId: item.id, response }));
    }
    expect(item.type).toBe('summary');
    expect(snapshotFiles()).toEqual(before);
  });

  it('a spoken take in a test sitting goes to the discarding sink: no file appears', async () => {
    const service = testService({ assets: { exists: () => true }, recordings: new DiscardingRecordings() });
    const before = snapshotFiles();
    let { sittingId, item } = await service.open({ userId: 'test-learner', deckId: deck.id, scenario: 'fresh', capabilities: { microphone: true } });
    const takes = [];
    for (let i = 0; i < 80 && item.type !== 'summary'; i += 1) {
      if (item.type === 'say') takes.push(await service.saveRecording({ userId: 'test-learner', sittingId, itemId: item.id, buffer: Buffer.from('take'), ext: 'webm' }));
      const response = item.type === 'flashcard' ? (item.mode === 'intro' ? { seen: true } : { sort: 'claimed' })
        : item.type === 'copy' ? { typed: item.word.term } : item.type === 'typed' ? { typed: '가위' }
          : item.type === 'say' || item.type === 'match' ? { done: true } : { choice: item.choices[0] };
      ({ item } = await service.respond({ userId: 'test-learner', sittingId, itemId: item.id, response }));
    }
    expect(item.type).toBe('summary');
    expect(takes).toEqual([{ take: 1 }, { take: 1 }]);
    expect(snapshotFiles()).toEqual(before);
  });
});
