// backend/src/3_applications/school/WordLadderSittingService.mjs
/**
 * The word ladder's application service (mastery redesign rev 4, spec §4/§8).
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
 * (`atOpen.settings`); current settings are only the fallback for a day that
 * has none.
 */
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';
import { offsetMinutesFor, studyDayForInstant } from '#domains/school/studyDay.mjs';
import { addDays } from '#domains/school/termVerdict.mjs';
import {
  addActiveTime, currentItem, foldPaperAttempts, openDay, quizDocumentIdFor, respond, wordAssetIds,
} from '#domains/school/wordLadder/index.mjs';

const FOLD_LOOKBACK_DAYS = 60;
const FOLD_SKEW_DAYS = 2;
const TEST_PREFIX = 'test.';
const CLOSE_REASONS = new Set(['goal', 'cap', 'leave', 'idle', 'unmount']);
const IDLE_CLOSE_MS = 5 * 60_000;

/** An ISO instant carrying the household's own offset: `2026-09-22T16:05:12-07:00`. */
function isoWithOffset(ms, timezone) {
  const offset = offsetMinutesFor(timezone, ms);
  const local = new Date(ms + offset * 60_000).toISOString().slice(0, 19);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export class WordLadderSittingService {
  #stores; #decks; #lexicons; #assignments; #attempts; #assets; #judge; #teacherGate; #settings; #timezone; #now; #logger; #mode;
  #counter = 0;

  constructor({
    stores, decks, lexicons, assignments, attempts = null, assets = null, judge, teacherGate = null,
    settings, timezone = null, now, logger = console, mode = 'live',
  } = {}) {
    if (typeof stores?.open !== 'function' || typeof stores?.forToken !== 'function') throw new Error('WordLadderSittingService requires stores');
    if (typeof decks?.getFlashcardDeck !== 'function') throw new Error('WordLadderSittingService requires decks.getFlashcardDeck');
    if (typeof lexicons?.getLexicon !== 'function') throw new Error('WordLadderSittingService requires lexicons.getLexicon');
    if (typeof assignments?.get !== 'function') throw new Error('WordLadderSittingService requires assignments');
    if (typeof judge?.judge !== 'function') throw new Error('WordLadderSittingService requires a judge');
    if (typeof settings !== 'function' || typeof now !== 'function') throw new Error('WordLadderSittingService requires settings() and now()');
    if (mode !== 'live' && mode !== 'test') throw new Error(`WordLadderSittingService mode must be live or test, got '${mode}'`);
    this.#stores = stores; this.#decks = decks; this.#lexicons = lexicons; this.#assignments = assignments;
    this.#attempts = attempts; this.#assets = assets; this.#judge = judge; this.#teacherGate = teacherGate;
    this.#settings = settings; this.#timezone = timezone; this.#now = now; this.#logger = logger; this.#mode = mode;
  }

  #today(ms = this.#now()) { return studyDayForInstant(ms, { timezone: this.#timezone }); }

  /** The tuning values in force for a day: its at-open snapshot, else current settings. */
  #daySettings(dayFile) { return dayFile?.atOpen?.settings ?? this.#settings(); }

  async #enrollments(userId) {
    const assignment = await this.#assignments.get(userId);
    return (assignment?.programs ?? []).filter((row) => row?.programId === 'flashcards' && row.policy?.mode === 'word-ladder');
  }

  async #assertAssigned(userId, deckId) {
    if (typeof userId !== 'string' || !userId) throw new ValidationError('userId is required');
    if (typeof deckId !== 'string' || !deckId) throw new ValidationError('deckId is required');
    const ok = (await this.#enrollments(userId)).some((row) => (row.deckId ?? row.corpusId) === deckId);
    if (!ok) throw new GuestForbiddenError(`'${userId}' has no word-ladder assignment for '${deckId}'`);
  }

  /** The deck, its validated lexicon, and the word package both belong to. */
  async #load(deckId) {
    const deck = await this.#decks.getFlashcardDeck(deckId);
    if (!deck || !Array.isArray(deck.words) || typeof deck.lexicon !== 'string') throw new EntityNotFoundError('word-ladder deck', deckId);
    const lexicon = this.#lexicons.getLexicon(deck.lexicon);
    return { deck, lexicon, pkg: lexicon.package };
  }

  async packageOf(deckId) { return (await this.#load(deckId)).pkg; }

  #has(assetId) { try { return this.#assets?.exists?.(assetId) === true; } catch { return false; } }

  /** Per word: which assets exist (booleans, what the engine reads) and their ids. */
  #media(deck, lexicon) {
    const media = {};
    for (const entry of lexicon.entries.values()) {
      const ids = wordAssetIds(deck.lexicon, entry);
      media[entry.id] = { image: this.#has(ids.image), audio: this.#has(ids.audio), glossAudio: this.#has(ids.glossAudio), ids };
    }
    return media;
  }

  /** Words still new, across every deck the learner has seen (in order) plus this one. */
  async #pool(status, deck) {
    const order = [...status.decksSeen];
    if (!order.includes(deck.id)) order.push(deck.id);
    const ids = [];
    for (const deckId of order) {
      const other = deckId === deck.id ? deck : await this.#decks.getFlashcardDeck(deckId).catch(() => null);
      for (const id of other?.words ?? []) if (!ids.includes(id)) ids.push(id);
    }
    return ids.filter((id) => (status.words[id]?.state ?? 'new') === 'new');
  }

  /**
   * What the client may see. Only ungraded items (flashcard, copy) carry the
   * word card. Graded items carry cue asset ids but never the answer: a 2.2
   * item's prompt is the term (its answer is the gloss, among the choices);
   * 3.1 / 3.3 carry no term, and never the term's audio.
   */
  #publicItem(item, lexicon, media) {
    const entry = item.wordId ? lexicon.entries.get(item.wordId) : null;
    const m = media[item.wordId] ?? {};
    const assets = {
      image: m.image ? m.ids.image : null, audio: m.audio ? m.ids.audio : null, glossAudio: m.glossAudio ? m.ids.glossAudio : null,
    };
    if (item.type === 'flashcard' || item.type === 'copy') {
      return {
        ...item,
        word: { wordId: entry.id, term: entry.term, gloss: entry.gloss, pronunciation: entry.pronunciation ?? null, kind: entry.kind, media: assets },
      };
    }
    if (item.type === 'typed' || item.type === 'choice') {
      const cueAssets = {
        image: item.cue?.type === 'image' ? assets.image : null,
        audio: item.task === '2.2' && item.channel === 'hear' ? assets.audio : null,
        glossAudio: item.cue?.type === 'audio' ? assets.glossAudio : null,
      };
      // On 3.1 / 3.3 the gloss IS the cue (the term is the answer), so an image
      // cue always carries it as text: the client falls back to it when the
      // picture is missing or fails to load, rather than showing nothing.
      const cue = item.cue?.type === 'image' && (item.task === '3.1' || item.task === '3.3')
        ? { ...item.cue, text: entry.gloss }
        : item.cue;
      return { ...item, ...(item.task === '2.2' ? { prompt: entry.term } : {}), ...(cue ? { cue } : {}), assets: cueAssets };
    }
    return item;
  }

  #progress(dayFile, settings) {
    const round = dayFile.rounds.find((r) => r.phase !== 'done') ?? null;
    const rechecksLeft = dayFile.rechecks.order.filter((id) => !dayFile.rechecks.answered[id]).length;
    return {
      phase: rechecksLeft ? 'rechecks' : round ? 'round' : 'summary',
      rechecksLeft,
      round: round ? {
        index: dayFile.rounds.indexOf(round) + 1, kind: round.kind, size: round.words.length, phase: round.phase,
        remainingInStream: round.stream.queue.length, quizLeft: round.quiz.queue.length - round.quiz.index,
      } : null,
      activeMs: dayFile.activeMs,
      capMs: settings.session.capMinutes * 60000,
    };
  }

  #parseSitting(sittingId) {
    if (typeof sittingId !== 'string' || !sittingId) throw new EntityNotFoundError('word-ladder sitting', sittingId);
    const test = sittingId.startsWith(TEST_PREFIX);
    // Live ids are refused by the test service and vice versa (spec §8).
    if (test !== (this.#mode === 'test')) throw new EntityNotFoundError('word-ladder sitting', sittingId);
    const parts = sittingId.slice(test ? TEST_PREFIX.length : 0).split('.');
    if (parts.length < 3 || !parts[0] || !parts[1]) throw new EntityNotFoundError('word-ladder sitting', sittingId);
    return { pkg: parts[0], token: parts[1] };
  }

  /** A sitting belongs to its study day: after the day boundary it 404s and the client reopens. */
  async #context(userId, sittingId) {
    if (typeof userId !== 'string' || !userId) throw new ValidationError('userId is required');
    const { pkg, token } = this.#parseSitting(sittingId);
    let store;
    try { store = this.#stores.forToken(token); } catch { throw new EntityNotFoundError('word-ladder sitting', sittingId); }
    const day = this.#today();
    const dayFile = store.readDay(userId, pkg, day);
    const sitting = dayFile.sittings?.[sittingId];
    if (!sitting) throw new EntityNotFoundError('word-ladder sitting', sittingId);
    const { deck, lexicon, pkg: deckPkg } = await this.#load(sitting.deckId);
    // A deck moved to another package must not write across packages.
    if (deckPkg !== pkg) throw new EntityNotFoundError('word-ladder sitting', sittingId);
    const status = store.readStatus(userId, pkg);
    const media = this.#media(deck, lexicon);
    const settings = this.#daySettings(dayFile);
    const ctx = { status, dayFile, day, lexicon, media, pool: await this.#pool(status, deck), settings, learnerId: userId };
    return { store, pkg, lexicon, media, settings, ctx, day, sitting };
  }

  /**
   * Sitting bookkeeping for a request on `sittingId` (spec §4 server idle
   * close). Mutates `dayFile`: a closed `sittingId` is reopened (a reload or a
   * late answer must never 404), and when the day has had no input for 5 min
   * every OTHER open sitting is closed as idle at the last input. Returns what
   * changed, for logging.
   */
  #housekeep(dayFile, sittingId, nowMs, { reopen = true } = {}) {
    const changes = { reopened: false, idleClosed: [] };
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
    }
    return changes;
  }

  #logHousekeeping(userId, sittingId, dayFile, changes) {
    if (changes.reopened) this.#logger.info?.('school.word-ladder.reopened', { learnerId: userId, sittingId, mode: this.#mode });
    for (const id of changes.idleClosed) {
      this.#logger.info?.('school.word-ladder.closed', {
        learnerId: userId, sittingId: id, mode: this.#mode, reason: 'idle', closedAt: dayFile.sittings[id]?.closedAt ?? null, by: sittingId,
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
      this.#logger.warn?.('school.word-ladder.attempts-unreadable', { learnerId: userId, mode: this.#mode, error: error.message });
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
      this.#logger.warn?.('school.word-ladder.decks-unlisted', { error: error.message });
    }
    return [...ids];
  }

  #fold(status, { attempts, ok }, quizDocumentIds, today, settings) {
    const out = foldPaperAttempts({
      status, attempts, quizDocumentIds,
      dayOf: (at) => studyDayForInstant(Date.parse(at), { timezone: this.#timezone }),
      settings: { afterMisses: settings.drill.afterMisses, gapScale: settings.review.gapScale },
    });
    if (ok) out.status.lastFoldedDay = today;
    return out;
  }

  #logFold(learnerId, pkg, folded, source) {
    if (!folded.length) return;
    this.#logger.info?.('school.word-ladder.folded', {
      learnerId, package: pkg, source, mode: this.#mode, count: folded.length,
      demoted: folded.filter((row) => !row.correct).map((row) => row.wordId),
    });
  }

  #newSittingId(pkg, token) {
    this.#counter += 1;
    return `${this.#mode === 'test' ? TEST_PREFIX : ''}${pkg}.${token}.${this.#now().toString(36)}${this.#counter.toString(36)}`;
  }

  /** Opens (or resumes) today's sitting. Paper attempts fold here — only here, never mid-sitting. */
  async open({ userId, deckId, scenario = null } = {}) {
    await this.#assertAssigned(userId, deckId);
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
    const pool = await this.#pool(before, deck);
    let folded = [];
    let changes = { reopened: false, idleClosed: [] };
    const next = store.transact(userId, pkg, day, ({ status, dayFile }) => {
      const settings = this.#daySettings(dayFile);
      const afterFold = this.#fold(status, read, quizDocumentIds, day, settings);
      folded = afterFold.folded;
      const opened = openDay({ status: afterFold.status, dayFile, day, deckId, pool, settings, learnerId: userId, at: isoWithOffset(openedMs, this.#timezone), media, capabilities: null });
      changes = this.#housekeep(opened.dayFile, sittingId, openedMs, { reopen: false });
      opened.dayFile.sittings[sittingId] = { deckId, openedAt: isoWithOffset(openedMs, this.#timezone), closedAt: null, reason: null };
      return opened;
    });
    this.#logHousekeeping(userId, sittingId, next.dayFile, changes);
    const settings = this.#daySettings(next.dayFile);
    const ctx = { status: next.status, dayFile: next.dayFile, day, lexicon, media, pool, settings, learnerId: userId };
    const item = currentItem(ctx);
    const progress = this.#progress(next.dayFile, settings);
    this.#logFold(userId, pkg, folded, 'open');
    this.#logger.info?.('school.word-ladder.opened', {
      learnerId: userId, deckId, package: pkg, day, sittingId, mode: this.#mode, scenario, folded: folded.length,
      first: item.type, phase: progress.phase, rechecks: next.dayFile.atOpen?.dueRechecks?.length ?? 0,
    });
    return {
      sittingId, day, package: pkg, title: lexicon.program.title,
      language: { code: lexicon.language.code, name: lexicon.language.name },
      gloss: { code: lexicon.gloss.code, name: lexicon.gloss.name },
      item: this.#publicItem(item, lexicon, media), progress,
    };
  }

  /** The client's response object is passed to the engine unchanged (no default flags spread in). */
  async respond({ userId, sittingId, itemId, response } = {}) {
    const { store, pkg, lexicon, media, ctx, day } = await this.#context(userId, sittingId);
    if (typeof itemId !== 'string' || !itemId) throw new ValidationError('itemId is required');
    const item = currentItem(ctx);
    let verdict = null;
    if (item.id === itemId && item.type === 'typed' && !ctx.dayFile.items[itemId] && typeof response?.typed === 'string') {
      const entry = lexicon.entries.get(item.wordId);
      const otherWords = [
        ...Object.entries(ctx.status.words).filter(([id, w]) => id !== entry.id && w.state !== 'new').map(([id]) => lexicon.entries.get(id)?.term),
        ...(entry.decoys?.term ?? []),
      ].filter(Boolean);
      verdict = await this.#judge.judge({ pkg, entry, typed: response.typed, otherWords });
    }
    const ms = this.#now();
    const at = isoWithOffset(ms, this.#timezone);
    let changes = null;
    const out = store.transact(userId, pkg, day, ({ status, dayFile }) => {
      if (!dayFile.sittings?.[sittingId]) throw new EntityNotFoundError('word-ladder sitting', sittingId);
      // Race: another request answered while this one was being prepared, so
      // the typed item now on screen was never judged here. Stale, not a
      // missing verdict.
      const fresh = currentItem({ ...ctx, status, dayFile });
      if (verdict === null && fresh.type === 'typed' && fresh.id === itemId && !dayFile.items[itemId] && typeof response?.typed === 'string') {
        throw new ValidationError('stale item');
      }
      changes = this.#housekeep(dayFile, sittingId, ms);
      const timed = addActiveTime(dayFile, ms);
      const step = respond({ ...ctx, status, dayFile: timed }, itemId, response, { at, verdict });
      return { status: step.status, dayFile: step.dayFile, result: step.result };
    });
    this.#logHousekeeping(userId, sittingId, out.dayFile, changes);
    const nextCtx = { ...ctx, status: out.status, dayFile: out.dayFile };
    const nextItem = currentItem(nextCtx);
    this.#logger.info?.('school.word-ladder.graded', {
      learnerId: userId, sittingId, mode: this.#mode, itemId, type: item.id === itemId ? item.type : null,
      task: item.id === itemId ? item.task ?? null : null, wordId: item.id === itemId ? item.wordId ?? null : null,
      correct: out.result?.correct ?? null, score: verdict?.score ?? null, judge: verdict?.judge ?? null,
      next: nextItem.type, doneAt: out.dayFile.doneAt ?? null,
    });
    return { result: out.result, item: this.#publicItem(nextItem, lexicon, media), progress: this.#progress(out.dayFile, ctx.settings) };
  }

  async get({ userId, sittingId } = {}) {
    const { store, pkg, day, lexicon, media, settings, ctx } = await this.#context(userId, sittingId);
    const nowMs = this.#now();
    // Only write when bookkeeping changes something: a reload is otherwise read-only.
    const probe = this.#housekeep(structuredClone(ctx.dayFile), sittingId, nowMs);
    if (probe.reopened || probe.idleClosed.length) {
      let changes = null;
      const out = store.transact(userId, pkg, day, ({ status, dayFile }) => {
        changes = this.#housekeep(dayFile, sittingId, nowMs);
        return { status, dayFile };
      });
      this.#logHousekeeping(userId, sittingId, out.dayFile, changes);
      ctx.dayFile = out.dayFile;
      ctx.status = out.status;
    }
    return { item: this.#publicItem(currentItem(ctx), lexicon, media), progress: this.#progress(ctx.dayFile, settings) };
  }

  async close({ userId, sittingId, reason = 'leave' } = {}) {
    const { store, pkg, day, ctx, sitting } = await this.#context(userId, sittingId);
    if (sitting.closedAt) return { closed: true, already: true };
    const why = CLOSE_REASONS.has(reason) ? reason : 'leave';
    const nowMs = this.#now();
    const at = isoWithOffset(nowMs, this.#timezone);
    let changes = null;
    const out = store.transact(userId, pkg, day, ({ status, dayFile }) => {
      changes = this.#housekeep(dayFile, sittingId, nowMs, { reopen: false });
      const row = dayFile.sittings[sittingId];
      if (row && !row.closedAt) dayFile.sittings[sittingId] = { ...row, closedAt: at, reason: why };
      return { status, dayFile };
    });
    this.#logHousekeeping(userId, sittingId, out.dayFile, changes);
    this.#logger.info?.('school.word-ladder.closed', {
      learnerId: userId, sittingId, mode: this.#mode, reason: why, activeMs: ctx.dayFile.activeMs, doneAt: ctx.dayFile.doneAt ?? null,
    });
    return { closed: true };
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
      const deckId = enrollment.deckId ?? enrollment.corpusId;
      // One unloadable deck must not block folding every other package.
      try {
        const { deck, pkg } = await this.#load(deckId);
        if (!byPackage.has(pkg)) byPackage.set(pkg, deck);
      } catch (error) {
        this.#logger.warn?.('school.word-ladder.fold-deck-skipped', { learnerId, deckId, error: error.message });
      }
    }
    const all = [];
    for (const [pkg, deck] of byPackage) {
      const { store } = this.#stores.open(learnerId, pkg, today, {});
      const read = this.#readAttempts(learnerId, store.readStatus(learnerId, pkg), today);
      const quizDocumentIds = await this.#quizDocumentIds(deck);
      let folded = [];
      store.transact(learnerId, pkg, today, ({ status, dayFile }) => {
        const out = this.#fold(status, read, quizDocumentIds, today, this.#daySettings(dayFile));
        folded = out.folded;
        return { status: out.status, dayFile };
      });
      this.#logFold(learnerId, pkg, folded, 'teacher');
      all.push(...folded);
    }
    return { learnerId, folded: all.length, demoted: all.filter((row) => !row.correct).map((row) => row.wordId) };
  }

  /** Read-only credit for the launcher: today (live) or a past study day (replay). Live only. */
  async dayStatus({ userId, deckId, day = null } = {}) {
    // Opening a test store snapshots a new shadow; credit never comes from test mode.
    if (this.#mode !== 'live') throw new ValidationError('dayStatus is answered by the live word ladder only');
    const target = day ?? this.#today();
    try {
      const { pkg } = await this.#load(deckId);
      const { store } = this.#stores.open(userId, pkg, target, { readOnly: true });
      const dayFile = store.readDay(userId, pkg, target);
      if (!dayFile.atOpen) return { doneToday: false, progressLabel: 'Not opened', remaining: null };
      return { doneToday: Boolean(dayFile.doneAt), progressLabel: dayFile.doneAt ? 'Done for today' : 'In progress', remaining: null };
    } catch (error) {
      // A broken deck answers like a day never opened; it must not throw
      // through the launcher and take the rest of the agenda with it.
      this.#logger.warn?.('school.word-ladder.day-status-unloadable', { learnerId: userId, deckId, day: target, error: error.message });
      return { doneToday: false, progressLabel: 'Not opened', remaining: null };
    }
  }
}

export default WordLadderSittingService;
