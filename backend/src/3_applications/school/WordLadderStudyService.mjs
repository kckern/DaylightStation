/**
 * Word ladder study (word-ladder design): server-authoritative day plans,
 * graded checks, recorded study cards, the post-completion review run, and
 * the pull-fold of scanned paper quizzes.
 *
 * LANGUAGE-NEUTRAL. Everything language-specific — which language is taught,
 * which one the meanings are in, the program title — comes from the deck's
 * lexicon. Every operation resolves the WORD PACKAGE (`lexicon.package`) from
 * the deck: status, sessions, frozen plans, fold bookkeeping and recordings all
 * live under that package, so word ids need only be unique within a package.
 * A session id carries its package (`<package>.<id>`) so session-scoped calls
 * find the right status file without the client naming a deck.
 *
 * THE DAY PLAN IS FROZEN on the first open of a study day. Rebuilding it from
 * the store mid-day would drop checks just passed and then offer a review
 * quiz; credit and past-day replay read the frozen plan plus that day's
 * history (`dayProgress`).
 */
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';
import { offsetMinutesFor, studyDayForInstant } from '#domains/school/studyDay.mjs';
import { addDays } from '#domains/school/termVerdict.mjs';
import {
  applyCheck, applyMark, applyReviewView, applyStudy, buildChoices, dayProgress, foldPaperAttempts,
  planDay, progressLabel, quizDocumentIdFor, readWord, wordAssetIds,
} from '#domains/school/wordLadder/index.mjs';

const FOLD_LOOKBACK_DAYS = 60;
const FOLD_SKEW_DAYS = 2;
const MARKS = new Set(['know', 'learning']);
const PACKAGE_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

function sessionPackage(sessionId) {
  const cut = typeof sessionId === 'string' ? sessionId.indexOf('.') : -1;
  const pkg = cut > 0 ? sessionId.slice(0, cut) : null;
  return pkg && PACKAGE_SLUG.test(pkg) ? pkg : null;
}

