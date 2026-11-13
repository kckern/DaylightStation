import { practiceMenu, startCourseReview, startDictation as startDictationRun } from "../domain/cardLadder/engine.mjs";
import { currentDictation, dictationState } from "../domain/cardLadder/dictation.mjs";
// __backend/src/3_applications/school/CardLadderSittingService.mjs
/**
 * The card ladder's application service (mastery redesign rev 4, spec §4/§8).
 * Loads the learner's status + today's day file through a store (the real
 * one, or a test-mode shadow), runs the pure day engine, judges typed answers
 * BEFORE the engine sees them, and never sends a graded item's answer to the
 * client.
 *
 * LANGUAGE-NEUTRAL: the taught language, the gloss language and the title all
 * come from the deck's lexicon; status and day files live under the lexicon's
 * WORD PACKAGE. A sitting id carries its package and store token
 * (`<pkg>.<token>.<n>`, test mode `test.<pkg>.<token>.<n>`), so sitting-scoped
 * calls find the right files without the client naming a deck.
 *
 * The tuning values in force for a day are the day file's at-open snapshot
 * (`atOpen.settings`); current settings — the School config's resolved
 * settings with the learner's `tuning.yml` values laid over them (spec §7) —
 * are only the fallback for a day that has none, so a tuning change lands at
 * the next day's first open, never mid-day. This service only READS tuning.
 *
 * Speaking is never graded (spec §3): a take is kept for grown-ups through the
 * recordings sink (a discarding one in test mode) and never touches status.
 */
import { isCardLadderPolicy } from "../domain/flashcards/index.mjs";
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { GuestForbiddenError } from "../domain/errors.mjs";
import { offsetMinutesFor, studyDayForInstant } from "../domain/studyDay.mjs";
import { addDays } from "../domain/termVerdict.mjs";
import { curriculumPosterRef } from '#apps/common/resources/publicResourceRefs.mjs';
import {
  applyGraded, addActiveTime, cueFor, currentItem, deckDirOf, deckProgress, emptyWordV3, introPlanLabel, introPreview, excludeWordFromDay, foldPaperAttempts, ladderLevel, markMastered, openDay, orderNewWords,
  quizDocumentIdFor, respond, roundHasMatch, newWordsHeld, startPractice, learnMore, typedAnswers, dayAnswers, daySummary, withTunedValues, wordAssetIds, wordTransitions,
  servedWhy, dayChanges, prereqChanges, scriptFor, ruleForTarget, unreleasedWords,
} from "../domain/cardLadder/index.mjs";

const FOLD_LOOKBACK_DAYS = 60;

/**
 * The sign-off fields a word row carries beside its raw `state` (ruling
 * 2026-09-23). `level` is what to show: `mastered` only once a typed recheck
 * signed the word off; a verified word before that is `recognised`. Added
 * fields only — `state`/`stage` keep their meaning for older clients.
 */
function signOffFields(word) {
  return {
    level: ladderLevel(word), recognizedCount: word.recognizedCount ?? 0,
    matched: word.matched === true, typedSignedOff: word.typedSignedOff ?? null,
  };
}
const FOLD_SKEW_DAYS = 2;
const TEST_PREFIX = 'test.';
const CLOSE_REASONS = new Set(['goal', 'cap', 'leave', 'idle', 'unmount']);
const IDLE_CLOSE_MS = 5 * 60_000;
// Speaking steps (spec §3 1.2 / 1.3 / 3.4): the only items a take is kept for.
const SPEAKING = new Set(['say-after', 'read-aloud', 'say-from-cue']);
// Unsupported speaking steps withhold the native model until the child's take.
const REVEAL_AFTER_TAKE = new Set(['read-aloud', 'say-from-cue']);
const RECORDING_EXTS = new Set(['webm', 'ogg', 'm4a', 'mp4', 'wav']);
const NO_ASSETS = Object.freeze({ image: null, audio: null, glossAudio: null });
// A weekly dictation is ten words (spec 2026-11-06, Revision 2); another count is warned, never refused.
const DICTATION_WORDS = 10;
// Grown-up word controls (spec §6): how far back a word's typed answers are listed.
const ADMIN_TYPED_DAYS = 14;
// How many study days the grown-up's day list goes back (newest first).
const ADMIN_DAY_LIST = 60;
const STUDY_DAY = /^\d{4}-\d{2}-\d{2}$/;
const REGRADE_REASON = 'Re-graded by a grown-up';
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The id of the day's most recently answered item (by its `at`), or null. */
function lastAnsweredItemId(dayFile) {
  let best = null;
  let bestMs = -Infinity;
  for (const [id, rec] of Object.entries(dayFile?.items ?? {})) {
    const ms = Date.parse(rec?.at ?? '');
    if (Number.isFinite(ms) && ms >= bestMs) { best = id; bestMs = ms; }
  }
  return best;
}

