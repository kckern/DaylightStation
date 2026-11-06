/**
 * Shared fixtures for the CardLadderSittingService tests (the main suite and
 * its dictation suite): a two-word deck, an in-memory store, and `make`, which
 * wires the service with fakes. Moved here from the main test file when the
 * dictation tests got a file of their own (public-tree 100 KB rule).
 */
import { vi } from 'vitest';
import { emptyDay, emptyStatusV3 } from "../../../__app_modules/learning/school/server/domain/cardLadder/index.mjs";
import { CardLadderSittingService } from "../../../__app_modules/learning/school/server/application/CardLadderSittingService.mjs";

export const DECK = 'language/korean/week-01';
export const DECK_OTHER = 'language/korean/week-00';
export const REF = 'media:language/korean-vocab/lexicon.yml';
export const TODAY = '2026-09-22';
export const SETTINGS = {
  round: { size: 5, maxPasses: 3 }, batch: { newPerDay: 4, workingSet: 7, order: 'deck' }, review: { gapScale: 1 },
  drill: { afterMisses: 2 }, session: { capMinutes: 15 }, typing: { passScore: 6 },
};
export function memoryStore() {
  const s = { status: emptyStatusV3(), days: {}, writes: 0 };
  return {
    s,
    readStatus: () => structuredClone(s.status),
    readDay: (_u, _p, d) => structuredClone(s.days[d] ?? emptyDay(d)),
    transact(_u, _p, d, fn) { const n = fn({ status: structuredClone(s.status), dayFile: structuredClone(s.days[d] ?? emptyDay(d)) }); s.status = n.status; s.days[d] = n.dayFile; s.writes += 1; return n; },
  };
}
export const lexicon = {
  package: 'korean-vocab', program: { title: 'Korean words' }, language: { code: 'ko', name: 'Korean' }, gloss: { code: 'en', name: 'English' },
  entries: new Map([['gawi', { id: 'gawi', group: 'week-01', term: '가위', gloss: 'Scissors', kind: 'word', decoys: { term: ['a', 'b', 'c'], gloss: ['x', 'y', 'z'] } }],
    ['pul', { id: 'pul', group: 'week-01', term: '풀', gloss: 'Glue', kind: 'word', decoys: { term: ['d', 'e', 'f'], gloss: ['u', 'v', 'w'] } }]]),
};
export function make({ realtime = null, judgementCache = null, recordings = null, mode = 'live', attempts = null, attemptsReader = null, teacherGate = null, judge = null, store = memoryStore(), media = false, decks = null, bounds = null, peek = undefined, linkedUnitId = null, programs = null, lexiconData = lexicon } = {}) {
  let t = Date.parse('2026-09-22T16:00:00-07:00');
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const judgeFn = judge ?? vi.fn(async ({ typed, entry }) => ({ score: typed === entry.term ? 10 : 2, judge: 'exact', reason: null, pass: typed === entry.term }));
  const token = mode === 'test' ? 'abc123' : 'live';
  const service = new CardLadderSittingService({
    stores: { open: () => ({ store, token }), forToken: (tk) => { if (tk !== token) throw new Error('unknown sitting'); return store; }, ...(peek ? { peek } : {}) },
    decks: decks ?? {
      getFlashcardDeck: async (id) => (id === DECK ? { id: DECK, title: 'Week 1: Classroom', words: ['gawi', 'pul'], lexicon: REF } : null),
      listFlashcardDecks: async () => [{ id: DECK, words: ['gawi', 'pul'], lexicon: REF }, { id: DECK_OTHER, words: ['pul'], lexicon: REF }, { id: 'biology/cells', cards: [] }],
    },
    lexicons: { getLexicon: () => lexiconData },
    assignments: { get: async (u) => (u === 'test-learner' ? { programs: programs ?? [{ programId: 'flashcards', deckId: DECK, ...(linkedUnitId ? { linkedUnitId } : {}), policy: { mode: 'card-ladder' } }] } : { programs: [] }) },
    attempts: attemptsReader ? { readAttemptsInRange: attemptsReader } : attempts ? { readAttemptsInRange: vi.fn(() => attempts) } : null,
    assets: { exists: typeof media === 'function' ? media : () => media },
    judge: { judge: judgeFn },
    teacherGate, recordings, judgementCache, realtime,
    settings: () => SETTINGS, bounds, timezone: 'America/Los_Angeles', now: () => (t += 4000), logger, mode,
  });
  return { service, store, logger, judge: judgeFn, advance: (ms) => { t += ms; } };
}