/** An ISO instant carrying the household's own offset: `2026-09-22T16:05:12-07:00`. */
function isoWithOffset(ms, timezone) {
  const offset = offsetMinutesFor(timezone, ms);
  const local = new Date(ms + offset * 60_000).toISOString().slice(0, 19);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export class WordLadderStudyService {
  #store; #decks; #lexicons; #assignments; #attempts; #recordings; #assets; #teacherGate; #timezone; #now; #id; #logger;

  constructor({
    store, decks, lexicons, assignments, attempts = null, recordings, assets = null, teacherGate = null,
    timezone = null, now, id, logger = console,
  } = {}) {
    if (typeof store?.read !== 'function' || typeof store?.update !== 'function') throw new Error('WordLadderStudyService requires store');
    if (typeof decks?.getFlashcardDeck !== 'function') throw new Error('WordLadderStudyService requires decks.getFlashcardDeck');
    if (typeof lexicons?.getLexicon !== 'function') throw new Error('WordLadderStudyService requires lexicons.getLexicon');
    if (typeof assignments?.get !== 'function') throw new Error('WordLadderStudyService requires assignments');
    if (typeof recordings?.save !== 'function' || typeof recordings?.latest !== 'function') throw new Error('WordLadderStudyService requires recordings');
    if (typeof now !== 'function' || typeof id !== 'function') throw new Error('WordLadderStudyService requires now and id');
    this.#store = store; this.#decks = decks; this.#lexicons = lexicons; this.#assignments = assignments;
    this.#attempts = attempts; this.#recordings = recordings; this.#assets = assets; this.#teacherGate = teacherGate;
    this.#timezone = timezone; this.#now = now; this.#id = id; this.#logger = logger;
  }

  #today() { return studyDayForInstant(this.#now(), { timezone: this.#timezone }); }
  #at() { return isoWithOffset(this.#now(), this.#timezone); }

  async #enrollments(userId) {
    const assignment = await this.#assignments.get(userId);
    return (assignment?.programs ?? []).filter((row) => row?.programId === 'flashcards' && row.policy?.mode === 'word-ladder');
  }

  async #enrollment(userId, deckId) {
    return (await this.#enrollments(userId)).find((row) => (row.deckId ?? row.corpusId) === deckId) ?? null;
  }

  async #assertAssigned(userId, deckId) {
    if (typeof userId !== 'string' || !userId) throw new ValidationError('userId is required');
    if (typeof deckId !== 'string' || !deckId) throw new ValidationError('deckId is required');
    if (!await this.#enrollment(userId, deckId)) {
      throw new GuestForbiddenError(`'${userId}' has no word-ladder assignment for '${deckId}'`);
    }
  }

  /** The deck, its validated lexicon, and the word package both belong to. */
  async #load(deckId) {
    const deck = await this.#decks.getFlashcardDeck(deckId);
    if (!deck || !Array.isArray(deck.words) || typeof deck.lexicon !== 'string') throw new EntityNotFoundError('word-ladder deck', deckId);
    const lexicon = this.#lexicons.getLexicon(deck.lexicon);
    return { deck, lexicon, pkg: lexicon.package };
  }

  #has(assetId) {
    try { return this.#assets?.exists?.(assetId) === true; } catch { return false; }
  }

  #media(deck, lexicon) {
    const media = {};
    for (const entry of lexicon.entries.values()) {
      const ids = wordAssetIds(deck.lexicon, entry);
      media[entry.id] = { image: this.#has(ids.image), audio: this.#has(ids.audio), imageId: ids.image, audioId: ids.audio };
    }
    return media;
  }

  #card(entry, media) {
    const m = media[entry.id] ?? {};
    return {
      wordId: entry.id, kind: entry.kind, term: entry.term, gloss: entry.gloss,
      pronunciation: entry.pronunciation ?? null,
      media: { image: m.image ? m.imageId : null, audio: m.audio ? m.audioId : null },
    };
  }

  #check(item, entry, media, day) {
    const m = media[entry.id] ?? {};
    const prompt = item.direction === 'picture_to_term' ? { type: 'image', assetId: m.imageId }
      : item.direction === 'audio_to_term' ? { type: 'audio', assetId: m.audioId }
        : { type: 'text', text: entry.term };
    return {
      wordId: entry.id, kind: entry.kind, phase: item.phase, direction: item.direction, prompt,
      choices: buildChoices(entry, item.direction, day).choices, done: item.done, correct: item.correct,
    };
  }

  /**
   * Frozen plans are keyed by study day AND deck (`days[day][deckId]`): credit
   * is per deck, and a second deck opened the same day must never overwrite
   * the first deck's plan (and with it the credit already earned).
   */
  static #frozenPlan(status, day, deckId) {
    const plan = status?.days?.[day]?.[deckId];
    return plan && typeof plan === 'object' ? plan : null;
  }

  #progress(status, day, deckId) {
    return dayProgress({ dayPlan: WordLadderStudyService.#frozenPlan(status, day, deckId), words: status.words, day });
  }

  #publicPlan(status, day, deck, lexicon, media) {
    const dayPlan = WordLadderStudyService.#frozenPlan(status, day, deck.id);
    const progress = dayProgress({ dayPlan, words: status.words, day });
    const { entries } = lexicon;
    const known = (item) => entries.has(item.wordId);
    return {
      day,
      deckId: deck.id,
      package: lexicon.package,
      title: lexicon.program.title,
      language: { code: lexicon.language.code, name: lexicon.language.name },
      gloss: { code: lexicon.gloss.code, name: lexicon.gloss.name },
      checks: progress.checks.filter(known).map((item) => this.#check(item, entries.get(item.wordId), media, day)),
      study: progress.study.filter(known).map((item) => ({ ...item, card: this.#card(entries.get(item.wordId), media) })),
      review: progress.review.filter(known).map((item) => this.#check(item, entries.get(item.wordId), media, day)),
      deckCards: deck.words.filter((wordId) => entries.has(wordId)).map((wordId) => this.#card(entries.get(wordId), media)),
      remaining: progress.remaining,
      doneToday: progress.complete,
      progressLabel: progressLabel(progress),
    };
  }

  /**
   * `ok: false` means the read failed and nothing was actually observed — the
   * caller must NOT advance `lastFoldedDay` in that case, or a transient read
   * failure would silently skip the attempts in the un-scanned window forever
   * (the next successful read starts its lookback from the day that never
   * really got folded).
   */
  #readAttempts(userId, status, today) {
    if (typeof this.#attempts?.readAttemptsInRange !== 'function') return { attempts: [], ok: true };
    // Attempt shards are keyed by the UTC date of `at`, not the study day, so
    // the window reaches one day past today and two days behind the last fold.
    const from = status.lastFoldedDay ? addDays(status.lastFoldedDay, -FOLD_SKEW_DAYS) : addDays(today, -FOLD_LOOKBACK_DAYS);
    try {
      return { attempts: this.#attempts.readAttemptsInRange(userId, from, addDays(today, 1)) ?? [], ok: true };
    } catch (error) {
      this.#logger.warn?.('school.word-ladder.attempts-unreadable', { learnerId: userId, error: error.message });
      return { attempts: [], ok: false };
    }
  }

  /**
   * Every printed quiz whose rows fold into THIS package: a scanned row's
   * itemId is a word id, and word ids are only unique within a package, so a
   * quiz printed from another package's deck must never fold here.
   */
  async #quizDocumentIds(deck) {
    const ids = new Set([quizDocumentIdFor(deck.id)]);
    try {
      for (const other of await this.#decks.listFlashcardDecks?.() ?? []) {
        if (Array.isArray(other?.words) && typeof other.id === 'string' && other.lexicon === deck.lexicon) ids.add(quizDocumentIdFor(other.id));
      }
    } catch (error) {
      this.#logger.warn?.('school.word-ladder.decks-unlisted', { error: error.message });
    }
    return [...ids];
  }

  #foldInto(status, attempts, quizDocumentIds, today, ok = true) {
    const { status: next, folded } = foldPaperAttempts({
      status, attempts, quizDocumentIds,
      dayOf: (at) => studyDayForInstant(Date.parse(at), { timezone: this.#timezone }),
    });
    if (ok) next.lastFoldedDay = today;
    return { next, folded };
  }

  #logFold(learnerId, pkg, folded, source) {
    if (!folded.length) return;
    this.#logger.info?.('school.word-ladder.folded', {
      learnerId, package: pkg, source, count: folded.length, demoted: folded.filter((row) => !row.correct).map((row) => row.wordId),
    });
  }

  #session(userId, sessionId) {
    if (typeof userId !== 'string' || !userId) throw new ValidationError('userId is required');
    const pkg = sessionPackage(sessionId);
    if (!pkg) throw new EntityNotFoundError('word-ladder session', sessionId);
    const status = this.#store.read(userId, pkg);
    const session = status.sessions?.[sessionId];
    const today = this.#today();
    if (!session || session.day !== today) throw new EntityNotFoundError('word-ladder session', sessionId);
    return { status, session, today, pkg };
  }

  /** Session-scoped work re-reads the deck; a deck moved to another package must not write across packages. */
  async #sessionLoad(session, pkg) {
    const loaded = await this.#load(session.deckId);
    if (loaded.pkg !== pkg) throw new EntityNotFoundError('word-ladder session', `${pkg}/${session.deckId}`);
    return loaded;
  }

  async open({ userId, deckId } = {}) {
    await this.#assertAssigned(userId, deckId);
    const { deck, lexicon, pkg } = await this.#load(deckId);
    const media = this.#media(deck, lexicon);
    const today = this.#today();
    const at = this.#at();
    const { attempts, ok: attemptsOk } = this.#readAttempts(userId, this.#store.read(userId, pkg), today);
    const quizDocumentIds = await this.#quizDocumentIds(deck);
    const sessionId = `${pkg}.${this.#id()}`;
    let folded = [];
    let frozen = false;
    const status = this.#store.update(userId, pkg, (current) => {
      const { next, folded: applied } = this.#foldInto(current, attempts, quizDocumentIds, today, attemptsOk);
      folded = applied;
      if (!WordLadderStudyService.#frozenPlan(next, today, deckId)) {
        next.days = {
          ...(next.days ?? {}),
          [today]: {
            ...(next.days?.[today] ?? {}),
            [deckId]: planDay({ status: next, deckId, deckWordIds: deck.words, lexiconIds: [...lexicon.entries.keys()], today, media }),
          },
        };
        frozen = true;
      }
      next.sessions = Object.fromEntries(Object.entries(next.sessions ?? {}).filter(([, row]) => row?.day === today));
      next.sessions[sessionId] = { deckId, day: today, openedAt: at };
      return next;
    });
    const plan = this.#publicPlan(status, today, deck, lexicon, media);
    this.#logFold(userId, pkg, folded, 'open');
    this.#logger.info?.('school.word-ladder.opened', {
      learnerId: userId, deckId, package: pkg, day: today, sessionId, frozen, folded: folded.length,
      checks: plan.checks.length, study: plan.study.length, review: plan.review.length, doneToday: plan.doneToday,
    });
    return { sessionId, day: today, deckId, folded: folded.length, plan };
  }

  async plan({ userId, sessionId } = {}) {
    const { status, session, today, pkg } = this.#session(userId, sessionId);
    const { deck, lexicon } = await this.#sessionLoad(session, pkg);
    return { sessionId, day: today, deckId: session.deckId, plan: this.#publicPlan(status, today, deck, lexicon, this.#media(deck, lexicon)) };
  }

  async answerCheck({ userId, sessionId, wordId, choice } = {}) {
    const { session, today, pkg } = this.#session(userId, sessionId);
    const { deck, lexicon } = await this.#sessionLoad(session, pkg);
    const entry = lexicon.entries.get(wordId);
    if (!entry) throw new EntityNotFoundError('word', wordId);
    if (typeof choice !== 'string' || !choice) throw new ValidationError('choice is required');
    const at = this.#at();
    let outcome = null;
    const status = this.#store.update(userId, pkg, (current) => {
      const progress = this.#progress(current, today, session.deckId);
      const item = [...progress.checks, ...progress.review].find((row) => row.wordId === wordId && !row.done);
      if (!item) throw new ValidationError(`'${wordId}' has no open check today`);
      const { choices, answer } = buildChoices(entry, item.direction, today);
      if (!choices.includes(choice)) throw new ValidationError('choice is not one of the offered answers');
      const correct = choice === answer;
      current.words = {
        ...current.words,
        [wordId]: applyCheck(readWord(current, wordId), { at, day: today, correct, phase: item.phase, direction: item.direction }),
      };
      outcome = { correct, answer, phase: item.phase, direction: item.direction };
      return current;
    });
    const media = this.#media(deck, lexicon);
    this.#logger.info?.('school.word-ladder.check', {
      learnerId: userId, sessionId, wordId, ...outcome, state: status.words[wordId].state,
    });
    return {
      wordId, correct: outcome.correct, answer: outcome.answer, card: this.#card(entry, media),
      plan: this.#publicPlan(status, today, deck, lexicon, media),
    };
  }

  #openStudyItem(status, today, deckId, wordId) {
    const progress = this.#progress(status, today, deckId);
    const item = progress.study.find((row) => row.wordId === wordId && !row.done);
    if (!item) throw new ValidationError(`'${wordId}' is not in today's study pass`);
    return item;
  }

  async saveRecording({ userId, sessionId, wordId, buffer, ext = 'webm' } = {}) {
    const { status: before, session, today, pkg } = this.#session(userId, sessionId);
    if (!buffer || buffer.length === 0) throw new ValidationError('recording is empty');
    this.#openStudyItem(before, today, session.deckId, wordId);
    const { deck, lexicon } = await this.#sessionLoad(session, pkg);
    // File first: an orphan file is recoverable, an event pointing at nothing is not.
    let saved;
    try {
      saved = this.#recordings.save({ package: pkg, learnerId: userId, day: today, wordId, buffer, ext });
    } catch (error) {
      this.#logger.error?.('school.word-ladder.recording-write-failed', { learnerId: userId, wordId, error: error.message });
      throw new ValidationError('could not store recording');
    }
    const at = this.#at();
    const status = this.#store.update(userId, pkg, (current) => {
      this.#openStudyItem(current, today, session.deckId, wordId);
      current.words = { ...current.words, [wordId]: applyStudy(readWord(current, wordId), { at, day: today, recording: 'taken', take: saved.take }) };
      return current;
    });
    this.#logger.info?.('school.word-ladder.recording-saved', { learnerId: userId, sessionId, wordId, take: saved.take, bytes: buffer.length });
    return { wordId, take: saved.take, plan: this.#publicPlan(status, today, deck, lexicon, this.#media(deck, lexicon)) };
  }

  async latestRecording({ userId, sessionId, wordId } = {}) {
    const { today, pkg } = this.#session(userId, sessionId);
    const found = this.#recordings.latest({ package: pkg, learnerId: userId, day: today, wordId });
    if (!found) throw new EntityNotFoundError('recording', wordId);
    return found;
  }

  async markCard({ userId, sessionId, wordId, mark, recording = null } = {}) {
    if (!MARKS.has(mark)) throw new ValidationError('mark must be know or learning');
    const { session, today, pkg } = this.#session(userId, sessionId);
    const { deck, lexicon } = await this.#sessionLoad(session, pkg);
    const at = this.#at();
    const unavailable = recording?.status === 'unavailable';
    const status = this.#store.update(userId, pkg, (current) => {
      const item = this.#openStudyItem(current, today, session.deckId, wordId);
      let word = readWord(current, wordId);
      if (!item.studied) {
        if (!unavailable) throw new ValidationError('record the word first');
        word = applyStudy(word, { at, day: today, recording: 'unavailable', reason: String(recording.reason ?? 'unknown').slice(0, 64) });
      }
      current.words = { ...current.words, [wordId]: applyMark(word, { at, day: today, mark }) };
      return current;
    });
    this.#logger.info?.('school.word-ladder.mark', {
      learnerId: userId, sessionId, wordId, mark, recording: unavailable ? 'unavailable' : 'taken', state: status.words[wordId].state,
    });
    return { wordId, state: status.words[wordId].state, plan: this.#publicPlan(status, today, deck, lexicon, this.#media(deck, lexicon)) };
  }

  /** Review run (rev 3): no marks, no recording, no state change; the view is logged. */
  async viewReviewCard({ userId, sessionId, wordId } = {}) {
    const { status: before, session, today, pkg } = this.#session(userId, sessionId);
    const { deck } = await this.#sessionLoad(session, pkg);
    if (!deck.words.includes(wordId)) throw new ValidationError(`'${wordId}' is not in this deck`);
    if (!this.#progress(before, today, session.deckId).complete) {
      throw new ValidationError('the review run opens after today\'s words are done');
    }
    const at = this.#at();
    this.#store.update(userId, pkg, (current) => {
      current.words = { ...current.words, [wordId]: applyReviewView(readWord(current, wordId), { at, day: today }) };
      return current;
    });
    this.#logger.debug?.('school.word-ladder.review-viewed', { learnerId: userId, sessionId, wordId });
    return { wordId, logged: true };
  }

  /**
   * The teacher's "apply scanned quiz": the same fold `open` runs, on demand,
   * for every word package the learner has a word-ladder assignment in.
   */
  async fold({ learnerId, actorId = null, pin = null } = {}) {
    if (!this.#teacherGate) throw new ValidationError('teacher gate is not configured');
    this.#teacherGate.assert({ userId: actorId, pin, action: 'word-ladder.fold', context: { learnerId } });
    const enrollments = await this.#enrollments(learnerId);
    if (!enrollments.length) throw new EntityNotFoundError('word-ladder assignment', learnerId);
    const today = this.#today();
    const byPackage = new Map();
    for (const enrollment of enrollments) {
      const { deck, pkg } = await this.#load(enrollment.deckId ?? enrollment.corpusId);
      if (!byPackage.has(pkg)) byPackage.set(pkg, deck);
    }
    const all = [];
    for (const [pkg, deck] of byPackage) {
      const { attempts, ok: attemptsOk } = this.#readAttempts(learnerId, this.#store.read(learnerId, pkg), today);
      const quizDocumentIds = await this.#quizDocumentIds(deck);
      let folded = [];
      this.#store.update(learnerId, pkg, (current) => {
        const { next, folded: applied } = this.#foldInto(current, attempts, quizDocumentIds, today, attemptsOk);
        folded = applied;
        return next;
      });
      this.#logFold(learnerId, pkg, folded, 'teacher');
      all.push(...folded);
    }
    return { learnerId, folded: all.length, demoted: all.filter((row) => !row.correct).map((row) => row.wordId) };
  }

  /** Read-only credit for the launcher: today (live) or a past study day (replay). */
  async dayStatus({ userId, deckId, day = null } = {}) {
    const today = this.#today();
    const target = day ?? today;
    const { deck, lexicon, pkg } = await this.#load(deckId);
    const status = this.#store.read(userId, pkg);
    let dayPlan = WordLadderStudyService.#frozenPlan(status, target, deckId);
    if (!dayPlan && target === today) {
      dayPlan = planDay({
        status, deckId, deckWordIds: deck.words, lexiconIds: [...lexicon.entries.keys()], today, media: this.#media(deck, lexicon),
      });
    }
    if (!dayPlan) return { doneToday: false, progressLabel: 'Not opened', remaining: null };
    const progress = dayProgress({ dayPlan, words: status.words, day: target });
    return { doneToday: progress.complete, progressLabel: progressLabel(progress), remaining: progress.remaining };
  }
}

export default WordLadderStudyService;
