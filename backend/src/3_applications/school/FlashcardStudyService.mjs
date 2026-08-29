import { selectReviewCards } from '#domains/school/flashcards/index.mjs';
import { studyDayWindow, withinStudyWindow } from '#domains/school/studyDay.mjs';

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const deckRevision = (deck) => String(deck?.revision ?? '1');

/** Server-authoritative state transitions for rich flashcard study. */
export class FlashcardStudyService {
  #store; #decks; #now; #id; #assignments; #grader; #timezone; #boundaryHour; #scheduler; #policies; #teacherGate;
  constructor({ progressStore, decks, assignments = null, grader = null, scheduler, policyResolver, teacherGate = null, timezone = null, boundaryHour = 4, now, id } = {}) {
    if (!progressStore || typeof progressStore.update !== 'function' || typeof progressStore.read !== 'function') throw new Error('FlashcardStudyService requires progressStore');
    if (!decks || typeof decks.getFlashcardDeck !== 'function') throw new Error('FlashcardStudyService requires decks.getFlashcardDeck');
    if (!scheduler?.initial || !scheduler?.rate || !scheduler?.preview) throw new Error('FlashcardStudyService requires scheduler');
    if (!policyResolver?.resolveLaunch || !policyResolver?.resolveCard) throw new Error('FlashcardStudyService requires policyResolver');
    if (typeof now !== 'function' || typeof id !== 'function') throw new Error('FlashcardStudyService requires now and id');
    this.#store = progressStore; this.#decks = decks; this.#assignments = assignments; this.#grader = grader; this.#scheduler = scheduler; this.#policies = policyResolver; this.#teacherGate = teacherGate; this.#timezone = timezone; this.#boundaryHour = boundaryHour; this.#now = now; this.#id = id;
  }
  async open({ userId, deckId, learning = null } = {}) {
    const deck = await this.#decks.getFlashcardDeck(deckId); if (!deck) throw new Error(`flashcard deck '${deckId}' was not found`);
    const launch = await this.#policies.resolveLaunch({ userId, deck, learning });
    const cardProfiles = Object.fromEntries(deck.cards.map((card) => [card.cardId, this.#policies.resolveCard({ card, launch })]));
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
      const cards = selectReviewCards(deck, progress, { now, newLimit: launch.studyPolicy.newCardLimit ?? 20, limit: launch.studyPolicy.sessionLimit ?? 20 });
      const session = existing ?? { sessionId: this.#id(), deckId, cardIds: [], activeSeconds: 0, reviews: 0, startedAt: now.toISOString(), lastActiveAt: now.toISOString(), deckRevision: deckRevision(deck) };
      // Resume the durable session identity, but reconstitute its eligible
      // queue from current due/new state so a card just rated cannot remain a
      // server-authorized review after it leaves the client queue.
      session.cardIds = cards.map((card) => card.cardId); session.cardProfiles = cardProfiles;
      session.cardDirections = Object.fromEntries(deck.cards.map((card) => [card.cardId, enabledDirections(card)]));
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
  async assessment({ userId, deckId, testPlan = null, open = false, learning = null } = {}) {
    if (!this.#assignments || !this.#grader) throw new Error('flashcard assessment is not configured');
    const deck = await this.getDeck(deckId);
    const launch = await this.#policies.resolveLaunch({ userId, deck, learning, requireAssignment: true });
    const bankId = deck.assessment?.bankId;
    if (!bankId) throw new Error('this deck has no graded test');
    const bank = this.#grader.getBank(bankId);
    const snapshot = scopedTestBank(bank, testPlan);
    if (!open) return { bank: snapshot, policy: launch.studyPolicy };
    const testId = this.#id();
    const session = this.#grader.openResolvedSession({
      userId, bankSnapshot: snapshot, mode: 'quiz',
      provenance: { flashcardTest: { deckId, bankId, testId, itemCount: snapshot.items.length } },
    });
    return { ...session, bank: snapshot, policy: launch.studyPolicy };
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
  async teacherReport({ learnerId, actorId = null, pin = null } = {}) {
    if (!this.#teacherGate?.assert) throw new Error('flashcard teacher report is not configured');
    this.#teacherGate.assert({ userId: actorId, pin, action: 'flashcard-teacher-report', context: { learnerId } });
    const report = await this.report({ userId: learnerId }); const state = this.#store.read(learnerId); const now = new Date(this.#now());
    const decks = report.decks.map((deck) => {
      const cards = Object.entries(state.cards ?? {}).filter(([key]) => key.startsWith(`${deck.id}/`)).map(([key, progress]) => ({
        cardId: key.slice(deck.id.length + 1), profileRevision: progress.scheduler?.profileRevision ?? null,
        retrievability: progress.scheduler ? this.#scheduler.retrievability({ progress, now, profile: storedProfile(progress) }) : null,
      }));
      const audits = (state.events ?? []).filter((event) => event.deckId === deck.id && ['flashcard_repair', 'flashcard_profile_migration'].includes(event.type));
      return { ...deck, cards, audits };
    });
    return { learnerId, decks };
  }
  review({ userId, sessionId, cardId, rating, mode = 'review', direction = 'front_to_back' } = {}) {
    const now = new Date(this.#now()); let result;
    this.#store.update(userId, (state) => {
      state.events ??= [];
      const session = state.sessions[sessionId]; if (!session || Date.parse(session.lastActiveAt) + SESSION_TTL_MS <= now.getTime()) throw new Error('flashcard session is unavailable');
      if (!session.cardIds.includes(cardId)) throw new Error('card is not in this session');
      const allowed = session.cardDirections?.[cardId] ?? ['front_to_back', 'back_to_front'];
      if (!allowed.includes(direction)) throw new Error('flashcard direction is not enabled for this card');
      const key = `${session.deckId}/${cardId}`; const profile = session.cardProfiles?.[cardId];
      if (!profile) throw new Error('flashcard scheduler profile is unavailable');
      const scheduled = this.#scheduler.rate({ progress: state.cards[key] ?? this.#scheduler.initial({ now, profile }), rating, now, profile });
      state.cards[key] = scheduled.progress;
      session.reviews += 1; session.lastActiveAt = now.toISOString();
      state.events.push({ type: 'flashcard_review', at: now.toISOString(), sessionId, deckId: session.deckId, cardId, rating, mode, direction, schedulerProfile: profile, schedulerLog: scheduled.reviewLog });
      result = { card: state.cards[key], session: structuredClone(session) }; return state;
    }); return result;
  }
  preview({ userId, sessionId, cardId } = {}) {
    const now = new Date(this.#now()); let result;
    this.#store.update(userId, (state) => {
      const session = state.sessions?.[sessionId];
      if (!session || Date.parse(session.lastActiveAt) + SESSION_TTL_MS <= now.getTime()) throw new Error('flashcard session is unavailable');
      if (!session.cardIds.includes(cardId)) throw new Error('card is not in this session');
      const profile = session.cardProfiles?.[cardId]; if (!profile) throw new Error('flashcard scheduler profile is unavailable');
      result = { cardId, intervals: this.#scheduler.preview({ progress: state.cards[`${session.deckId}/${cardId}`] ?? this.#scheduler.initial({ now, profile }), now, profile }) };
      return state;
    });
    return result;
  }
  repair({ learnerId, deckId, cardId, action, actorId = null, pin = null } = {}) {
    if (!this.#teacherGate?.assert) throw new Error('flashcard teacher repair is not configured');
    if (!['forget', 'rollback'].includes(action)) throw new Error('flashcard repair action must be forget or rollback');
    this.#teacherGate.assert({ userId: actorId, pin, action: `flashcard-${action}`, context: { learnerId, deckId, cardId } });
    const now = new Date(this.#now()); let result;
    this.#store.update(learnerId, (state) => {
      state.events ??= []; const key = `${deckId}/${cardId}`; const progress = state.cards[key];
      if (!progress?.scheduler) throw new Error('this card has no repairable FSRS history');
      const profile = storedProfile(progress);
      if (action === 'forget') result = this.#scheduler.forget({ progress, now, profile }).progress;
      else {
        const event = [...state.events].reverse().find((row) => row.type === 'flashcard_review' && row.deckId === deckId && row.cardId === cardId && row.schedulerLog);
        if (!event) throw new Error('this card has no review to roll back');
        result = this.#scheduler.rollback({ progress, reviewLog: event.schedulerLog, now, profile });
      }
      state.cards[key] = result;
      state.events.push({ type: 'flashcard_repair', at: now.toISOString(), action, actorId, learnerId, deckId, cardId });
      return state;
    });
    return { card: result };
  }
  async migrateProfile({ learnerId, deckId, actorId = null, pin = null, dryRun = true } = {}) {
    if (!this.#teacherGate?.assert) throw new Error('flashcard profile migration is not configured');
    this.#teacherGate.assert({ userId: actorId, pin, action: 'flashcard-profile-migration', context: { learnerId, deckId, dryRun } });
    const deck = await this.getDeck(deckId);
    const launch = await this.#policies.resolveLaunch({ userId: learnerId, deck });
    const nextProfiles = Object.fromEntries(deck.cards.map((card) => [card.cardId, this.#policies.resolveCard({ card, launch })]));
    const state = this.#store.read(learnerId);
    const replay = migrationReplay({ state, deckId, profiles: nextProfiles, scheduler: this.#scheduler });
    if (dryRun) return { dryRun: true, ...replay.summary };
    const now = new Date(this.#now());
    this.#store.update(learnerId, (next) => {
      next.events ??= []; next.sessions ??= {};
      for (const [cardId, progress] of Object.entries(replay.cards)) next.cards[`${deckId}/${cardId}`] = progress;
      const invalidatedSessionIds = Object.values(next.sessions).filter((session) => session?.deckId === deckId).map((session) => session.sessionId);
      invalidatedSessionIds.forEach((sessionId) => { delete next.sessions[sessionId]; });
      next.events.push({ type: 'flashcard_profile_migration', at: now.toISOString(), learnerId, deckId, actorId, cards: replay.summary.cards, fromRevisions: replay.summary.fromRevisions, toRevisions: replay.summary.toRevisions, invalidatedSessionIds });
      return next;
    });
    return { dryRun: false, ...replay.summary };
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

function enabledDirections(card) {
  const directions = Array.isArray(card?.directions) ? card.directions : ['front_to_back', 'back_to_front'];
  return directions.filter((direction) => direction === 'front_to_back' || direction === 'back_to_front');
}
function storedProfile(progress) {
  const snapshot = progress?.scheduler;
  return { id: snapshot.profileId, revision: snapshot.profileRevision, parameters: structuredClone(snapshot.parameters ?? {}) };
}
function migrationReplay({ state, deckId, profiles, scheduler }) {
  const cards = {}; const fromRevisions = new Set(); const toRevisions = new Set();
  for (const [cardId, profile] of Object.entries(profiles)) {
    const existing = state.cards?.[`${deckId}/${cardId}`];
    if (!existing) continue;
    const history = (state.events ?? []).filter((event) => event?.type === 'flashcard_review' && event.deckId === deckId && event.cardId === cardId)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
    if (history.length !== Number(existing.reviews ?? 0)) throw new Error(`cannot migrate '${cardId}': complete rating history is unavailable`);
    let progress = null;
    for (const event of history) {
      const at = new Date(event.at);
      if (Number.isNaN(at.getTime()) || !['again', 'hard', 'good', 'easy'].includes(event.rating)) throw new Error(`cannot migrate '${cardId}': malformed review history`);
      progress = scheduler.rate({ progress: progress ?? scheduler.initial({ now: at, profile }), rating: event.rating, now: at, profile }).progress;
    }
    if (!progress) continue;
    cards[cardId] = progress; fromRevisions.add(existing.scheduler?.profileRevision ?? 'legacy'); toRevisions.add(profile.revision);
  }
  return { cards, summary: { cards: Object.keys(cards).length, fromRevisions: [...fromRevisions].sort(), toRevisions: [...toRevisions].sort() } };
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
