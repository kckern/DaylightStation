import { initialCardProgress, scheduleReview, selectReviewCards } from '#domains/school/flashcards/index.mjs';
import { studyDayWindow, withinStudyWindow } from '#domains/school/studyDay.mjs';

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const deckRevision = (deck) => String(deck?.revision ?? '1');

/** Server-authoritative state transitions for rich flashcard study. */
export class FlashcardStudyService {
  #store; #decks; #now; #id; #assignments; #grader; #timezone; #boundaryHour;
  constructor({ progressStore, decks, assignments = null, grader = null, timezone = null, boundaryHour = 4, now = () => Date.now(), id = () => crypto.randomUUID() } = {}) {
    if (!progressStore || typeof progressStore.update !== 'function' || typeof progressStore.read !== 'function') throw new Error('FlashcardStudyService requires progressStore');
    if (!decks || typeof decks.getFlashcardDeck !== 'function') throw new Error('FlashcardStudyService requires decks.getFlashcardDeck');
    this.#store = progressStore; this.#decks = decks; this.#assignments = assignments; this.#grader = grader; this.#timezone = timezone; this.#boundaryHour = boundaryHour; this.#now = now; this.#id = id;
  }
  async open({ userId, deckId, policy = {} } = {}) {
    const deck = await this.#decks.getFlashcardDeck(deckId); if (!deck) throw new Error(`flashcard deck '${deckId}' was not found`);
    const now = new Date(this.#now()); let view;
    this.#store.update(userId, (state) => {
      state.events ??= [];
      state.decks ??= {};
      migrateDeckRevision(state, deck, now);
      const existing = Object.values(state.sessions).find((session) => session.deckId === deckId && Date.parse(session.lastActiveAt) + SESSION_TTL_MS > now.getTime());
      // Persistence is keyed by `deckId/cardId` so identically named cards in
      // separate decks cannot collide. The scheduler receives one deck's ids.
      const progress = Object.fromEntries(deck.cards.map(({ cardId }) => [
        cardId, state.cards[`${deckId}/${cardId}`],
      ]).filter(([, value]) => value));
      const cards = selectReviewCards(deck, progress, { now, newLimit: policy.newCardLimit ?? 20, limit: policy.sessionLimit ?? 20 });
      const session = existing ?? { sessionId: this.#id(), deckId, cardIds: [], activeSeconds: 0, reviews: 0, startedAt: now.toISOString(), lastActiveAt: now.toISOString(), deckRevision: deckRevision(deck) };
      // Resume the durable session identity, but reconstitute its eligible
      // queue from current due/new state so a card just rated cannot remain a
      // server-authorized review after it leaves the client queue.
      session.cardIds = cards.map((card) => card.cardId);
      session.deckRevision = deckRevision(deck);
      session.lastActiveAt = now.toISOString();
      state.sessions[session.sessionId] = session; view = { session, cards, progress: state.cards }; return state;
    });
    return { ...view, deck };
  }
  async getDeck(deckId) {
    const deck = await this.#decks.getFlashcardDeck(deckId);
    if (!deck) throw new Error(`flashcard deck '${deckId}' was not found`);
    return deck;
  }
  async assessment({ userId, deckId, testPlan = null, open = false } = {}) {
    if (!this.#assignments || !this.#grader) throw new Error('flashcard assessment is not configured');
    const deck = await this.getDeck(deckId);
    const assignment = await this.#assignments.get(userId);
    const enrollment = (assignment?.programs ?? []).find((row) => row?.programId === 'flashcards' && (row.deckId ?? row.corpusId) === deckId);
    const bankId = deck.assessment?.bankId;
    if (!bankId) throw new Error('this deck has no graded test');
    const bank = this.#grader.getBank(bankId);
    const snapshot = scopedTestBank(bank, testPlan);
    if (!open) return { bank: snapshot, policy: enrollment?.policy ?? {} };
    const testId = this.#id();
    const session = this.#grader.openResolvedSession({
      userId, bankSnapshot: snapshot, mode: 'quiz',
      provenance: { flashcardTest: { deckId, bankId, testId, itemCount: snapshot.items.length } },
    });
    return { ...session, bank: snapshot, policy: enrollment?.policy ?? {} };
  }
  async assessmentStatus({ userId, deckId, policy = null } = {}) {
    if (!this.#assignments || !this.#grader?.flashcardTestStatus) return { required: false, passed: false };
    const deck = await this.getDeck(deckId);
    const assignment = await this.#assignments.get(userId);
    const enrollment = (assignment?.programs ?? []).find((row) => row?.programId === 'flashcards' && (row.deckId ?? row.corpusId) === deckId);
    const resolved = policy ?? enrollment?.policy ?? {};
    if (resolved.quizRequired !== true) return { required: false, passed: true };
    if (!deck.assessment?.bankId) return { required: true, passed: false, reason: 'deck_has_no_assessment' };
    return { required: true, ...this.#grader.flashcardTestStatus(userId, {
      deckId, bankId: deck.assessment.bankId, passingPercent: resolved.quizPassingPercent ?? 80,
    }) };
  }
  async listDecks() {
    if (typeof this.#decks.listFlashcardDecks !== 'function') return [];
    const decks = await this.#decks.listFlashcardDecks();
    return decks.map((deck) => ({
      id: deck.id, title: deck.title, description: deck.description ?? null,
      assessmentBankId: deck.assessment?.bankId ?? null, revision: deck.revision ?? null,
      cardCount: Array.isArray(deck.cards) ? deck.cards.length : 0,
    })).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  }
  async report({ userId } = {}) {
    const decks = await this.listDecks();
    const rows = await Promise.all(decks.map(async (deck) => ({
      ...deck, summary: await this.summary({ userId, deckId: deck.id }),
    })));
    return { learnerId: userId, decks: rows };
  }
  review({ userId, sessionId, cardId, rating, mode = 'review', direction = 'front_to_back' } = {}) {
    const now = new Date(this.#now()); let result;
    this.#store.update(userId, (state) => {
      state.events ??= [];
      const session = state.sessions[sessionId]; if (!session || Date.parse(session.lastActiveAt) + SESSION_TTL_MS <= now.getTime()) throw new Error('flashcard session is unavailable');
      if (!session.cardIds.includes(cardId)) throw new Error('card is not in this session');
      const key = `${session.deckId}/${cardId}`; state.cards[key] = scheduleReview(state.cards[key] ?? initialCardProgress({ now }), rating, { now });
      session.reviews += 1; session.lastActiveAt = now.toISOString();
      state.events.push({ type: 'flashcard_review', at: now.toISOString(), sessionId, deckId: session.deckId, cardId, rating, mode, direction });
      result = { card: state.cards[key], session: structuredClone(session) }; return state;
    }); return result;
  }
  heartbeat({ userId, sessionId, seconds } = {}) {
    const credited = Math.max(0, Math.min(60, Math.floor(Number(seconds) || 0))); const now = new Date(this.#now()); let session;
    this.#store.update(userId, (state) => { state.events ??= []; session = state.sessions[sessionId]; if (!session) throw new Error('flashcard session is unavailable'); session.activeSeconds += credited; session.lastActiveAt = now.toISOString(); if (credited) state.events.push({ type: 'flashcard_active_time', at: now.toISOString(), sessionId, deckId: session.deckId, seconds: credited }); return state; });
    return { activeSeconds: session.activeSeconds };
  }
  async summary({ userId, deckId } = {}) {
    const deck = await this.#decks.getFlashcardDeck(deckId); if (!deck) throw new Error(`flashcard deck '${deckId}' was not found`);
    const state = this.#store.read(userId); const now = this.#now();
    const counts = { due: 0, new: 0, learning: 0, mastered: 0, reviewed: 0, activeSeconds: 0 };
    const today = { reviewed: 0, activeSeconds: 0 };
    const recent = [];
    deck.cards.forEach(({ cardId }) => {
      const progress = state.cards[`${deckId}/${cardId}`];
      if (!progress) { counts.new += 1; return; }
      counts.reviewed += progress.reviews || 0;
      if (progress.state === 'review') counts.mastered += 1;
      else if (progress.state === 'learning' || progress.state === 'relearning') {
        counts.learning += 1;
        if (Date.parse(progress.dueAt) <= now) counts.due += 1;
      }
      if (progress.lastReviewedAt) recent.push({ cardId, at: progress.lastReviewedAt, state: progress.state });
    });
    recent.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    counts.activeSeconds = Object.values(state.sessions)
      .filter((session) => session?.deckId === deckId)
      .reduce((total, session) => total + Math.max(0, Number(session.activeSeconds) || 0), 0);
    const window = studyDayWindow(now, { timezone: this.#timezone, boundaryHour: this.#boundaryHour });
    (state.events ?? []).filter((event) => event?.deckId === deckId && withinStudyWindow(event.at, window)).forEach((event) => {
      if (event.type === 'flashcard_review') today.reviewed += 1;
      if (event.type === 'flashcard_active_time') today.activeSeconds += Math.max(0, Number(event.seconds) || 0);
    });
    return { deckId, counts, today, recent: recent.slice(0, 20) };
  }
}

function scopedTestBank(bank, rawPlan) {
  if (rawPlan === null || rawPlan === undefined) return bank;
  if (!rawPlan || typeof rawPlan !== 'object' || Array.isArray(rawPlan)) throw new Error('flashcard testPlan must be a mapping');
  const available = new Set(bank.items.map((item) => item.type));
  const types = rawPlan.types === undefined ? [...available] : rawPlan.types;
  if (!Array.isArray(types) || !types.length || types.some((type) => typeof type !== 'string' || !available.has(type))) throw new Error('flashcard testPlan.types must be a non-empty subset of the linked bank forms');
  const eligible = bank.items.filter((item) => types.includes(item.type));
  const count = rawPlan.count ?? eligible.length;
  if (!Number.isInteger(count) || count < 1 || count > eligible.length) throw new Error(`flashcard testPlan.count must be an integer from 1 to ${eligible.length}`);
  return { ...bank, items: eligible.slice(0, count) };
}

/**
 * Deck edits are not a reason to discard scheduling history. Retired ids stay
 * in `cards` for audit/recovery but leave the selectable corpus; surviving ids
 * keep their FSRS state. This snapshot makes the policy inspectable when an
 * author raises `revision` or removes a card.
 */
function migrateDeckRevision(state, deck, now) {
  const id = deck.id;
  const nextIds = deck.cards.map(({ cardId }) => cardId);
  const prior = state.decks[id] ?? null;
  const revision = deckRevision(deck);
  if (prior) {
    const priorIds = new Set(prior.cardIds ?? []);
    const next = new Set(nextIds);
    const retired = [...priorIds].filter((cardId) => !next.has(cardId));
    const added = nextIds.filter((cardId) => !priorIds.has(cardId));
    if (prior.revision !== revision || retired.length || added.length) {
      state.events.push({
        type: 'flashcard_deck_revision', at: now.toISOString(), deckId: id,
        fromRevision: prior.revision ?? null, toRevision: revision, retiredCardIds: retired, addedCardIds: added,
      });
    }
    state.decks[id] = {
      revision, cardIds: nextIds, updatedAt: now.toISOString(),
      retiredCardIds: [...new Set([...(prior.retiredCardIds ?? []), ...retired])],
    };
    return;
  }
  state.decks[id] = { revision, cardIds: nextIds, updatedAt: now.toISOString(), retiredCardIds: [] };
}
export default FlashcardStudyService;