/** An ISO instant carrying the household's own offset: `2026-09-22T16:05:12-07:00`. */
function isoWithOffset(ms, timezone) {
  const offset = offsetMinutesFor(timezone, ms);
  const local = new Date(ms + offset * 60_000).toISOString().slice(0, 19);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export class CardLadderSittingService {
  #courseAccess = null;
  #realtime = null;
  #stores; #decks; #lexicons; #assignments; #attempts; #assets; #judge; #judgementCache; #teacherGate; #recordings; #settings; #bounds; #timezone; #now; #logger; #mode;
  #counter = 0;

  constructor({
    stores, decks, lexicons, assignments, attempts = null, assets = null, judge, judgementCache = null, teacherGate = null, recordings = null,
    settings, bounds = null, timezone = null, now, logger = console, realtime = null, mode = 'live',
  } = {}) {
    if (typeof stores?.open !== 'function' || typeof stores?.forToken !== 'function') throw new Error('CardLadderSittingService requires stores');
    if (typeof decks?.getFlashcardDeck !== 'function') throw new Error('CardLadderSittingService requires decks.getFlashcardDeck');
    if (typeof lexicons?.getLexicon !== 'function') throw new Error('CardLadderSittingService requires lexicons.getLexicon');
    if (typeof assignments?.get !== 'function') throw new Error('CardLadderSittingService requires assignments');
    if (typeof judge?.judge !== 'function') throw new Error('CardLadderSittingService requires a judge');
    if (typeof settings !== 'function' || typeof now !== 'function') throw new Error('CardLadderSittingService requires settings() and now()');
    if (mode !== 'live' && mode !== 'test') throw new Error(`CardLadderSittingService mode must be live or test, got '${mode}'`);
    if (recordings !== null && typeof recordings?.save !== 'function') throw new Error('CardLadderSittingService recordings must have save()');
    if (judgementCache !== null && typeof judgementCache?.set !== 'function') throw new Error('CardLadderSittingService judgementCache must have set()');
    this.#realtime = realtime;
    this.#recordings = recordings;
    this.#judgementCache = judgementCache;
    this.#stores = stores; this.#decks = decks; this.#lexicons = lexicons; this.#assignments = assignments;
    this.#attempts = attempts; this.#assets = assets; this.#judge = judge; this.#teacherGate = teacherGate;
    this.#settings = settings; this.#bounds = bounds; this.#timezone = timezone; this.#now = now; this.#logger = logger; this.#mode = mode;
  }

  configureRealtime(realtime) { this.#realtime = realtime; }

  /** Observe a fresh transaction's completion transition only after persistence succeeds. */
  #transact(store, learnerId, pkg, day, deckId, change) {
    let beforeDoneAt = null;
    const out = store.transact(learnerId, pkg, day, input => {
      beforeDoneAt = input.dayFile.doneAt;
      return change(input);
    });
    if (this.#mode === 'live' && !beforeDoneAt && out.dayFile.doneAt) {
      const fact = { learnerId, package: pkg, deckId, studyDay: day, doneAt: out.dayFile.doneAt,
        evidenceId: `card-ladder:${learnerId}:${pkg}:${day}:${out.dayFile.doneAt}` };
      try {
        const notification = this.#realtime?.cardPracticeDayCompleted?.(fact);
        notification?.catch?.(error => this.#logger.warn?.('school.card-ladder.completion-notification-failed', { learnerId, evidenceId: fact.evidenceId, error: error.message }));
      } catch (error) {
        this.#logger.warn?.('school.card-ladder.completion-notification-failed', { learnerId, evidenceId: fact.evidenceId, error: error.message });
      }
    }
    return out;
  }

  #today(ms = this.#now()) { return studyDayForInstant(ms, { timezone: this.#timezone }); }

  /** Current settings for a learner's package: config settings + their tuned values (clamped to spec and household bounds). */
  #currentSettings(store, userId, pkg) {
    let values = null;
    try { values = store.readTuning?.(userId, pkg)?.values ?? null; } catch (error) {
      this.#logger.warn?.('school.card-ladder.tuning-unreadable', { learnerId: userId, package: pkg, error: error.message });
    }
    return withTunedValues(this.#settings(), values, this.#bounds);
  }

  /** The tuning values in force for a day: its at-open snapshot, else current settings. */
  #daySettings(dayFile, { store, userId, pkg }) { return dayFile?.atOpen?.settings ?? this.#currentSettings(store, userId, pkg); }

  async #enrollments(userId) {
    const assignment = await this.#assignments.get(userId);
    return (assignment?.programs ?? []).filter((row) => row?.programId === 'flashcards' && isCardLadderPolicy(row.policy));
  }

  async #assertAssigned(userId, deckId) {
    if (typeof userId !== 'string' || !userId) throw new ValidationError('userId is required');
    if (typeof deckId !== 'string' || !deckId) throw new ValidationError('deckId is required');
    const enrollment = (await this.#enrollments(userId)).find((row) => (row.deckId ?? row.corpusId) === deckId);
    if (!enrollment) throw new GuestForbiddenError(`'${userId}' has no card-ladder assignment for '${deckId}'`);
    return enrollment;
  }

  async #assertStudyAccess(userId, deckId) {
    const enrollment = await this.#assertAssigned(userId, deckId);
    if (enrollment.linkedUnitId && this.#mode !== 'test') {
      if (!this.#courseAccess) throw new ValidationError('Course readiness is not configured.');
      const assessment = await this.#courseAccess({ learnerId: userId, deckId });
      if (!assessment || assessment.access?.allowed === false || assessment.stage === 'locked') throw new GuestForbiddenError(assessment?.access?.reason ?? assessment?.message ?? 'Finish the preceding lesson first.');
    }
  }

  /** Composed after the course service, which uses our read-only evidence. */
  configureCourseAccess({ getAssessment }) { this.#courseAccess = getAssessment; }

  /** The deck, its validated lexicon, and the word package both belong to. */
  async #load(deckId) {
    const deck = await this.#decks.getFlashcardDeck(deckId);
    if (!deck || !Array.isArray(deck.words) || typeof deck.lexicon !== 'string') throw new EntityNotFoundError('card-ladder deck', deckId);
    const lexicon = this.#lexicons.getLexicon(deck.lexicon);
    return { deck, lexicon, pkg: lexicon.package };
  }

  async courseEvidence({ userId, deckId }) {
    await this.#assertAssigned(userId, deckId);
    const { pkg } = await this.#load(deckId);
    const { store } = this.#stores.open(userId, pkg, this.#today(), { readOnly: true });
    return { status: store.readStatus(userId, pkg), dayFiles: (store.listDays?.(userId, pkg) ?? []).map((day) => store.readDay(userId, pkg, day)) };
  }

  async coursePaperFeedback({ userId, deckId, cardIds, attemptKey }) {
    await this.#assertAssigned(userId, deckId);
    const { pkg, deck } = await this.#load(deckId);
    const day = this.#today();
    const { store } = this.#stores.open(userId, pkg, day);
    const key = `course:${attemptKey}`;
    const settings = this.#currentSettings(store, userId, pkg);
    this.#transact(store, userId, pkg, day, deckId, ({ status, dayFile }) => {
      if (status.paperAttemptsFolded.includes(key)) return { status, dayFile };
      for (const id of cardIds) {
        if (!deck.words.includes(id)) throw new ValidationError('Paper feedback contains an unknown card.');
        if (status.words[id]) status.words[id] = applyGraded(status.words[id], { source: 'paper', correct: false, day, task: '2.2', settings: { afterMisses: settings.drill.afterMisses } });
      }
      status.paperAttemptsFolded.push(key);
      return { status, dayFile };
    });
    this.#logger.info?.('school.card-ladder.course-paper-feedback', { learnerId: userId, deckId, attemptKey, cardIds });
  }

  async courseReview({ userId, deckId, sittingId, unitId, chosen, after }) {
    const { store, pkg, ctx, day, settings } = await this.#context(userId, sittingId);
    const sitting = ctx.dayFile.sittings[sittingId];
    if (sitting.deckId !== deckId) throw new ValidationError('Review belongs to a different deck.');
    const out = this.#transact(store, userId, pkg, day, deckId, ({ status, dayFile }) => startCourseReview({ ...ctx, status, dayFile: addActiveTime(dayFile, this.#now()) }, { unitId, chosen, after }));
    const nextCtx = { ...ctx, status: out.status, dayFile: out.dayFile, settings };
    this.#logger.info?.('school.card-ladder.course-review', { learnerId: userId, sittingId, unitId, cardIds: chosen });
    return { item: this.#publicItem(currentItem(nextCtx), nextCtx), progress: this.#progress(nextCtx) };
  }

  /**
   * The week's dictation for a learner's package (spec 2026-11-06, Revision
   * 2): the list is the newest week tag on the package's lexicon entries
   * (`currentDictation`); only the learner's progress is stored. Words
   * without term audio are excluded as needs-recording, tagged words outside
   * the sitting's deck as unknown-word (UX audit #5: shown, never hidden).
   */
  #dictationRules(lexicon, media, deck) {
    const inDeck = new Set(deck?.words ?? []);
    return { hasAudio: (id) => media?.[id]?.audio === true, inLexicon: (id) => lexicon.entries.has(id) && inDeck.has(id) };
  }

  #readDictation(store, userId, pkg, lexicon, media, deck) {
    const fileState = store.dictationFileState?.(userId, pkg) ?? { progress: 'missing' };
    const list = currentDictation(lexicon);
    const progress = store.readDictationProgress?.(userId, pkg) ?? null;
    const state = list ? dictationState(list, progress, this.#dictationRules(lexicon, media, deck)) : null;
    return { fileState, list, progress, state };
  }

  #dictationSummary(state, list) {
    const count = list?.count ?? state.words.length + state.excluded.length;
    return {
      week: state.week, total: state.words.length, remaining: state.remaining, done: state.done, ready: state.done,
      count, countWarning: count !== DICTATION_WORDS,
      needsRecording: state.excluded.filter((row) => row.reason === 'needs-recording').map((row) => row.id),
      unknown: state.excluded.filter((row) => row.reason === 'unknown-word').map((row) => row.id),
    };
  }

  /**
   * One tap from the start card: opens a dictation run in `sittingId` and
   * serves its first item. A ready list answers `{ done: true }`; a list with
   * nothing left to drill but words waiting for a grown-up (or none at all)
   * answers `{ done: false }` and opens no run. Allowed before or after the
   * daily goal; adds no active time (ruling 10). A corrupt progress file is
   * refused here, so a run never fails mid-way.
   */
  async startDictation({ learnerId, userId = learnerId, package: pkgArg = null, sittingId, review = false } = {}) {
    const { store, pkg, lexicon, media, settings, ctx, day, sitting, deck } = await this.#context(userId, sittingId);
    if (pkgArg !== null && pkgArg !== pkg) throw new ValidationError(`Sitting belongs to package '${pkg}', not '${pkgArg}'.`);
    const read = this.#readDictation(store, userId, pkg, lexicon, media, deck);
    const base = { learnerId: userId, package: pkg };
    if (read.fileState.progress === 'corrupt') {
      this.#logger.warn?.('school.card-ladder.dictation.corrupt', { ...base, sittingId, progress: read.fileState.progress });
      throw new ValidationError('This week\'s dictation file is unreadable; a grown-up needs to fix it.');
    }
    if (!read.state?.week) throw new ValidationError('No dictation list is set for this week.');
    const { state } = read;
    // Exactly ten (Revision 2): another count is flagged, never refused.
    if (read.list.count !== DICTATION_WORDS) this.#logger.warn?.('school.card-ladder.dictation.count', { ...base, week: state.week, count: read.list.count });
    for (const row of state.excluded) {
      if (row.reason === 'unknown-word') this.#logger.warn?.('school.card-ladder.dictation.unknown-word', { ...base, week: state.week, wordId: row.id });
    }
    const summary = this.#dictationSummary(state, read.list);
    if (state.done && review === true) return this.#startDictationReview({ store, pkg, ctx, day, sitting, settings, lexicon, media, deck, base, sittingId, read, summary });
    if (state.done) {
      this.#logger.info?.('school.card-ladder.dictation.already-done', { ...base, sittingId, week: state.week });
      return { done: true, dictation: summary };
    }
    if (state.finished) {
      this.#logger.info?.('school.card-ladder.dictation.nothing-to-drill', {
        ...base, sittingId, week: state.week, needsRecording: summary.needsRecording, unknown: summary.unknown,
      });
      return { done: false, dictation: summary };
    }
    const out = this.#transact(store, userId, pkg, day, sitting.deckId, ({ status, dayFile }) => startDictationRun({ ...ctx, status, dayFile, dictation: state }, { sittingId }));
    const nextCtx = { ...ctx, status: out.status, dayFile: out.dayFile, dictation: state, settings };
    const item = currentItem(nextCtx);
    this.#logger.info?.('school.card-ladder.dictation.started', {
      ...base, sittingId, week: state.week, words: state.words.length, remaining: state.remaining, needsRecording: summary.needsRecording, unknown: summary.unknown,
    });
    this.#logSequencing({ learnerId: userId, sittingId, pkg, day }, { ctx: nextCtx, item, via: 'dictation' });
    return { item: this.#publicItem(item, nextCtx), progress: this.#progress(nextCtx), dictation: summary };
  }

  /**
   * Review a finished week (spec Goals; final review I2): every word starts
   * at blind with one pass banked, so one more correct write finishes it; a
   * miss steps back as usual. The run keeps its own word state on the day
   * file — the learner's progress is never written.
   */
  #startDictationReview({ store, pkg, ctx, day, sitting, settings, lexicon, media, deck, base, sittingId, read, summary }) {
    const words = Object.fromEntries(read.state.words.map((w) => [w.id, { step: 'blind', blindPasses: 1 }]));
    const state = dictationState(read.list, { week: read.state.week, words }, this.#dictationRules(lexicon, media, deck));
    const out = this.#transact(store, base.learnerId, pkg, day, sitting.deckId, ({ status, dayFile }) => startDictationRun({ ...ctx, status, dayFile, dictation: state }, { sittingId, review: { words } }));
    const nextCtx = { ...ctx, status: out.status, dayFile: out.dayFile, dictation: state, settings };
    const item = currentItem(nextCtx);
    this.#logger.info?.('school.card-ladder.dictation.started', { ...base, sittingId, week: state.week, words: state.words.length, remaining: state.remaining, review: true });
    this.#logSequencing({ learnerId: base.learnerId, sittingId, pkg, day }, { ctx: nextCtx, item, via: 'dictation' });
    return { item: this.#publicItem(item, nextCtx), progress: this.#progress(nextCtx), dictation: { ...summary, review: true } };
  }

  async packageOf(deckId) { return (await this.#load(deckId)).pkg; }

  #has(assetId) { try { return this.#assets?.exists?.(assetId) === true; } catch { return false; } }

  /** Per word: which assets exist (booleans, what the engine reads) and their ids. */
  /**
   * The launch card's buttons (owner 2026-11-06: dictation and flashcard
   * review always one tap from the card, whatever the day). The primary is
   * what is most worth doing now: dictation while words are left, else
   * today's cards before the goal, else review.
   */
  #launchEntries({ doneToday, dictation }) {
    const drill = dictation && !dictation.unavailable && !dictation.done && dictation.remaining > 0;
    const ready = dictation?.done === true;
    const primary = drill ? 'dictation' : (doneToday ? 'review' : 'today');
    const all = {
      dictation: drill ? { id: 'dictation', label: 'Practise dictation' } : null,
      'dictation-review': ready ? { id: 'dictation-review', label: 'Review dictation' } : null,
      today: { id: 'today', label: "Today's cards" },
      review: { id: 'review', label: 'Review flashcards' },
    };
    const order = drill
      ? (doneToday ? ['dictation', 'review', 'today'] : ['dictation', 'today', 'review'])
      : (doneToday ? ['review', 'dictation-review', 'today'] : ['today', 'review', 'dictation-review']);
    return order.map((id) => all[id]).filter(Boolean).map((entry) => ({ ...entry, role: entry.id === primary ? 'primary' : 'secondary' }));
  }

  /**
   * Term audio for the week's tagged words only (final review M3): the start
   * card and every agenda card read this, and probing the whole lexicon's
   * media there is ~300 file checks per render on a slow mount.
   */
  #dictationMedia(deck, lexicon) {
    const media = {};
    for (const id of currentDictation(lexicon)?.words ?? []) {
      const entry = lexicon.entries.get(id);
      if (entry) media[id] = { audio: this.#has(wordAssetIds(deck.lexicon, entry).audio) };
    }
    return media;
  }

  #media(deck, lexicon) {
    const media = {};
    for (const entry of lexicon.entries.values()) {
      const ids = wordAssetIds(deck.lexicon, entry);
      media[entry.id] = { image: this.#has(ids.image), audio: this.#has(ids.audio), glossAudio: this.#has(ids.glossAudio), ids };
    }
    return media;
  }

  /** Each deck the learner has seen (in order) plus this one, with its word ids. */
  async #deckGroups(status, deck) {
    const order = [...status.decksSeen];
    if (!order.includes(deck.id)) order.push(deck.id);
    const groups = [];
    for (const deckId of order) {
      const other = deckId === deck.id ? deck : await this.#decks.getFlashcardDeck(deckId).catch(() => null);
      groups.push({ deckId, ids: [...(other?.words ?? [])], releases: other?.releases });
    }
    return groups;
  }

  /** Word ids across every deck the learner has seen (in order) plus this one — authored order. */
  async #deckOrder(status, deck) {
    return orderNewWords(await this.#deckGroups(status, deck), { order: 'deck' });
  }

  /**
   * Words still new, across every deck the learner has seen plus this one, in
   * the order they will be introduced: `batch.order` (config; random by
   * default — a stable per-learner shuffle within each deck).
   */
  async #pool(status, deck, learnerId) {
    const order = this.#settings().batch?.order ?? 'random';
    let groups = await this.#deckGroups(status, deck);
    if (this.#mode !== 'test') {
      const enrollments = await this.#enrollments(learnerId);
      // Learned words stay in status for ordinary spaced review. Only unseen
      // cards need the lesson to remain unlocked after a correction or pause.
      const eligible = await Promise.all(groups.map(async (group) => {
        const enrollment = enrollments.find(row => (row.deckId ?? row.corpusId) === group.deckId);
        if (!enrollment?.linkedUnitId || !group.ids.some(id => (status.words[id]?.state ?? 'new') === 'new')) return true;
        const assessment = await this.#courseAccess?.({ learnerId, deckId: group.deckId });
        return Boolean(assessment && assessment.access?.allowed !== false && assessment.stage !== 'locked');
      }));
      groups = groups.filter((_group, index) => eligible[index]);
    }
    // A deck's release calendar holds back words not yet open today; met words review as usual.
    const day = this.#today();
    groups = groups.map((group) => {
      const closed = unreleasedWords(group, day);
      return closed.size ? { ...group, ids: group.ids.filter(id => !closed.has(id)) } : group;
    });
    const ids = orderNewWords(groups, { order, learnerId: learnerId ?? '' });
    return ids.filter((id) => (status.words[id]?.state ?? 'new') === 'new');
  }

  /** Reconcile a frozen introduction queue without changing any answered evidence. */
  #deferUnavailableIntroductions(status, dayFile, pool) {
    if (this.#mode === 'test' || !this.#courseAccess) return [];
    const round = dayFile.rounds.at(-1);
    if (round?.phase !== 'intro') return [];
    const allowed = new Set(pool);
    const deferred = round.newWords.filter(id => (status.words[id]?.state ?? 'new') === 'new' && !allowed.has(id));
    if (!deferred.length) return [];
    const blocked = new Set(deferred);
    const keep = id => !blocked.has(id);
    round.intro.index = round.newWords.slice(0, round.intro.index).filter(keep).length;
    round.newWords = round.newWords.filter(keep);
    round.words = round.words.filter(keep);
    round.stream.queue = round.stream.queue.filter(keep);
    if (round.intro.index >= round.newWords.length) round.phase = round.words.length ? 'stream' : 'done';
    return deferred;
  }

  /**
   * What the client may see (spec §3). Supported and exposure tasks (look,
   * copy, say-after, flashcards, the drill offer) carry the word card.
   * Unsupported tasks carry only their given half: read-aloud the text (the
   * native audio arrives with the take), dictation the audio, tiles / type /
   * say-from-cue the cue (and tiles the syllables). Graded items carry cue asset
   * ids but never the answer: a 2.2 item's prompt is the term (its answer is
   * the gloss, among the choices); 3.1 / 3.3 carry no term, and never the
   * term's audio. An anchor-side cue is always the whole bundle — gloss text,
   * plus picture and gloss-audio asset ids when they exist (ruling 2026-09-23).
   */
  #publicItem(item, ctx) {
    const { lexicon, media } = ctx;
    const entry = item.wordId ? lexicon.entries.get(item.wordId) : null;
    const assetsOf = (wordId) => {
      const m = media[wordId] ?? {};
      return { image: m.image ? m.ids.image : null, audio: m.audio ? m.ids.audio : null, glossAudio: m.glossAudio ? m.ids.glossAudio : null };
    };
    const assets = item.wordId ? assetsOf(item.wordId) : NO_ASSETS;
    const card = () => ({ wordId: entry.id, term: entry.term, gloss: entry.gloss, pronunciation: entry.pronunciation ?? null, kind: entry.kind, media: assets });
    // Every anchor-side cue goes out as the full bundle (ruling 2026-09-23:
    // text + picture + gloss audio together), built from the entry and media
    // as they are NOW — so an item stored under the old one-random-kind cue
    // ({type:'image'|'text'|'audio'}) in a day file from before the ruling is
    // served the new way too.
    const anchorCue = () => cueFor(entry, media[item.wordId] ?? {});
    const cueAssets = () => ({ image: assets.image, audio: null, glossAudio: assets.glossAudio });
    const cued = () => ({ ...item, cue: anchorCue(), assets: cueAssets() });
    const board = (b) => ({
      ...b,
      pairs: b.pairs.map((pair) => {
        if (pair.right?.type !== 'image') return pair;
        const other = lexicon.entries.get(pair.wordId);
        return { ...pair, right: { type: 'image', image: assetsOf(pair.wordId).image, text: other?.gloss ?? null } };
      }),
    });
    const speaking = item.type === 'say' ? item.mode : item.type === 'drill' ? item.step : null;

    if (item.type === 'flashcard' || item.type === 'copy' || item.type === 'drill-offer') return { ...item, word: card() };
    if (item.type === 'match') return { ...item, board: board(item.board) };
    if (item.type === 'listen') {
      return {
        ...item,
        words: (item.wordIds ?? []).map((id) => ({ id, entry: lexicon.entries.get(id), audio: assetsOf(id).audio }))
          .filter((row) => row.entry && row.audio).map((row) => ({ wordId: row.id, term: row.entry.term, audio: row.audio })),
      };
    }
    if (item.type === 'say' || item.type === 'drill') {
      if (speaking === 'read-aloud') return { ...item, word: { wordId: entry.id, term: entry.term, kind: entry.kind, media: NO_ASSETS } };
      if (speaking === 'say-from-cue' || speaking === 'type') return cued();
      if (item.type === 'drill' && item.step === 'match') return { ...item, board: board(item.board) };
      if (item.type === 'drill' && item.step === 'dictation') return { ...item, assets: { ...NO_ASSETS, audio: assets.audio } };
      if (item.type === 'drill' && item.step === 'tiles') {
        return cued();
      }
      return { ...item, word: card() }; // look, copy, say-after
    }
    if (item.type === 'typed' || item.type === 'choice') {
      // On 3.1 / 3.3 the gloss IS the cue (the term is the answer): the whole
      // anchor bundle goes out, text always, picture and gloss clip when they
      // exist. 2.2 carries only the term's audio on the hear channel.
      const anchorSide = item.task === '3.1' || item.task === '3.3';
      const graded = {
        image: anchorSide ? assets.image : null,
        // 2.2 on the hear channel plays the term; so does a 1.4 graded dictation, whose whole prompt it is.
        // Dictation's D.1 (hear it, pick its spelling) plays the term too.
        audio: (item.task === '2.2' && item.channel === 'hear') || item.task === '1.4' || item.task === 'D.1' ? assets.audio : null,
        glossAudio: anchorSide ? assets.glossAudio : null,
      };
      const cue = anchorSide ? anchorCue() : item.cue;
      return { ...item, ...(item.task === '2.2' ? { prompt: entry.term } : {}), ...(cue ? { cue } : {}), assets: graded };
    }
    return item;
  }

  #progress({ dayFile, settings, status, day, pool, sittingId = null, dictation = null }) {
    const round = dayFile.rounds.find((r) => r.phase !== 'done') ?? null;
    const rechecksLeft = dayFile.rechecks.order.filter((id) => !dayFile.rechecks.answered[id]).length;
    const drill = (dayFile.drills ?? []).find((d) => !d.done) ?? null;
    const run = dayFile.practice;
    const practicing = Boolean(dayFile.doneAt && dayFile.summarySeen && run && run.index < run.queue.length);
    let phase = 'summary';
    const dictRun = dayFile.dictation;
    // Dictating: the open run of this sitting, or its ending not yet acknowledged.
    const dictating = Boolean(sittingId && dictRun && dictRun.sittingId === sittingId
      && ((!dictRun.ended && dictation?.week === dictRun.week) || (dictRun.ended === 'done' && !dictRun.readyAt)));
    if (dictating) phase = 'dictation';
    else if (dayFile.courseReview?.index < dayFile.courseReview?.queue.length) phase = 'course-review';
    else if (rechecksLeft) phase = 'rechecks';
    else if (drill) phase = 'drill';
    else if (round) phase = 'round';
    else if (practicing) phase = 'practice';
    return {
      phase,
      rechecksLeft,
      drill: drill ? { at: drill.index + 1, of: drill.steps.length } : null,
      practice: practicing ? { mode: run.mode, at: run.index + 1, of: run.queue.length } : null,
      round: round ? {
        index: dayFile.rounds.indexOf(round) + 1, kind: round.kind, extra: round.extra === true, size: round.words.length, phase: round.phase,
        remainingInStream: round.stream.queue.length, quizLeft: round.quiz.queue.length - round.quiz.index,
        // Learn › Sort › Quiz › Match: whether this round shows (or will show) the Match step.
        hasMatch: roundHasMatch(round),
      } : null,
      activeMs: dayFile.activeMs,
      capMs: settings.session.capMinutes * 60000,
      // The sitting header's step trail (Review › Learn › Sort › Quiz ›
      // Practice) reads these rather than guessing from item types: whether
      // the day has a Review step at all, how many rounds are behind the
      // child, whether today's round work includes new words (a carry round
      // has no Learn), and whether the goal is met (Practice unlocks).
      rechecksTotal: dayFile.rechecks.order.length,
      roundsDone: dayFile.rounds.filter((r) => r.phase === 'done').length,
      // Whether any round today held its guided Match (the trail keeps the step once past it).
      matchToday: dayFile.rounds.some((r) => Boolean(r.match)),
      learnToday: this.#learnToday({ dayFile, round, status, day, pool, settings }),
      // New words planned at open, none met yet: a catch-up round says why
      // it comes first, and the summary says "new words next time".
      newWordsHeld: newWordsHeld({ dayFile, status, pool: pool ?? [], settings }),
      doneToday: Boolean(dayFile.doneAt),
    };
  }

  // Whether today's round work includes new words (the trail's Learn step).
  // With no round planned yet — Review runs first — the plan preview answers,
  // so the trail keeps one shape from the first recheck to the last round.
  #learnToday({ dayFile, round, status, day, pool, settings }) {
    if (round) return round.newWords?.length > 0;
    if (dayFile.rounds.some((r) => r.newWords?.length > 0)) return true;
    if (dayFile.doneAt || !status) return false;
    return introPreview({ status, dayFile, day, pool: pool ?? [], settings }).newCount > 0;
  }

  #parseSitting(sittingId) {
    if (typeof sittingId !== 'string' || !sittingId) throw new EntityNotFoundError('card-ladder sitting', sittingId);
    const test = sittingId.startsWith(TEST_PREFIX);
    // Live ids are refused by the test service and vice versa (spec §8).
    if (test !== (this.#mode === 'test')) throw new EntityNotFoundError('card-ladder sitting', sittingId);
    const parts = sittingId.slice(test ? TEST_PREFIX.length : 0).split('.');
    if (parts.length < 3 || !parts[0] || !parts[1]) throw new EntityNotFoundError('card-ladder sitting', sittingId);
    return { pkg: parts[0], token: parts[1] };
  }

  /** A sitting belongs to its study day: after the day boundary it 404s and the client reopens. */
  async #context(userId, sittingId) {
    if (typeof userId !== 'string' || !userId) throw new ValidationError('userId is required');
    const { pkg, token } = this.#parseSitting(sittingId);
    let store;
    try { store = this.#stores.forToken(token); } catch { throw new EntityNotFoundError('card-ladder sitting', sittingId); }
    const day = this.#today();
    const dayFile = store.readDay(userId, pkg, day);
    const sitting = dayFile.sittings?.[sittingId];
    if (!sitting) throw new EntityNotFoundError('card-ladder sitting', sittingId);
    await this.#assertStudyAccess(userId, sitting.deckId);
    const { deck, lexicon, pkg: deckPkg } = await this.#load(sitting.deckId);
    // A deck moved to another package must not write across packages.
    if (deckPkg !== pkg) throw new EntityNotFoundError('card-ladder sitting', sittingId);
    const status = store.readStatus(userId, pkg);
    const media = this.#media(deck, lexicon);
    const settings = this.#daySettings(dayFile, { store, userId, pkg });
    const pool = await this.#pool(status, deck, userId);
    const ctx = { status, dayFile, day, lexicon, media, pool, settings, learnerId: userId, sittingId };
    // A dictation run is served only in the sitting that started it; its word state lives in the progress file.
    if (dayFile.dictation && !dayFile.dictation.ended && dayFile.dictation.sittingId === sittingId) {
      const read = this.#readDictation(store, userId, pkg, lexicon, media, deck);
      // A review run carries its own word state (final review I2).
      ctx.dictation = dayFile.dictation.review && read.list
        ? dictationState(read.list, { week: dayFile.dictation.week, words: dayFile.dictation.review.words }, this.#dictationRules(lexicon, media, deck))
        : read.state;
    }
    const deferred = this.#deferUnavailableIntroductions(status, structuredClone(dayFile), pool);
    if (deferred.length) {
      const out = this.#transact(store, userId, pkg, day, sitting.deckId, ({ status, dayFile }) => {
        this.#deferUnavailableIntroductions(status, dayFile, pool);
        return openDay({ ...ctx, status, dayFile, deckId: deck.id, at: isoWithOffset(this.#now(), this.#timezone), capabilities: dayFile.capabilities });
      });
      ctx.status = out.status; ctx.dayFile = out.dayFile;
      this.#logger.info?.('school.card-ladder.course-introductions-deferred', { learnerId: userId, deckId: deck.id, wordIds: deferred });
    }
    return { store, pkg, lexicon, media, settings, ctx, day, sitting, deck };
  }

  /**
   * Sitting bookkeeping for a request on `sittingId` (spec §4 server idle
   * close). Mutates `dayFile`: a closed `sittingId` is reopened (a reload or a
   * late answer must never 404), and when the day has had no input for 5 min
   * every OTHER open sitting is closed as idle at the last input. Returns what
   * changed, for logging.
   */
  #housekeep(dayFile, sittingId, nowMs, { reopen = true } = {}) {
    const changes = { reopened: false, idleClosed: [], idleMs: null, lastItemId: null };
    const own = dayFile.sittings[sittingId];
    if (reopen && own?.closedAt) {
      dayFile.sittings[sittingId] = { ...own, closedAt: null, reason: null };
      changes.reopened = true;
    }
    if (typeof dayFile.lastInputAt === 'number' && nowMs - dayFile.lastInputAt >= IDLE_CLOSE_MS) {
      const closedAt = isoWithOffset(dayFile.lastInputAt, this.#timezone);
      for (const [id, row] of Object.entries(dayFile.sittings)) {
        if (id === sittingId || row?.closedAt) continue;
        dayFile.sittings[id] = { ...row, closedAt, reason: 'idle' };
        changes.idleClosed.push(id);
      }
      if (changes.idleClosed.length) {
        changes.idleMs = nowMs - dayFile.lastInputAt;
        changes.lastItemId = lastAnsweredItemId(dayFile);
      }
    }
    return changes;
  }

  /**
   * `onScreen` (optional) is the item the day is on now — what an abandoned
   * sitting was left showing, since the day's state is shared by its sittings.
   */
  #logHousekeeping(userId, sittingId, dayFile, changes, onScreen = null) {
    if (changes.reopened) this.#logger.info?.('school.card-ladder.reopened', { learnerId: userId, sittingId, mode: this.#mode });
    for (const id of changes.idleClosed) {
      this.#logger.info?.('school.card-ladder.closed', {
        learnerId: userId, sittingId: id, mode: this.#mode, reason: 'idle', closedAt: dayFile.sittings[id]?.closedAt ?? null, by: sittingId,
      });
      // Never closed by its own client (no Leave, no Done, no unmount beacon):
      // the tab was killed, slept or walked away from. Seen only now, at the
      // next request on another sitting of the same day.
      this.#logger.warn?.('school.card-ladder.sitting.abandoned', {
        learnerId: userId, sittingId: id, mode: this.#mode, by: sittingId, lastItemId: changes.lastItemId ?? null,
        onScreenItemId: onScreen?.id ?? null, onScreenType: onScreen?.type ?? null, idleMs: changes.idleMs ?? null,
        openedAt: dayFile.sittings[id]?.openedAt ?? null, closedAt: dayFile.sittings[id]?.closedAt ?? null,
      });
    }
  }

  /**
   * Sequencing (spec §8): why the item now on screen was chosen
   * (`item.served`), every plan change between two day files (`day.planned`,
   * `round.planned`, `round.phase`, `drill.started`, `drill.finished`,
   * `day.done`), and every word whose sign-off prerequisites moved
   * (`word.prereqs`). `itemId` is the answer that caused the change (null on open).
   */
  #logSequencing({ learnerId, sittingId, pkg, day, itemId = null }, { ctx, item = null, via = null, beforeDay = null, beforeWords = null }) {
    const base = { learnerId, sittingId, mode: this.#mode, package: pkg, day };
    for (const change of dayChanges(beforeDay, ctx.dayFile)) {
      this.#logger.info?.(`school.card-ladder.${change.event}`, { ...base, itemId, ...change.data });
    }
    if (beforeWords) {
      for (const row of prereqChanges(beforeWords, ctx.status.words)) {
        this.#logger.info?.('school.card-ladder.word.prereqs', { ...base, itemId, ...row });
      }
    }
    if (item) {
      this.#logger.info?.('school.card-ladder.item.served', {
        ...base, itemId: item.id, type: item.type, task: item.task ?? null, source: item.source ?? null,
        wordId: item.wordId ?? null, ...servedWhy(ctx, item), via, after: itemId,
      });
    }
  }

  /**
   * `ok: false` means the read failed and nothing was observed — the caller
   * must NOT advance `lastFoldedDay`, or the un-scanned window is skipped forever.
   */
  #readAttempts(userId, status, today) {
    if (typeof this.#attempts?.readAttemptsInRange !== 'function') return { attempts: [], ok: false };
    // Attempt shards are keyed by the UTC date of `at`, not the study day, so
    // the window reaches one day past today and two days behind the last fold.
    const from = status.lastFoldedDay ? addDays(status.lastFoldedDay, -FOLD_SKEW_DAYS) : addDays(today, -FOLD_LOOKBACK_DAYS);
    try {
      return { attempts: this.#attempts.readAttemptsInRange(userId, from, addDays(today, 1)) ?? [], ok: true };
    } catch (error) {
      this.#logger.warn?.('school.card-ladder.attempts-unreadable', { learnerId: userId, mode: this.#mode, error: error.message });
      return { attempts: [], ok: false };
    }
  }

  /**
   * Every printed quiz whose rows fold into THIS package: every deck sharing
   * the lexicon (spec §8 Printed quiz, legacy per-deck ids), never another
   * package's — word ids are unique only within a package.
   */
  async #quizDocumentIds(deck) {
    const ids = new Set([quizDocumentIdFor(deck.id)]);
    try {
      for (const other of await this.#decks.listFlashcardDecks?.() ?? []) {
        if (Array.isArray(other?.words) && typeof other.id === 'string' && other.lexicon === deck.lexicon) ids.add(quizDocumentIdFor(other.id));
      }
    } catch (error) {
      this.#logger.warn?.('school.card-ladder.decks-unlisted', { error: error.message });
    }
    return [...ids];
  }

  /**
   * `{ learnerId, deckDir, pkg }` is passed through as `learner` to
   * `foldPaperAttempts` (spec §8 Printed quiz), which parses a scanned row's
   * `docId` under `{deckDir, pkg}` via `parseLearnerQuizId`: a parsed
   * `learnerId` matching THIS learner's own is accepted, a parsed id for a
   * different learnerId under the same package (a sibling's sheet) is
   * refused rather than silently ignored.
   */
  #fold(status, { attempts, ok }, quizDocumentIds, today, settings, { learnerId, deckDir, pkg }) {
    const out = foldPaperAttempts({
      status, attempts, quizDocumentIds, learner: { deckDir, pkg, learnerId },
      dayOf: (at) => studyDayForInstant(Date.parse(at), { timezone: this.#timezone }),
      settings: { afterMisses: settings.drill.afterMisses, gapScale: settings.review.gapScale },
    });
    if (ok) out.status.lastFoldedDay = today;
    out.transitions = wordTransitions(status.words, out.status.words, 'paper');
    for (const row of out.refused) {
      this.#logger.warn?.('school.card-ladder.fold-refused', { learnerId, package: pkg, mode: this.#mode, ...row });
    }
    return out;
  }

  #logFold(learnerId, pkg, folded, source) {
    if (!folded.length) return;
    this.#logger.info?.('school.card-ladder.folded', {
      learnerId, package: pkg, source, mode: this.#mode, count: folded.length,
      demoted: folded.filter((row) => !row.correct).map((row) => row.wordId),
    });
  }

  /** One `transition` event per word whose state or stage changed (spec §8). */
  #logTransitions({ learnerId, sittingId = null, pkg, day, itemId = null }, transitions, words = null) {
    for (const row of transitions ?? []) {
      const word = words?.[row.wordId];
      this.#logger.info?.('school.card-ladder.transition', {
        learnerId, sittingId, mode: this.#mode, package: pkg, day, itemId,
        wordId: row.wordId, from: row.from, to: row.to, source: row.source,
        // Where the word stands on the sign-off ladder after this move.
        ...(word ? { prereqs: { recognizedCount: word.recognizedCount ?? 0, matched: word.matched === true, typedSignedOff: word.typedSignedOff ?? null } } : {}),
      });
    }
  }

  #newSittingId(pkg, token) {
    this.#counter += 1;
    return `${this.#mode === 'test' ? TEST_PREFIX : ''}${pkg}.${token}.${this.#now().toString(36)}${this.#counter.toString(36)}`;
  }

  /** Opens (or resumes) today's sitting. Paper attempts fold here — only here, never mid-sitting. */
  async open({ userId, deckId, scenario = null, capabilities = null } = {}) {
    const caps = { microphone: capabilities?.microphone === true };
    await this.#assertStudyAccess(userId, deckId);
    const { deck, lexicon, pkg } = await this.#load(deckId);
    const openedMs = this.#now();
    const day = this.#today(openedMs);
    const { store, token } = this.#stores.open(userId, pkg, day, { scenario, deck, lexicon });
    const sittingId = this.#newSittingId(pkg, token);
    const media = this.#media(deck, lexicon);
    const before = store.readStatus(userId, pkg);
    const read = this.#readAttempts(userId, before, day);
    const quizDocumentIds = read.attempts.length ? await this.#quizDocumentIds(deck) : [];
    // `#pool` includes this deck; a paper fold only demotes introduced words,
    // so the new-word pool is the same before and after the fold.
    const pool = await this.#pool(before, deck, userId);
    let folded = [];
    let foldTransitions = [];
    let changes = { reopened: false, idleClosed: [] };
    let beforeDay = null;
    let deferredCardIds = [];
    const next = this.#transact(store, userId, pkg, day, deckId, ({ status, dayFile }) => {
      beforeDay = structuredClone(dayFile);
      const settings = this.#daySettings(dayFile, { store, userId, pkg });
      const afterFold = this.#fold(status, read, quizDocumentIds, day, settings, { learnerId: userId, deckDir: deckDirOf(deck.id), pkg });
      folded = afterFold.folded;
      foldTransitions = afterFold.transitions;
      deferredCardIds = this.#deferUnavailableIntroductions(afterFold.status, dayFile, pool);
      const opened = openDay({ status: afterFold.status, dayFile, day, deckId, pool, settings, learnerId: userId, at: isoWithOffset(openedMs, this.#timezone), media, capabilities: caps, lexicon });
      changes = this.#housekeep(opened.dayFile, sittingId, openedMs, { reopen: false });
      opened.dayFile.sittings[sittingId] = { deckId, openedAt: isoWithOffset(openedMs, this.#timezone), closedAt: null, reason: null };
      return opened;
    });
    const settings = this.#daySettings(next.dayFile, { store, userId, pkg });
    const ctx = { status: next.status, dayFile: next.dayFile, day, lexicon, media, pool, settings, learnerId: userId };
    const item = currentItem(ctx);
    this.#logHousekeeping(userId, sittingId, next.dayFile, changes, item);
    const progress = this.#progress(ctx);
    this.#logFold(userId, pkg, folded, 'open');
    this.#logTransitions({ learnerId: userId, sittingId, pkg, day }, foldTransitions, next.status.words);
    this.#logger.info?.('school.card-ladder.opened', {
      learnerId: userId, deckId, package: pkg, day, sittingId, mode: this.#mode, scenario, folded: folded.length, microphone: caps.microphone,
      first: item.type, phase: progress.phase, deferredCardIds, rechecks: next.dayFile.atOpen?.dueRechecks?.length ?? 0,
    });
    this.#logSequencing({ learnerId: userId, sittingId, pkg, day }, { ctx, item, via: 'open', beforeDay, beforeWords: before.words });
    return {
      sittingId, day, package: pkg, title: lexicon.program.title,
      // `language`/`gloss` are the pre-rename names of the two sides' languages;
      // `target`/`anchor` say the same with the target's script (the keypad/IME seam).
      language: { code: lexicon.language.code, name: lexicon.language.name },
      gloss: { code: lexicon.gloss.code, name: lexicon.gloss.name },
      target: { code: lexicon.language.code, name: lexicon.language.name, script: lexicon.targetScript ?? scriptFor(lexicon.language.code) },
      anchor: { code: lexicon.gloss.code, name: lexicon.gloss.name },
      item: this.#publicItem(item, ctx), progress,
    };
  }

  /** The client's response object is passed to the engine unchanged (no default flags spread in). */
  async respond({ userId, sittingId, itemId, response } = {}) {
    const { store, pkg, lexicon, ctx, day, deck } = await this.#context(userId, sittingId);
    if (typeof itemId !== 'string' || !itemId) throw new ValidationError('itemId is required');
    const replaced = this.#dictationReplaced({ store, userId, pkg, sittingId, day, ctx, itemId });
    if (replaced) return replaced;
    const item = currentItem(ctx);
    let verdict = null;
    if (item.id === itemId && item.type === 'typed' && !ctx.dayFile.items[itemId] && typeof response?.typed === 'string') {
      const entry = lexicon.entries.get(item.wordId);
      // With meanings: the judge's model tells a synonym from another word by them.
      const otherWords = [
        ...Object.entries(ctx.status.words).filter(([id, w]) => id !== entry.id && w.state !== 'new')
          .map(([id]) => lexicon.entries.get(id)).filter(Boolean).map((other) => ({ term: other.term, gloss: other.gloss ?? null })),
        ...(entry.decoys?.term ?? []).map((term) => ({ term, gloss: null })),
      ].filter((other) => other.term);
      // The target side's script and language: the judge's one script seam.
      verdict = await this.#judge.judge({
        // 1.4: the child heard the word (dictation sign-off), not its meaning.
        pkg, entry, typed: response.typed, otherWords, heard: item.task === '1.4',
        targetScript: lexicon.targetScript ?? scriptFor(lexicon.language?.code), targetLanguage: (lexicon.targetLanguage ?? lexicon.language)?.name ?? null,
      });
    }
    const ms = this.#now();
    const at = isoWithOffset(ms, this.#timezone);
    let changes = null;
    let transitions = [];
    let graded = null;
    let attempt = null;
    const out = this.#transact(store, userId, pkg, day, ctx.dayFile.sittings[sittingId].deckId, ({ status, dayFile }) => {
      if (!dayFile.sittings?.[sittingId]) throw new EntityNotFoundError('card-ladder sitting', sittingId);
      // Race: another request answered while this one was being prepared, so
      // the typed item now on screen was never judged here. Stale, not a
      // missing verdict.
      const fresh = currentItem({ ...ctx, status, dayFile });
      if (verdict === null && fresh.type === 'typed' && fresh.id === itemId && !dayFile.items[itemId] && typeof response?.typed === 'string') {
        throw new ValidationError('stale item');
      }
      changes = this.#housekeep(dayFile, sittingId, ms);
      // Dictation runs on separate time (ruling 10): its answers never reach
      // addActiveTime. They do move the clock's reference, so the next regular
      // answer counts only the time since this one — none of the dictation.
      // A re-sent dictation answer (the item already answered) is dictation time too (M1).
      const dictationAnswer = (fresh.source === 'dictation' && fresh.id === itemId) || dayFile.items?.[itemId]?.source === 'dictation';
      const timed = dictationAnswer ? { ...dayFile, lastInputAt: ms } : addActiveTime(dayFile, ms);
      const step = respond({ ...ctx, status, dayFile: timed }, itemId, response, { at, verdict });
      ({ transitions, graded } = step);
      attempt = step.dictation ?? null;
      return { status: step.status, dayFile: step.dayFile, result: step.result };
    });
    const nextCtx = { ...ctx, status: out.status, dayFile: out.dayFile };
    if (attempt?.review) {
      nextCtx.dictation = attempt.state;
      this.#logger.info?.('school.card-ladder.dictation.attempt', {
        learnerId: userId, package: pkg, week: attempt.week, sittingId, wordId: attempt.wordId, step: attempt.step, pass: attempt.pass,
        dontKnow: attempt.dontKnow, next: attempt.word.step, blindPasses: attempt.word.blindPasses, remaining: attempt.remaining, review: true,
      });
    } else if (attempt) {
      try {
        nextCtx.dictation = this.#recordDictationAttempt({ store, userId, pkg, sittingId, lexicon, media: ctx.media, deck }, attempt);
      } catch (error) {
        // The answer is on the day file but its progress is not (M2): end the
        // run so the sitting falls back to its ladder instead of re-serving
        // a word whose state can no longer be saved.
        this.#logger.warn?.('school.card-ladder.dictation.progress-write-failed', {
          learnerId: userId, package: pkg, week: attempt.week, sittingId, wordId: attempt.wordId, error: error.message,
        });
        const at = isoWithOffset(this.#now(), this.#timezone);
        const ended = this.#transact(store, userId, pkg, day, ctx.dayFile.sittings[sittingId].deckId, ({ status, dayFile }) => ({
          status, dayFile: dayFile.dictation ? { ...dayFile, dictation: { ...dayFile.dictation, ended: 'stopped', endedAt: at } } : dayFile,
        }));
        nextCtx.status = ended.status; nextCtx.dayFile = ended.dayFile; nextCtx.dictation = undefined;
      }
    }
    if (item.id === itemId && item.source === 'dictation' && out.result?.stopped === true) {
      this.#logger.info?.('school.card-ladder.dictation.exited', {
        learnerId: userId, package: pkg, week: ctx.dictation?.week ?? null, remaining: ctx.dictation?.remaining ?? null, sittingId, reason: 'stop',
      });
    }
    if (item.id === itemId && item.type === 'dictation-ready') {
      this.#logger.info?.('school.card-ladder.dictation.ready-seen', { learnerId: userId, package: pkg, sittingId, week: item.week, ready: item.ready });
    }
    const nextItem = currentItem(nextCtx);
    this.#logHousekeeping(userId, sittingId, out.dayFile, changes, nextItem);
    // Every response is `answered`; only a graded answer (verify, recheck,
    // practice Quiz me) is also `graded` (spec §8 events).
    this.#logger.info?.('school.card-ladder.answered', {
      learnerId: userId, sittingId, mode: this.#mode, itemId, type: item.id === itemId ? item.type : null,
      task: item.id === itemId ? item.task ?? null : null, wordId: item.id === itemId ? item.wordId ?? null : null,
      correct: out.result?.correct ?? null, score: verdict?.score ?? null, judge: verdict?.judge ?? null,
      next: nextItem.type, doneAt: out.dayFile.doneAt ?? null,
    });
    if (graded) {
      this.#logger.info?.('school.card-ladder.graded', {
        learnerId: userId, sittingId, mode: this.#mode, package: pkg, day, itemId,
        wordId: graded.wordId, task: graded.task, source: graded.source, correct: graded.correct,
        score: graded.score ?? null, judge: graded.judge ?? null,
      });
    }
    this.#logTransitions({ learnerId: userId, sittingId, pkg, day, itemId }, transitions, out.status.words);
    // A retry keeps the same item on screen: nothing new was served.
    this.#logSequencing({ learnerId: userId, sittingId, pkg, day, itemId }, {
      ctx: nextCtx, item: nextItem.id === itemId ? null : nextItem, via: 'respond', beforeDay: ctx.dayFile, beforeWords: ctx.status.words,
    });
    return {
      result: this.#withAnswerAudio(out.result, out.dayFile.items?.[itemId]?.wordId ?? (item.id === itemId ? item.wordId : null), ctx),
      item: this.#publicItem(nextItem, nextCtx), progress: this.#progress(nextCtx),
      ...(attempt ? {
        dictation: {
          wordId: attempt.wordId, step: attempt.step, next: attempt.word.step, pass: attempt.pass, dontKnow: attempt.dontKnow,
          blindPasses: attempt.word.blindPasses, remaining: attempt.remaining, done: attempt.done,
          needsRecording: (attempt.state?.excluded ?? []).filter((row) => row.reason === 'needs-recording').map((row) => row.id),
          unknown: (attempt.state?.excluded ?? []).filter((row) => row.reason === 'unknown-word').map((row) => row.id),
        },
      } : {}),
    };
  }

  /**
   * UX audit #8: the week's tags changed while a run was open. An answer to
   * the old run's item is not recorded against a list that no longer exists;
   * the run ends `replaced` and the response says so —
   * `dictation: { replaced: true }` — so the browser restarts on the new
   * week instead of the answer vanishing. Null when nothing was replaced.
   */
  #dictationReplaced({ store, userId, pkg, sittingId, day, ctx, itemId }) {
    const run = ctx.dayFile.dictation;
    if (!run || run.ended || run.sittingId !== sittingId || !itemId.startsWith(`${run.id}:`) || ctx.dayFile.items[itemId]) return null;
    const listWeek = ctx.dictation?.week ?? null;
    if (listWeek === run.week) return null;
    const at = isoWithOffset(this.#now(), this.#timezone);
    const out = this.#transact(store, userId, pkg, day, ctx.dayFile.sittings[sittingId].deckId, ({ status, dayFile }) => {
      if (dayFile.dictation?.id === run.id && !dayFile.dictation.ended) dayFile.dictation = { ...dayFile.dictation, ended: 'replaced', endedAt: at };
      return { status, dayFile };
    });
    this.#logger.warn?.('school.card-ladder.dictation.replaced', { learnerId: userId, package: pkg, sittingId, week: run.week, listWeek, itemId });
    const nextCtx = { ...ctx, status: out.status, dayFile: out.dayFile };
    const nextItem = currentItem(nextCtx);
    return { result: null, item: this.#publicItem(nextItem, nextCtx), progress: this.#progress(nextCtx), dictation: { replaced: true, week: listWeek, previousWeek: run.week } };
  }

  /**
   * Persists one dictation attempt under the LIST's week. The progress file
   * is re-read here: rows from another week are dropped, never merged. Logs
   * the attempt, and the list's finish once (only the answer that finished it
   * carries `done`; the run then ends). Returns the state for the next item.
   */
  #recordDictationAttempt({ store, userId, pkg, sittingId, lexicon, media, deck }, attempt) {
    // The list is the request's own lexicon, already checked against the run's week (#dictationReplaced).
    const read = this.#readDictation(store, userId, pkg, lexicon, media, deck);
    const week = attempt.week;
    const kept = read.progress?.week === week && read.progress.words && typeof read.progress.words === 'object' ? read.progress.words : {};
    store.writeDictationProgress(userId, pkg, { week, words: { ...structuredClone(kept), [attempt.wordId]: attempt.word } });
    const base = { learnerId: userId, package: pkg, week };
    this.#logger.info?.('school.card-ladder.dictation.attempt', {
      ...base, sittingId, wordId: attempt.wordId, step: attempt.step, pass: attempt.pass, dontKnow: attempt.dontKnow,
      next: attempt.word.step, blindPasses: attempt.word.blindPasses, remaining: attempt.remaining,
    });
    if (attempt.done) this.#logger.info?.('school.card-ladder.dictation.done', base);
    return dictationState(read.list, { week, words: { ...kept, [attempt.wordId]: attempt.word } }, this.#dictationRules(lexicon, media, deck));
  }

  /**
   * Once the Korean answer is on screen (a result that names the term), its
   * native clip goes with it, so the result panel's Listen can play the right
   * word. Only then: a result that withholds the answer (a dictation retry)
   * gets no audio either, and a 2.2 result's answer is the gloss, not the term.
   */
  #withAnswerAudio(result, wordId, ctx) {
    if (!result?.answer || !wordId) return result;
    const entry = ctx.lexicon.entries.get(wordId);
    const m = ctx.media?.[wordId];
    if (!entry || result.answer !== entry.term || !m?.audio) return result;
    return { ...result, audio: m.ids.audio };
  }

  async get({ userId, sittingId } = {}) {
    const { store, pkg, day, settings, ctx } = await this.#context(userId, sittingId);
    const nowMs = this.#now();
    // Only write when bookkeeping changes something: a reload is otherwise read-only.
    const probe = this.#housekeep(structuredClone(ctx.dayFile), sittingId, nowMs);
    if (probe.reopened || probe.idleClosed.length) {
      let changes = null;
      const out = this.#transact(store, userId, pkg, day, ctx.dayFile.sittings[sittingId].deckId, ({ status, dayFile }) => {
        changes = this.#housekeep(dayFile, sittingId, nowMs);
        return { status, dayFile };
      });
      ctx.dayFile = out.dayFile;
      ctx.status = out.status;
      this.#logHousekeeping(userId, sittingId, out.dayFile, changes, currentItem(ctx));
    }
    const item = currentItem(ctx);
    // A resync or reload re-serves whatever is current; logged so a trace
    // can tell a re-render from a new item.
    this.#logSequencing({ learnerId: userId, sittingId, pkg, day }, { ctx, item, via: 'get' });
    return { item: this.#publicItem(item, ctx), progress: this.#progress({ ...ctx, settings }) };
  }

  /**
   * Keeps one spoken take (spec §3: speaking is never graded) for the item on
   * screen, which must be a speaking step — a `say` item, or a drill's
   * say-after / read-aloud / say-from-cue. Reads the day, writes only the
   * take: status and the day file are never touched. For the unsupported steps
   * the native model is revealed now that the take exists.
   */
  async saveRecording({ userId, sittingId, itemId, buffer, ext = 'webm' } = {}) {
    const { pkg, day, ctx, media } = await this.#context(userId, sittingId);
    if (typeof itemId !== 'string' || !itemId) throw new ValidationError('itemId is required');
    const item = currentItem(ctx);
    if (item.id !== itemId) throw new ValidationError('stale item');
    const step = item.type === 'say' ? item.mode : item.type === 'drill' ? item.step : null;
    if (!SPEAKING.has(step)) throw new ValidationError('this item is not a speaking step');
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new ValidationError('an audio recording is required');
    const format = String(ext ?? 'webm').toLowerCase();
    if (!RECORDING_EXTS.has(format)) throw new ValidationError(`unsupported recording format '${ext}'`);
    if (!this.#recordings) throw new ValidationError('card-ladder recordings are not configured');
    const saved = await this.#recordings.save({ package: pkg, learnerId: userId, day, wordId: item.wordId, buffer, ext: format });
    const take = saved?.take ?? null;
    this.#logger.info?.('school.card-ladder.recorded', {
      learnerId: userId, sittingId, mode: this.#mode, itemId, wordId: item.wordId, step, take, bytes: buffer.length,
    });
    if (!REVEAL_AFTER_TAKE.has(step)) return { take };
    const entry = ctx.lexicon.entries.get(item.wordId);
    const m = media[item.wordId] ?? {};
    return { take, reveal: { term: entry.term, audio: m.audio ? m.ids.audio : null } };
  }

  /** Opens a practice run (spec §6 practice menu); the engine refuses one before today's goal. */
  /** The practice menu, on request at any time (owner 2026-11-06: review anytime). Read only. */
  async menu({ userId, sittingId } = {}) {
    const { ctx } = await this.#context(userId, sittingId);
    const item = practiceMenu(ctx);
    this.#logger.info?.('school.card-ladder.menu-requested', { learnerId: userId, sittingId, doneAt: ctx.dayFile.doneAt ?? null });
    return { item: this.#publicItem(item, ctx), progress: this.#progress(ctx) };
  }

  async practice({ userId, sittingId, mode, help = true, filter = 'introduced', chosen = [], frontSide = 'term' } = {}) {
    const { store, pkg, day, ctx, settings } = await this.#context(userId, sittingId);
    const ms = this.#now();
    let changes = null;
    const out = this.#transact(store, userId, pkg, day, ctx.dayFile.sittings[sittingId].deckId, ({ status, dayFile }) => {
      if (!dayFile.sittings?.[sittingId]) throw new EntityNotFoundError('card-ladder sitting', sittingId);
      changes = this.#housekeep(dayFile, sittingId, ms);
      return startPractice({ ...ctx, status, dayFile: addActiveTime(dayFile, ms) }, { mode, help, filter, chosen, frontSide });
    });
    const nextCtx = { ...ctx, status: out.status, dayFile: out.dayFile };
    const item = currentItem(nextCtx);
    this.#logHousekeeping(userId, sittingId, out.dayFile, changes, item);
    this.#logger.info?.('school.card-ladder.practice', {
      learnerId: userId, sittingId, mode: this.#mode, practice: mode, help: help !== false, filter,
      size: out.dayFile.practice?.queue?.length ?? 0, first: item.type,
    });
    this.#logSequencing({ learnerId: userId, sittingId, pkg, day }, { ctx: nextCtx, item, via: 'practice' });
    return { item: this.#publicItem(item, nextCtx), progress: this.#progress({ ...nextCtx, settings }) };
  }

  /**
   * Learn more words (owner ruling 2026-09-23: never block extra learning;
   * credit stays capped at the daily goal). One more guided round over the
   * next new words, from the menu or the Done summary — past the session cap
   * too. The day's credit (`doneAt`) never moves. Test mode writes its shadow.
   */
  async learnMore({ userId, sittingId } = {}) {
    const { store, pkg, day, ctx, settings } = await this.#context(userId, sittingId);
    const ms = this.#now();
    const at = isoWithOffset(ms, this.#timezone);
    let changes = null;
    const out = this.#transact(store, userId, pkg, day, ctx.dayFile.sittings[sittingId].deckId, ({ status, dayFile }) => {
      if (!dayFile.sittings?.[sittingId]) throw new EntityNotFoundError('card-ladder sitting', sittingId);
      changes = this.#housekeep(dayFile, sittingId, ms);
      return learnMore({ ...ctx, status, dayFile: addActiveTime(dayFile, ms) }, { at });
    });
    const nextCtx = { ...ctx, status: out.status, dayFile: out.dayFile };
    const item = currentItem(nextCtx);
    const round = out.dayFile.rounds.at(-1);
    this.#logHousekeeping(userId, sittingId, out.dayFile, changes, item);
    this.#logger.info?.('school.card-ladder.learn-more', {
      learnerId: userId, sittingId, mode: this.#mode, package: pkg, day, round: round?.id ?? null,
      newIds: round?.newWords ?? [], doneAt: out.dayFile.doneAt ?? null, activeMs: out.dayFile.activeMs,
    });
    this.#logSequencing({ learnerId: userId, sittingId, pkg, day }, { ctx: nextCtx, item, via: 'learn-more', beforeDay: ctx.dayFile });
    return { item: this.#publicItem(item, nextCtx), progress: this.#progress({ ...nextCtx, settings }) };
  }

  /**
   * My words (spec §4 API): every word of the package the learner can meet —
   * the decks seen, in order, then this deck — plus any other introduced word,
   * with its ladder state. Test mode reads the named sitting's shadow.
   */
  async words({ userId, deckId, sittingId = null } = {}) {
    await this.#assertAssigned(userId, deckId);
    const { deck, lexicon, pkg } = await this.#load(deckId);
    let status;
    if (sittingId) {
      const found = await this.#context(userId, sittingId);
      if (found.pkg !== pkg) throw new ValidationError('the sitting belongs to another word package');
      status = found.ctx.status;
    } else if (this.#mode === 'test') {
      throw new ValidationError('sittingId is required in test mode');
    } else {
      const { store } = this.#stores.open(userId, pkg, this.#today(), { readOnly: true });
      status = store.readStatus(userId, pkg);
    }
    const ids = await this.#deckOrder(status, deck);
    for (const id of lexicon.entries.keys()) if (!ids.includes(id) && (status.words[id]?.state ?? 'new') !== 'new') ids.push(id);
    return {
      // A word a grown-up excluded is gone from the child's view too (spec §6).
      words: ids.filter((id) => lexicon.entries.has(id) && status.words[id]?.excluded !== true).map((id) => {
        const entry = lexicon.entries.get(id);
        const word = status.words[id] ?? {};
        return {
          wordId: id, term: entry.term, gloss: entry.gloss, state: word.state ?? 'new',
          stage: word.stage ?? 0, tricky: word.tricky === true, dueDay: word.dueDay ?? null, ...signOffFields(word),
        };
      }),
    };
  }

  async close({ userId, sittingId, reason = 'leave' } = {}) {
    const { store, pkg, day, ctx, sitting } = await this.#context(userId, sittingId);
    if (sitting.closedAt) return { closed: true, already: true };
    const why = CLOSE_REASONS.has(reason) ? reason : 'leave';
    const nowMs = this.#now();
    const at = isoWithOffset(nowMs, this.#timezone);
    let changes = null;
    const out = this.#transact(store, userId, pkg, day, ctx.dayFile.sittings[sittingId].deckId, ({ status, dayFile }) => {
      changes = this.#housekeep(dayFile, sittingId, nowMs, { reopen: false });
      const row = dayFile.sittings[sittingId];
      if (row && !row.closedAt) dayFile.sittings[sittingId] = { ...row, closedAt: at, reason: why };
      return { status, dayFile };
    });
    this.#logHousekeeping(userId, sittingId, out.dayFile, changes, currentItem({ ...ctx, status: out.status, dayFile: out.dayFile }));
    this.#logger.info?.('school.card-ladder.closed', {
      learnerId: userId, sittingId, mode: this.#mode, reason: why, activeMs: ctx.dayFile.activeMs, doneAt: ctx.dayFile.doneAt ?? null,
    });
    // Leaving mid-run: progress is already on disk; the run stays with its sitting, so a reload resumes it.
    if (ctx.dictation) {
      this.#logger.info?.('school.card-ladder.dictation.exited', {
        learnerId: userId, package: pkg, week: ctx.dictation.week, remaining: ctx.dictation.remaining, sittingId, reason: why,
      });
    }
    return { closed: true };
  }

  /**
   * The teacher's "apply scanned quiz": the same fold `open` runs, on demand,
   * for every word package the learner has a card-ladder assignment in.
   */
  async fold({ learnerId, actorId = null } = {}) {
    if (!this.#teacherGate) throw new ValidationError('teacher gate is not configured');
    this.#teacherGate.assert({ userId: actorId, action: 'card-ladder.fold', context: { learnerId } });
    const enrollments = await this.#enrollments(learnerId);
    if (!enrollments.length) throw new EntityNotFoundError('card-ladder assignment', learnerId);
    const today = this.#today();
    const byPackage = new Map();
    for (const enrollment of enrollments) {
      const deckId = enrollment.deckId ?? enrollment.corpusId;
      // One unloadable deck must not block folding every other package.
      try {
        const { deck, pkg } = await this.#load(deckId);
        if (!byPackage.has(pkg)) byPackage.set(pkg, deck);
      } catch (error) {
        this.#logger.warn?.('school.card-ladder.fold-deck-skipped', { learnerId, deckId, error: error.message });
      }
    }
    const all = [];
    for (const [pkg, deck] of byPackage) {
      const { store } = this.#stores.open(learnerId, pkg, today, {});
      const read = this.#readAttempts(learnerId, store.readStatus(learnerId, pkg), today);
      const quizDocumentIds = await this.#quizDocumentIds(deck);
      const deckDir = deckDirOf(deck.id);
      let folded = [];
      let transitions = [];
      this.#transact(store, learnerId, pkg, today, deck.id, ({ status, dayFile }) => {
        const out = this.#fold(status, read, quizDocumentIds, today, this.#daySettings(dayFile, { store, userId: learnerId, pkg }), { learnerId, deckDir, pkg });
        folded = out.folded;
        transitions = out.transitions;
        return { status: out.status, dayFile };
      });
      this.#logFold(learnerId, pkg, folded, 'teacher');
      this.#logTransitions({ learnerId, pkg, day: today }, transitions);
      all.push(...folded);
    }
    return { learnerId, folded: all.length, demoted: all.filter((row) => !row.correct).map((row) => row.wordId) };
  }

  // ── Grown-up word controls (spec §6) ───────────────────────────────────
  // Live only, teacher-gated, per learner per word package. Every mutation
  // logs `school.card-ladder.admin` and a `transition` (source `admin`) for
  // each word whose state or stage it changed.

  async #admin({ learnerId, deckId, actorId }) {
    if (this.#mode !== 'live') throw new ValidationError('card-ladder admin is answered by the live card ladder only');
    if (!this.#teacherGate) throw new ValidationError('teacher gate is not configured');
    this.#teacherGate.assert({ userId: actorId, action: 'card-ladder.admin', context: { learnerId } });
    await this.#assertAssigned(learnerId, deckId);
    const { deck, lexicon, pkg } = await this.#load(deckId);
    const day = this.#today();
    const { store } = this.#stores.open(learnerId, pkg, day, {});
    return { deck, lexicon, pkg, day, store };
  }

  #logAdmin({ actorId, learnerId, pkg, day }, action, extra = {}) {
    this.#logger.info?.('school.card-ladder.admin', {
      actorId, learnerId, package: pkg, day, mode: this.#mode, action, wordId: null, ...extra,
    });
  }

  /**
   * One word's record, changed by `change(word, ctx)` in today's transaction.
   * `ctx.settings` is the day's tuning (its at-open snapshot, else current).
   * `prepare(found)` runs after the gate, before the transaction, for the
   * async reads a change needs (the pool, media).
   */
  async #adminWord(args, action, change, extra = {}, prepare = null) {
    const { learnerId, actorId, wordId } = args;
    const found = await this.#admin(args);
    const { lexicon, pkg, day, store } = found;
    if (typeof wordId !== 'string' || !lexicon.entries.has(wordId)) throw new EntityNotFoundError('card-ladder word', String(wordId));
    const prepared = prepare ? await prepare(found) : {};
    let transitions = [];
    let word = null;
    this.#transact(store, learnerId, pkg, day, args.deckId, ({ status, dayFile }) => {
      const before = status.words[wordId] ?? emptyWordV3();
      const settings = this.#daySettings(dayFile, { store, userId: learnerId, pkg });
      const out = change(before, { status, dayFile, day, settings, ...prepared });
      status.words[wordId] = out.word;
      word = out.word;
      transitions = wordTransitions({ [wordId]: before }, { [wordId]: out.word }, 'admin');
      return { status, dayFile: out.dayFile ?? dayFile };
    });
    this.#logAdmin({ actorId, learnerId, pkg, day }, action, { wordId, ...extra });
    this.#logTransitions({ learnerId, pkg, day }, transitions);
    return { learnerId, package: pkg, wordId, word };
  }

  /**
   * Every word of the package the learner can meet, with its ladder state and
   * its judged typed answers from the last 14 study days, newest first.
   */
  async adminWords({ learnerId, deckId, actorId = null } = {}) {
    const { deck, lexicon, pkg, day, store } = await this.#admin({ learnerId, deckId, actorId });
    const status = store.readStatus(learnerId, pkg);
    const typed = new Map();
    for (let back = 0; back < ADMIN_TYPED_DAYS; back += 1) {
      const rows = typedAnswers(store.readDay(learnerId, pkg, addDays(day, -back))).reverse();
      for (const row of rows) {
        if (!typed.has(row.wordId)) typed.set(row.wordId, []);
        typed.get(row.wordId).push({
          day: row.day, itemId: row.itemId, typed: row.typed, score: row.score, judge: row.judge, reason: row.reason,
          correct: row.correct, source: row.source, regraded: row.regraded,
        });
      }
    }
    const ids = await this.#deckOrder(status, deck);
    for (const id of lexicon.entries.keys()) if (!ids.includes(id) && status.words[id]) ids.push(id);
    // A deck the learner is still enrolled in is re-added at every open, so
    // only a deck they have left can be dropped from the pool.
    const enrolled = new Set((await this.#enrollments(learnerId)).map((row) => row.deckId ?? row.corpusId));
    // The week's dictation for the grown-up (spec 2026-11-06, Task 5): the
    // week, its count warning, words waiting on a recording or the deck, and
    // each list word's step and blind passes. Never a reason to fail the list.
    let dictation = null;
    const drilled = new Map();
    try {
      const read = this.#readDictation(store, learnerId, pkg, lexicon, this.#media(deck, lexicon), deck);
      if (read.list && read.fileState.progress === 'corrupt') dictation = { week: read.list.week, unavailable: 'corrupt' };
      else if (read.state) {
        dictation = this.#dictationSummary(read.state, read.list);
        for (const w of read.state.words) drilled.set(w.id, { step: w.step, blindPasses: w.blindPasses, done: w.done });
      }
    } catch (error) {
      this.#logger.warn?.('school.card-ladder.dictation.admin-unavailable', { learnerId, package: pkg, error: error.message });
    }
    return {
      learnerId, package: pkg, decksSeen: [...status.decksSeen], dictation,
      droppableDecks: status.decksSeen.filter((id) => !enrolled.has(id)),
      words: ids.filter((id) => lexicon.entries.has(id)).map((id) => {
        const entry = lexicon.entries.get(id);
        const word = status.words[id] ?? emptyWordV3();
        return {
          wordId: id, term: entry.term, gloss: entry.gloss, state: word.state ?? 'new', stage: word.stage ?? null,
          dueDay: word.dueDay ?? null, missStreak: word.missStreak ?? 0, tricky: word.tricky === true, excluded: word.excluded === true,
          lastGraded: word.lastGraded ?? null, recentTyped: typed.get(id) ?? [], ...signOffFields(word),
          // Only the week's words carry it, so every other word's row is unchanged.
          ...(drilled.has(id) ? { dictation: drilled.get(id) } : {}),
        };
      }),
    };
  }

  /**
   * The days this learner opened in this package, newest first, each at a
   * glance (when, how long, how the graded answers went). Read only — the
   * grown-up's "day by day" list, never a write.
   */
  async adminDays({ learnerId, deckId, actorId = null } = {}) {
    const { pkg, store } = await this.#admin({ learnerId, deckId, actorId });
    const all = store.listDays(learnerId, pkg);
    const days = all.slice(-ADMIN_DAY_LIST).reverse();
    return {
      learnerId, package: pkg, more: all.length > days.length,
      days: days.map((day) => daySummary(store.readDay(learnerId, pkg, day))),
    };
  }

  /**
   * One day's every answer, in order, with each word's term and gloss, plus
   * the spoken takes kept that day. Speaking is never graded, so a take is
   * its own list (by word, take number) rather than a verdict on an answer.
   */
  async adminDay({ learnerId, deckId, day, actorId = null } = {}) {
    if (!STUDY_DAY.test(String(day ?? ''))) throw new ValidationError('day must be YYYY-MM-DD');
    const { lexicon, pkg, store } = await this.#admin({ learnerId, deckId, actorId });
    if (!store.listDays(learnerId, pkg).includes(day)) throw new EntityNotFoundError('card-ladder day', day);
    const dayFile = store.readDay(learnerId, pkg, day);
    const word = (id) => {
      const entry = id ? lexicon.entries.get(id) : null;
      return { term: entry?.term ?? null, gloss: entry?.gloss ?? null };
    };
    const takes = typeof this.#recordings?.list === 'function'
      ? this.#recordings.list({ package: pkg, learnerId, day }) : [];
    return {
      learnerId, package: pkg, ...daySummary(dayFile),
      answers: dayAnswers(dayFile).map((row) => ({ ...row, ...word(row.wordId) })),
      recordings: takes.map((take) => ({ ...take, ...word(take.wordId) })),
    };
  }

  /** One kept take's audio, for the grown-up's player. Null when it is not on file. */
  async adminRecording({ learnerId, deckId, day, wordId, take, actorId = null } = {}) {
    if (!STUDY_DAY.test(String(day ?? ''))) throw new ValidationError('day must be YYYY-MM-DD');
    const { pkg } = await this.#admin({ learnerId, deckId, actorId });
    if (typeof this.#recordings?.open !== 'function') return null;
    return this.#recordings.open({ package: pkg, learnerId, day, wordId, take: Number(take) });
  }

  /** Reset to new: a fresh record — nothing kept, `notYetCarry` included. */
  async adminReset({ learnerId, deckId, wordId, actorId = null } = {}) {
    return this.#adminWord({ learnerId, deckId, wordId, actorId }, 'reset', () => ({ word: emptyWordV3() }));
  }

  /** Mastered at `stage`, due after that stage's gap scaled by the day's tuned `review.gapScale`. */
  async adminMarkMastered({ learnerId, deckId, wordId, stage, actorId = null } = {}) {
    return this.#adminWord({ learnerId, deckId, wordId, actorId }, 'mastered',
      (word, { day, settings }) => ({ word: markMastered(word, { stage, day, gapScale: settings?.review?.gapScale ?? 1 }) }), { stage });
  }

  /**
   * Excluded words leave every round, recheck, drill, practice run and quiz;
   * today's pending ones too. An opened day is then re-settled, so taking away
   * the only pending thing plans what comes next (or credits the day) instead
   * of leaving the child on a "done" summary. A day never opened is untouched.
   */
  async adminExclude({ learnerId, deckId, wordId, excluded = true, actorId = null } = {}) {
    if (typeof excluded !== 'boolean') throw new ValidationError('excluded must be true or false');
    const prepare = async ({ deck, lexicon, pkg, store }) => ({
      deck, lexicon, media: this.#media(deck, lexicon), pool: await this.#pool(store.readStatus(learnerId, pkg), deck, learnerId),
    });
    return this.#adminWord({ learnerId, deckId, wordId, actorId }, excluded ? 'exclude' : 'include', (word, ctx) => {
      const next = { ...word, excluded };
      if (!excluded || !ctx.dayFile.atOpen) return { word: next };
      const status = { ...ctx.status, words: { ...ctx.status.words, [wordId]: next } };
      const dayFile = excludeWordFromDay(ctx.dayFile, wordId, {
        status, day: ctx.day, pool: ctx.pool, settings: ctx.settings, learnerId, media: ctx.media, lexicon: ctx.lexicon,
        at: isoWithOffset(this.#now(), this.#timezone),
      });
      return { word: next, dayFile };
    }, { excluded }, prepare);
  }

  /**
   * Removes a deck from the new-word pool (`decksSeen`); words already
   * introduced keep their state. The current deck and any deck the learner is
   * still enrolled in are refused: the next open would silently re-add them.
   */
  async adminDropDeck({ learnerId, deckId, dropDeckId, actorId = null } = {}) {
    const { pkg, day, store } = await this.#admin({ learnerId, deckId, actorId });
    if (typeof dropDeckId !== 'string' || !dropDeckId) throw new ValidationError('dropDeckId is required');
    const enrolled = (await this.#enrollments(learnerId)).some((row) => (row.deckId ?? row.corpusId) === dropDeckId);
    if (dropDeckId === deckId || enrolled) {
      throw new ValidationError(`'${dropDeckId}' is a deck the learner is still enrolled in; end that assignment first`);
    }
    const out = this.#transact(store, learnerId, pkg, day, deckId, ({ status, dayFile }) => {
      if (!status.decksSeen.includes(dropDeckId)) throw new EntityNotFoundError('card-ladder deck in the pool', dropDeckId);
      return { status: { ...status, decksSeen: status.decksSeen.filter((id) => id !== dropDeckId) }, dayFile };
    });
    this.#logAdmin({ actorId, learnerId, pkg, day }, 'drop-deck', { deckId: dropDeckId });
    return { learnerId, package: pkg, decksSeen: out.status.decksSeen };
  }

  /**
   * Re-grades one logged typed (3.3) answer: the judge cache for that exact
   * answer is overwritten, so the same answer is judged the grown-up's way
   * from now on, and the item records who re-graded it. Word state is NOT
   * rewritten — reset / mark mastered do that.
   */
  async adminRegrade({ learnerId, deckId, day, itemId, pass, actorId = null } = {}) {
    const { pkg, store, lexicon } = await this.#admin({ learnerId, deckId, actorId });
    if (!this.#judgementCache) throw new ValidationError('the judgement cache is not configured');
    if (typeof day !== 'string' || !DAY_PATTERN.test(day)) throw new ValidationError('day must be YYYY-MM-DD');
    if (typeof itemId !== 'string' || !itemId) throw new ValidationError('itemId is required');
    if (typeof pass !== 'boolean') throw new ValidationError('pass must be true or false');
    const dayFile = store.readDay(learnerId, pkg, day);
    if (!dayFile.items?.[itemId]) throw new EntityNotFoundError('card-ladder answer', `${day} ${itemId}`);
    const answer = typedAnswers(dayFile).find((row) => row.itemId === itemId);
    if (!answer) throw new ValidationError('only a typed (3.3) answer can be re-graded');
    // Nothing was typed — the child said Don't know. The judge never reads the
    // cache for an empty answer, so a re-grade could only flip the record.
    if (answer.judge === 'dont-know' || !String(answer.typed ?? '').trim()) throw new ValidationError("a Don't know answer cannot be re-graded");
    const score = pass ? this.#settings().typing.passScore : 1;
    // Keyed exactly as the judge looks it up: the target script's normalize.
    const rule = ruleForTarget(lexicon.entries.get(answer.wordId)?.term ?? '', lexicon.targetScript ?? scriptFor(lexicon.language?.code));
    this.#judgementCache.set(pkg, answer.wordId, rule.normalize(answer.typed), { score, judge: 'grown-up', reason: REGRADE_REASON });
    const regraded = { at: isoWithOffset(this.#now(), this.#timezone), actorId, pass };
    this.#transact(store, learnerId, pkg, day, deckId, ({ status, dayFile: file }) => {
      if (file.items?.[itemId]) file.items[itemId] = { ...file.items[itemId], regraded };
      return { status, dayFile: file };
    });
    this.#logAdmin({ actorId, learnerId, pkg, day }, 'regrade', { wordId: answer.wordId, itemId, pass, score, was: answer.score });
    return { learnerId, package: pkg, day, itemId, wordId: answer.wordId, regraded };
  }

  /**
   * THE LAUNCH CARD'S FACTS, read from a store without opening anything: the
   * program's title is the CLASS ("UBKS 비둘기" — the lexicon's
   * `program.title`), the deck is the unit, today's plan is the lesson, and
   * the deck's two rungs (recognised · mastered) are the bar. The course id is a program id,
   * `program:card-ladder:<package>`, so the poster resolves to
   * `<media>/school/programs/card-ladder/<package>/poster.jpg` (falling back to
   * the pre-rename `programs/word-ladder/` directory) — the artwork
   * belongs to the word package, not the program (one program, many languages).
   */
  async #card({ userId, store, day, deck, lexicon, pkg }) {
    const status = store.readStatus(userId, pkg);
    const dayFile = store.readDay(userId, pkg, day);
    const settings = this.#daySettings(dayFile, { store, userId, pkg });
    const plan = introPreview({ status, dayFile, day, pool: await this.#pool(status, deck, userId), settings });
    return {
      course: { id: `program:card-ladder:${pkg}`, title: lexicon.program.title },
      unit: { id: deck.id, title: typeof deck.title === 'string' && deck.title.trim() ? deck.title.trim() : deck.id },
      plan,
      progress: deckProgress({ status, deckWords: deck.words }),
    };
  }

  /**
   * The start screen's card (`GET /card-ladder[/test]/intro`). READ-ONLY: spec
   * §6 opens nothing before Start, so this never opens a day or writes a file.
   * Test mode reads a PEEKED shadow snapshot — the same seeded copy Start's
   * open would take (`scenario`), built and thrown away, never kept.
   */
  async intro({ userId, deckId, scenario = null } = {}) {
    await this.#assertAssigned(userId, deckId);
    const { deck, lexicon, pkg } = await this.#load(deckId);
    const day = this.#today();
    let store;
    if (typeof this.#stores.peek === 'function') store = this.#stores.peek(userId, pkg, day, { scenario, deck, lexicon });
    else if (this.#mode === 'live') store = this.#stores.open(userId, pkg, day, { readOnly: true }).store;
    else throw new ValidationError('test-mode intro needs a peekable store (stores.peek)');
    const card = await this.#card({ userId, store, day, deck, lexicon, pkg });
    const { plan } = card;
    return {
      deckId, package: pkg, day, test: this.#mode === 'test',
      course: card.course, unit: card.unit,
      poster: curriculumPosterRef('selfservice', card.course.id),
      today: {
        newCount: plan.newCount, reviewCount: plan.reviewCount, estimatedMinutes: plan.estimatedMinutes, doneToday: plan.doneToday,
        label: introPlanLabel(plan), line: introPlanLabel(plan, { withTime: true }),
      },
      progress: card.progress,
      ...this.#introDictation(store, userId, pkg, lexicon, deck),
    };
  }

  /**
   * The start card's dictation line (Task 3): `{ dictation }` with the week's
   * summary, nothing at all with no week tag (the intro's shape is otherwise
   * unchanged), or `{ week, unavailable: 'corrupt' }` when the learner's
   * progress file can't be read — the card says so instead of failing.
   */
  #introDictation(store, userId, pkg, lexicon, deck) {
    const read = this.#readDictation(store, userId, pkg, lexicon, this.#dictationMedia(deck, lexicon), deck);
    if (!read.list) return {};
    if (read.fileState.progress === 'corrupt') return { dictation: { week: read.list.week, unavailable: 'corrupt' } };
    return { dictation: this.#dictationSummary(read.state, read.list) };
  }

  /**
   * `projectProgramEntry`'s seam (as `LanguageStudyService.#cardProjection`):
   * context + progress for today's agenda card. A replayed past day gets none —
   * a card is an offer, and nobody is offered yesterday.
   */
  #cardProjection(card, day) {
    const { plan, progress } = card;
    return {
      context: { course: card.course, unit: card.unit, lesson: { id: `${card.unit.id}:${day}`, title: introPlanLabel(plan) } },
      description: !plan.doneToday && plan.estimatedMinutes ? `About ${plan.estimatedMinutes} minute${plan.estimatedMinutes === 1 ? '' : 's'}` : null,
      // Two rungs in one row: mastered (typed sign-off) is the finished
      // segment, recognised the underway one (`inProgress`), and the label
      // names both — a mastered-only count reads "0" for weeks.
      progress: [{
        scope: 'unit', label: `${progress.recognised} recognised · ${progress.learned} mastered`,
        completed: progress.learned, inProgress: progress.recognised, total: progress.total,
      }],
    };
  }

  /** Read-only credit for the launcher: today (live) or a past study day (replay). Live only. */
  async dayStatus({ userId, deckId, day = null } = {}) {
    // Opening a test store snapshots a new shadow; credit never comes from test mode.
    if (this.#mode !== 'live') throw new ValidationError('dayStatus is answered by the live card ladder only');
    const today = this.#today();
    const target = day ?? today;
    try {
      const loaded = await this.#load(deckId);
      const { pkg } = loaded;
      const { store } = this.#stores.open(userId, pkg, target, { readOnly: true });
      const dayFile = store.readDay(userId, pkg, target);
      const credit = !dayFile.atOpen
        ? { doneToday: false, progressLabel: 'Not opened', remaining: null }
        : { doneToday: Boolean(dayFile.doneAt), progressLabel: dayFile.doneAt ? 'Done for today' : 'In progress', remaining: null };
      if (target !== today) return credit;
      try {
        const projection = this.#cardProjection(await this.#card({ userId, store, day: target, ...loaded }), target);
        // The week's dictation rides on the launch card's line (UX audit
        // placement 2), so it is seen before Start — never a reason to fail.
        const { dictation } = this.#introDictation(store, userId, pkg, loaded.lexicon, loaded.deck);
        const waiting = (dictation?.needsRecording?.length ?? 0) + (dictation?.unknown?.length ?? 0);
        let dictationLine = null;
        if (dictation && !dictation.unavailable && !dictation.done) {
          if (dictation.remaining > 0) dictationLine = `Dictation: ${dictation.remaining} word${dictation.remaining === 1 ? '' : 's'} left`;
          // Only words a grown-up must fix are left: say so, never go quiet (final review I3).
          else if (waiting) dictationLine = `Dictation: ${waiting} word${waiting === 1 ? '' : 's'} waiting for a grown-up`;
        }
        if (dictationLine) projection.description = [projection.description, dictationLine].filter(Boolean).join(' · ');
        // The launch card renders the LESSON's title and description, not the
        // top-level description (live 2026-11-06: "Done for today" and no
        // dictation in sight). On a finished day dictation leads the title,
        // and the card always says flashcards stay open (owner: anytime).
        const lesson = projection.context?.lesson;
        if (lesson) {
          const doneToday = Boolean(dayFile.doneAt);
          const lines = [];
          if (doneToday && dictation && !dictation.unavailable && !dictation.done && dictation.remaining > 0) {
            lesson.title = `Dictation: ${dictation.remaining} word${dictation.remaining === 1 ? '' : 's'}`;
          } else if (dictationLine) lines.push(dictationLine);
          if (dictation?.done) lines.push('Dictation ready ✓');
          if (doneToday) lines.push('Flashcards: practise anytime');
          if (lines.length) lesson.description = [lesson.description, ...lines].filter(Boolean).join('\n');
        }
        return { ...credit, ...projection, entries: this.#launchEntries({ doneToday: Boolean(dayFile.doneAt), dictation }) };
      } catch (error) {
        // The card is decoration on the credit: a failure here must not cost the day its disc.
        this.#logger.warn?.('school.card-ladder.card-unavailable', { learnerId: userId, deckId, day: target, error: error.message });
        return credit;
      }
    } catch (error) {
      // A broken deck answers like a day never opened; it must not throw
      // through the launcher and take the rest of the agenda with it.
      this.#logger.warn?.('school.card-ladder.day-status-unloadable', { learnerId: userId, deckId, day: target, error: error.message });
      return { doneToday: false, progressLabel: 'Not opened', remaining: null };
    }
  }

  /**
   * A learner's card-ladder record as achievement facts, read only and live
   * only (the economy's gems). Every package on disk counts, enrolled or not —
   * a dropped package's mastered words were still mastered.
   *   doneDays  study days in [from, to] whose day file carries `doneAt`
   *   signOffs  every word currently signed off (`state: mastered` with
   *             `typedSignedOff`, not excluded), all time. A demotion clears
   *             the stamp, so this is the PRESENT record, not a history.
   * One unreadable package is skipped with a warning; a missing store is an error.
   * @returns {Promise<{packages: Array<{package: string, doneDays: string[], signOffs: Array<{wordId: string, day: string}>}>}>}
   */
  async achievementRecord({ userId, from = null, to = null } = {}) {
    if (this.#mode !== 'live') throw new ValidationError('achievementRecord is answered by the live card ladder only');
    const view = typeof this.#stores.peek === 'function' ? this.#stores.peek(userId) : null;
    if (typeof view?.listPackages !== 'function') throw new Error('card-ladder store cannot list packages');
    const inRange = (day) => (!from || day >= from) && (!to || day <= to);
    const packages = [];
    for (const pkg of view.listPackages(userId)) {
      try {
        const doneDays = view.listDays(userId, pkg).filter(inRange)
          .filter((day) => Boolean(view.readDay(userId, pkg, day)?.doneAt));
        const words = view.readStatus(userId, pkg)?.words ?? {};
        const signOffs = Object.entries(words)
          .filter(([, w]) => w?.state === 'mastered' && typeof w.typedSignedOff === 'string' && w.excluded !== true)
          .map(([wordId, w]) => ({ wordId, day: w.typedSignedOff }));
        packages.push({ package: pkg, doneDays, signOffs });
      } catch (error) {
        this.#logger.warn?.('school.card-ladder.achievement-package-skipped', { learnerId: userId, package: pkg, error: error.message });
      }
    }
    return { packages };
  }
}

export default CardLadderSittingService;
