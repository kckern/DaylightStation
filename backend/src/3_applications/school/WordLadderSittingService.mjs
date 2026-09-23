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
 * (`atOpen.settings`); current settings — the School config's resolved
 * settings with the learner's `tuning.yml` values laid over them (spec §7) —
 * are only the fallback for a day that has none, so a tuning change lands at
 * the next day's first open, never mid-day. This service only READS tuning.
 *
 * Speaking is never graded (spec §3): a take is kept for grown-ups through the
 * recordings sink (a discarding one in test mode) and never touches status.
 */
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';
import { offsetMinutesFor, studyDayForInstant } from '#domains/school/studyDay.mjs';
import { addDays } from '#domains/school/termVerdict.mjs';
import { curriculumPosterRef } from '#apps/common/resources/publicResourceRefs.mjs';
import {
  addActiveTime, cueFor, currentItem, deckDirOf, deckProgress, emptyWordV3, introPlanLabel, introPreview, excludeWordFromDay, foldPaperAttempts, markMastered, normalizeAnswer, openDay,
  quizDocumentIdFor, respond, startPractice, typedAnswers, withTunedValues, wordAssetIds, wordTransitions,
} from '#domains/school/wordLadder/index.mjs';

const FOLD_LOOKBACK_DAYS = 60;
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
// Grown-up word controls (spec §6): how far back a word's typed answers are listed.
const ADMIN_TYPED_DAYS = 14;
const REGRADE_REASON = 'Re-graded by a grown-up';
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** An ISO instant carrying the household's own offset: `2026-09-22T16:05:12-07:00`. */
function isoWithOffset(ms, timezone) {
  const offset = offsetMinutesFor(timezone, ms);
  const local = new Date(ms + offset * 60_000).toISOString().slice(0, 19);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export class WordLadderSittingService {
  #stores; #decks; #lexicons; #assignments; #attempts; #assets; #judge; #judgementCache; #teacherGate; #recordings; #settings; #bounds; #timezone; #now; #logger; #mode;
  #counter = 0;

  constructor({
    stores, decks, lexicons, assignments, attempts = null, assets = null, judge, judgementCache = null, teacherGate = null, recordings = null,
    settings, bounds = null, timezone = null, now, logger = console, mode = 'live',
  } = {}) {
    if (typeof stores?.open !== 'function' || typeof stores?.forToken !== 'function') throw new Error('WordLadderSittingService requires stores');
    if (typeof decks?.getFlashcardDeck !== 'function') throw new Error('WordLadderSittingService requires decks.getFlashcardDeck');
    if (typeof lexicons?.getLexicon !== 'function') throw new Error('WordLadderSittingService requires lexicons.getLexicon');
    if (typeof assignments?.get !== 'function') throw new Error('WordLadderSittingService requires assignments');
    if (typeof judge?.judge !== 'function') throw new Error('WordLadderSittingService requires a judge');
    if (typeof settings !== 'function' || typeof now !== 'function') throw new Error('WordLadderSittingService requires settings() and now()');
    if (mode !== 'live' && mode !== 'test') throw new Error(`WordLadderSittingService mode must be live or test, got '${mode}'`);
    if (recordings !== null && typeof recordings?.save !== 'function') throw new Error('WordLadderSittingService recordings must have save()');
    if (judgementCache !== null && typeof judgementCache?.set !== 'function') throw new Error('WordLadderSittingService judgementCache must have set()');
    this.#recordings = recordings;
    this.#judgementCache = judgementCache;
    this.#stores = stores; this.#decks = decks; this.#lexicons = lexicons; this.#assignments = assignments;
    this.#attempts = attempts; this.#assets = assets; this.#judge = judge; this.#teacherGate = teacherGate;
    this.#settings = settings; this.#bounds = bounds; this.#timezone = timezone; this.#now = now; this.#logger = logger; this.#mode = mode;
  }

  #today(ms = this.#now()) { return studyDayForInstant(ms, { timezone: this.#timezone }); }

  /** Current settings for a learner's package: config settings + their tuned values (clamped to spec and household bounds). */
  #currentSettings(store, userId, pkg) {
    let values = null;
    try { values = store.readTuning?.(userId, pkg)?.values ?? null; } catch (error) {
      this.#logger.warn?.('school.word-ladder.tuning-unreadable', { learnerId: userId, package: pkg, error: error.message });
    }
    return withTunedValues(this.#settings(), values, this.#bounds);
  }

  /** The tuning values in force for a day: its at-open snapshot, else current settings. */
  #daySettings(dayFile, { store, userId, pkg }) { return dayFile?.atOpen?.settings ?? this.#currentSettings(store, userId, pkg); }

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

  /** Word ids across every deck the learner has seen (in order) plus this one. */
  async #deckOrder(status, deck) {
    const order = [...status.decksSeen];
    if (!order.includes(deck.id)) order.push(deck.id);
    const ids = [];
    for (const deckId of order) {
      const other = deckId === deck.id ? deck : await this.#decks.getFlashcardDeck(deckId).catch(() => null);
      for (const id of other?.words ?? []) if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  /** Words still new, across every deck the learner has seen (in order) plus this one. */
  async #pool(status, deck) {
    return (await this.#deckOrder(status, deck)).filter((id) => (status.words[id]?.state ?? 'new') === 'new');
  }

  /**
   * What the client may see (spec §3). Supported and exposure tasks (look,
   * copy, say-after, flashcards, the drill offer) carry the word card.
   * Unsupported tasks carry only their given half: read-aloud the text (the
   * native audio arrives with the take), dictation the audio, tiles / type /
   * say-from-cue the cue (and tiles the syllables). Graded items carry cue asset
   * ids but never the answer: a 2.2 item's prompt is the term (its answer is
   * the gloss, among the choices); 3.1 / 3.3 carry no term, and never the
   * term's audio. An image cue always carries the gloss as its text fallback.
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
    const withFallback = (cue) => (cue?.type === 'image' ? { ...cue, text: entry.gloss } : cue);
    const cueAssets = (cue) => ({ image: cue?.type === 'image' ? assets.image : null, audio: null, glossAudio: cue?.type === 'audio' ? assets.glossAudio : null });
    const cued = (cue) => ({ ...item, cue: withFallback(cue), assets: cueAssets(cue) });
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
      if (speaking === 'say-from-cue' || speaking === 'type') return cued(item.cue);
      if (item.type === 'drill' && item.step === 'match') return { ...item, board: board(item.board) };
      if (item.type === 'drill' && item.step === 'dictation') return { ...item, assets: { ...NO_ASSETS, audio: assets.audio } };
      if (item.type === 'drill' && item.step === 'tiles') {
        return cued(item.cue ?? cueFor(entry, media[item.wordId] ?? {}, `${ctx.learnerId}|${ctx.day}|${item.id}|tiles`));
      }
      return { ...item, word: card() }; // look, copy, say-after
    }
    if (item.type === 'typed' || item.type === 'choice') {
      const graded = {
        image: item.cue?.type === 'image' ? assets.image : null,
        audio: item.task === '2.2' && item.channel === 'hear' ? assets.audio : null,
        glossAudio: item.cue?.type === 'audio' ? assets.glossAudio : null,
      };
      // On 3.1 / 3.3 the gloss IS the cue (the term is the answer), so an image
      // cue always carries it as text: the client falls back to it when the
      // picture is missing or fails to load, rather than showing nothing.
      const cue = item.task === '3.1' || item.task === '3.3' ? withFallback(item.cue) : item.cue;
      return { ...item, ...(item.task === '2.2' ? { prompt: entry.term } : {}), ...(cue ? { cue } : {}), assets: graded };
    }
    return item;
  }

  #progress(dayFile, settings) {
    const round = dayFile.rounds.find((r) => r.phase !== 'done') ?? null;
    const rechecksLeft = dayFile.rechecks.order.filter((id) => !dayFile.rechecks.answered[id]).length;
    const drill = (dayFile.drills ?? []).find((d) => !d.done) ?? null;
    const run = dayFile.practice;
    const practicing = Boolean(dayFile.doneAt && dayFile.summarySeen && run && run.index < run.queue.length);
    let phase = 'summary';
    if (rechecksLeft) phase = 'rechecks';
    else if (drill) phase = 'drill';
    else if (round) phase = 'round';
    else if (practicing) phase = 'practice';
    return {
      phase,
      rechecksLeft,
      drill: drill ? { at: drill.index + 1, of: drill.steps.length } : null,
      practice: practicing ? { mode: run.mode, at: run.index + 1, of: run.queue.length } : null,
      round: round ? {
        index: dayFile.rounds.indexOf(round) + 1, kind: round.kind, size: round.words.length, phase: round.phase,
        remainingInStream: round.stream.queue.length, quizLeft: round.quiz.queue.length - round.quiz.index,
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
      learnToday: round ? round.newWords?.length > 0 : dayFile.rounds.some((r) => r.newWords?.length > 0),
      doneToday: Boolean(dayFile.doneAt),
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
    const settings = this.#daySettings(dayFile, { store, userId, pkg });
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
      this.#logger.warn?.('school.word-ladder.fold-refused', { learnerId, package: pkg, mode: this.#mode, ...row });
    }
    return out;
  }

  #logFold(learnerId, pkg, folded, source) {
    if (!folded.length) return;
    this.#logger.info?.('school.word-ladder.folded', {
      learnerId, package: pkg, source, mode: this.#mode, count: folded.length,
      demoted: folded.filter((row) => !row.correct).map((row) => row.wordId),
    });
  }

  /** One `transition` event per word whose state or stage changed (spec §8). */
  #logTransitions({ learnerId, sittingId = null, pkg, day, itemId = null }, transitions) {
    for (const row of transitions ?? []) {
      this.#logger.info?.('school.word-ladder.transition', {
        learnerId, sittingId, mode: this.#mode, package: pkg, day, itemId,
        wordId: row.wordId, from: row.from, to: row.to, source: row.source,
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
    let foldTransitions = [];
    let changes = { reopened: false, idleClosed: [] };
    const next = store.transact(userId, pkg, day, ({ status, dayFile }) => {
      const settings = this.#daySettings(dayFile, { store, userId, pkg });
      const afterFold = this.#fold(status, read, quizDocumentIds, day, settings, { learnerId: userId, deckDir: deckDirOf(deck.id), pkg });
      folded = afterFold.folded;
      foldTransitions = afterFold.transitions;
      const opened = openDay({ status: afterFold.status, dayFile, day, deckId, pool, settings, learnerId: userId, at: isoWithOffset(openedMs, this.#timezone), media, capabilities: caps, lexicon });
      changes = this.#housekeep(opened.dayFile, sittingId, openedMs, { reopen: false });
      opened.dayFile.sittings[sittingId] = { deckId, openedAt: isoWithOffset(openedMs, this.#timezone), closedAt: null, reason: null };
      return opened;
    });
    this.#logHousekeeping(userId, sittingId, next.dayFile, changes);
    const settings = this.#daySettings(next.dayFile, { store, userId, pkg });
    const ctx = { status: next.status, dayFile: next.dayFile, day, lexicon, media, pool, settings, learnerId: userId };
    const item = currentItem(ctx);
    const progress = this.#progress(next.dayFile, settings);
    this.#logFold(userId, pkg, folded, 'open');
    this.#logTransitions({ learnerId: userId, sittingId, pkg, day }, foldTransitions);
    this.#logger.info?.('school.word-ladder.opened', {
      learnerId: userId, deckId, package: pkg, day, sittingId, mode: this.#mode, scenario, folded: folded.length, microphone: caps.microphone,
      first: item.type, phase: progress.phase, rechecks: next.dayFile.atOpen?.dueRechecks?.length ?? 0,
    });
    return {
      sittingId, day, package: pkg, title: lexicon.program.title,
      language: { code: lexicon.language.code, name: lexicon.language.name },
      gloss: { code: lexicon.gloss.code, name: lexicon.gloss.name },
      item: this.#publicItem(item, ctx), progress,
    };
  }

  /** The client's response object is passed to the engine unchanged (no default flags spread in). */
  async respond({ userId, sittingId, itemId, response } = {}) {
    const { store, pkg, lexicon, ctx, day } = await this.#context(userId, sittingId);
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
    let transitions = [];
    let graded = null;
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
      ({ transitions, graded } = step);
      return { status: step.status, dayFile: step.dayFile, result: step.result };
    });
    this.#logHousekeeping(userId, sittingId, out.dayFile, changes);
    const nextCtx = { ...ctx, status: out.status, dayFile: out.dayFile };
    const nextItem = currentItem(nextCtx);
    // Every response is `answered`; only a graded answer (verify, recheck,
    // practice Quiz me) is also `graded` (spec §8 events).
    this.#logger.info?.('school.word-ladder.answered', {
      learnerId: userId, sittingId, mode: this.#mode, itemId, type: item.id === itemId ? item.type : null,
      task: item.id === itemId ? item.task ?? null : null, wordId: item.id === itemId ? item.wordId ?? null : null,
      correct: out.result?.correct ?? null, score: verdict?.score ?? null, judge: verdict?.judge ?? null,
      next: nextItem.type, doneAt: out.dayFile.doneAt ?? null,
    });
    if (graded) {
      this.#logger.info?.('school.word-ladder.graded', {
        learnerId: userId, sittingId, mode: this.#mode, package: pkg, day, itemId,
        wordId: graded.wordId, task: graded.task, source: graded.source, correct: graded.correct,
        score: graded.score ?? null, judge: graded.judge ?? null,
      });
    }
    this.#logTransitions({ learnerId: userId, sittingId, pkg, day, itemId }, transitions);
    return { result: out.result, item: this.#publicItem(nextItem, nextCtx), progress: this.#progress(out.dayFile, ctx.settings) };
  }

  async get({ userId, sittingId } = {}) {
    const { store, pkg, day, settings, ctx } = await this.#context(userId, sittingId);
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
    return { item: this.#publicItem(currentItem(ctx), ctx), progress: this.#progress(ctx.dayFile, settings) };
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
    if (!this.#recordings) throw new ValidationError('word-ladder recordings are not configured');
    const saved = await this.#recordings.save({ package: pkg, learnerId: userId, day, wordId: item.wordId, buffer, ext: format });
    const take = saved?.take ?? null;
    this.#logger.info?.('school.word-ladder.recorded', {
      learnerId: userId, sittingId, mode: this.#mode, itemId, wordId: item.wordId, step, take, bytes: buffer.length,
    });
    if (!REVEAL_AFTER_TAKE.has(step)) return { take };
    const entry = ctx.lexicon.entries.get(item.wordId);
    const m = media[item.wordId] ?? {};
    return { take, reveal: { term: entry.term, audio: m.audio ? m.ids.audio : null } };
  }

  /** Opens a practice run (spec §6 practice menu); the engine refuses one before today's goal. */
  async practice({ userId, sittingId, mode, help = true, filter = 'introduced', chosen = [], frontSide = 'term' } = {}) {
    const { store, pkg, day, ctx, settings } = await this.#context(userId, sittingId);
    const ms = this.#now();
    let changes = null;
    const out = store.transact(userId, pkg, day, ({ status, dayFile }) => {
      if (!dayFile.sittings?.[sittingId]) throw new EntityNotFoundError('word-ladder sitting', sittingId);
      changes = this.#housekeep(dayFile, sittingId, ms);
      return startPractice({ ...ctx, status, dayFile: addActiveTime(dayFile, ms) }, { mode, help, filter, chosen, frontSide });
    });
    this.#logHousekeeping(userId, sittingId, out.dayFile, changes);
    const nextCtx = { ...ctx, status: out.status, dayFile: out.dayFile };
    const item = currentItem(nextCtx);
    this.#logger.info?.('school.word-ladder.practice', {
      learnerId: userId, sittingId, mode: this.#mode, practice: mode, help: help !== false, filter,
      size: out.dayFile.practice?.queue?.length ?? 0, first: item.type,
    });
    return { item: this.#publicItem(item, nextCtx), progress: this.#progress(out.dayFile, settings) };
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
          stage: word.stage ?? 0, tricky: word.tricky === true, dueDay: word.dueDay ?? null,
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
      const deckDir = deckDirOf(deck.id);
      let folded = [];
      let transitions = [];
      store.transact(learnerId, pkg, today, ({ status, dayFile }) => {
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
  // logs `school.word-ladder.admin` and a `transition` (source `admin`) for
  // each word whose state or stage it changed.

  async #admin({ learnerId, deckId, actorId, pin }) {
    if (this.#mode !== 'live') throw new ValidationError('word-ladder admin is answered by the live word ladder only');
    if (!this.#teacherGate) throw new ValidationError('teacher gate is not configured');
    this.#teacherGate.assert({ userId: actorId, pin, action: 'word-ladder.admin', context: { learnerId } });
    await this.#assertAssigned(learnerId, deckId);
    const { deck, lexicon, pkg } = await this.#load(deckId);
    const day = this.#today();
    const { store } = this.#stores.open(learnerId, pkg, day, {});
    return { deck, lexicon, pkg, day, store };
  }

  #logAdmin({ actorId, learnerId, pkg, day }, action, extra = {}) {
    this.#logger.info?.('school.word-ladder.admin', {
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
    if (typeof wordId !== 'string' || !lexicon.entries.has(wordId)) throw new EntityNotFoundError('word-ladder word', String(wordId));
    const prepared = prepare ? await prepare(found) : {};
    let transitions = [];
    let word = null;
    store.transact(learnerId, pkg, day, ({ status, dayFile }) => {
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
  async adminWords({ learnerId, deckId, actorId = null, pin = null } = {}) {
    const { deck, lexicon, pkg, day, store } = await this.#admin({ learnerId, deckId, actorId, pin });
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
    return {
      learnerId, package: pkg, decksSeen: [...status.decksSeen],
      droppableDecks: status.decksSeen.filter((id) => !enrolled.has(id)),
      words: ids.filter((id) => lexicon.entries.has(id)).map((id) => {
        const entry = lexicon.entries.get(id);
        const word = status.words[id] ?? emptyWordV3();
        return {
          wordId: id, term: entry.term, gloss: entry.gloss, state: word.state ?? 'new', stage: word.stage ?? null,
          dueDay: word.dueDay ?? null, missStreak: word.missStreak ?? 0, tricky: word.tricky === true, excluded: word.excluded === true,
          lastGraded: word.lastGraded ?? null, recentTyped: typed.get(id) ?? [],
        };
      }),
    };
  }

  /** Reset to new: a fresh record — nothing kept, `notYetCarry` included. */
  async adminReset({ learnerId, deckId, wordId, actorId = null, pin = null } = {}) {
    return this.#adminWord({ learnerId, deckId, wordId, actorId, pin }, 'reset', () => ({ word: emptyWordV3() }));
  }

  /** Mastered at `stage`, due after that stage's gap scaled by the day's tuned `review.gapScale`. */
  async adminMarkMastered({ learnerId, deckId, wordId, stage, actorId = null, pin = null } = {}) {
    return this.#adminWord({ learnerId, deckId, wordId, actorId, pin }, 'mastered',
      (word, { day, settings }) => ({ word: markMastered(word, { stage, day, gapScale: settings?.review?.gapScale ?? 1 }) }), { stage });
  }

  /**
   * Excluded words leave every round, recheck, drill, practice run and quiz;
   * today's pending ones too. An opened day is then re-settled, so taking away
   * the only pending thing plans what comes next (or credits the day) instead
   * of leaving the child on a "done" summary. A day never opened is untouched.
   */
  async adminExclude({ learnerId, deckId, wordId, excluded = true, actorId = null, pin = null } = {}) {
    if (typeof excluded !== 'boolean') throw new ValidationError('excluded must be true or false');
    const prepare = async ({ deck, lexicon, pkg, store }) => ({
      deck, lexicon, media: this.#media(deck, lexicon), pool: await this.#pool(store.readStatus(learnerId, pkg), deck),
    });
    return this.#adminWord({ learnerId, deckId, wordId, actorId, pin }, excluded ? 'exclude' : 'include', (word, ctx) => {
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
  async adminDropDeck({ learnerId, deckId, dropDeckId, actorId = null, pin = null } = {}) {
    const { pkg, day, store } = await this.#admin({ learnerId, deckId, actorId, pin });
    if (typeof dropDeckId !== 'string' || !dropDeckId) throw new ValidationError('dropDeckId is required');
    const enrolled = (await this.#enrollments(learnerId)).some((row) => (row.deckId ?? row.corpusId) === dropDeckId);
    if (dropDeckId === deckId || enrolled) {
      throw new ValidationError(`'${dropDeckId}' is a deck the learner is still enrolled in; end that assignment first`);
    }
    const out = store.transact(learnerId, pkg, day, ({ status, dayFile }) => {
      if (!status.decksSeen.includes(dropDeckId)) throw new EntityNotFoundError('word-ladder deck in the pool', dropDeckId);
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
  async adminRegrade({ learnerId, deckId, day, itemId, pass, actorId = null, pin = null } = {}) {
    const { pkg, store } = await this.#admin({ learnerId, deckId, actorId, pin });
    if (!this.#judgementCache) throw new ValidationError('the judgement cache is not configured');
    if (typeof day !== 'string' || !DAY_PATTERN.test(day)) throw new ValidationError('day must be YYYY-MM-DD');
    if (typeof itemId !== 'string' || !itemId) throw new ValidationError('itemId is required');
    if (typeof pass !== 'boolean') throw new ValidationError('pass must be true or false');
    const dayFile = store.readDay(learnerId, pkg, day);
    if (!dayFile.items?.[itemId]) throw new EntityNotFoundError('word-ladder answer', `${day} ${itemId}`);
    const answer = typedAnswers(dayFile).find((row) => row.itemId === itemId);
    if (!answer) throw new ValidationError('only a typed (3.3) answer can be re-graded');
    const score = pass ? this.#settings().typing.passScore : 1;
    this.#judgementCache.set(pkg, answer.wordId, normalizeAnswer(answer.typed), { score, judge: 'grown-up', reason: REGRADE_REASON });
    const regraded = { at: isoWithOffset(this.#now(), this.#timezone), actorId, pass };
    store.transact(learnerId, pkg, day, ({ status, dayFile: file }) => {
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
   * words learned in this deck is the bar. The course id is a program id,
   * `program:word-ladder:<package>`, so the poster resolves to
   * `<media>/school/programs/word-ladder/<package>/poster.jpg` — the artwork
   * belongs to the word package, not the program (one program, many languages).
   */
  async #card({ userId, store, day, deck, lexicon, pkg }) {
    const status = store.readStatus(userId, pkg);
    const dayFile = store.readDay(userId, pkg, day);
    const settings = this.#daySettings(dayFile, { store, userId, pkg });
    const plan = introPreview({ status, dayFile, day, pool: await this.#pool(status, deck), settings });
    return {
      course: { id: `program:word-ladder:${pkg}`, title: lexicon.program.title },
      unit: { id: deck.id, title: typeof deck.title === 'string' && deck.title.trim() ? deck.title.trim() : deck.id },
      plan,
      progress: deckProgress({ status, deckWords: deck.words }),
    };
  }

  /**
   * The start screen's card (`GET /word-ladder[/test]/intro`). READ-ONLY: spec
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
    };
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
      progress: [{ scope: 'unit', label: 'Words learned', completed: progress.learned, total: progress.total }],
    };
  }

  /** Read-only credit for the launcher: today (live) or a past study day (replay). Live only. */
  async dayStatus({ userId, deckId, day = null } = {}) {
    // Opening a test store snapshots a new shadow; credit never comes from test mode.
    if (this.#mode !== 'live') throw new ValidationError('dayStatus is answered by the live word ladder only');
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
        return { ...credit, ...this.#cardProjection(await this.#card({ userId, store, day: target, ...loaded }), target) };
      } catch (error) {
        // The card is decoration on the credit: a failure here must not cost the day its disc.
        this.#logger.warn?.('school.word-ladder.card-unavailable', { learnerId: userId, deckId, day: target, error: error.message });
        return credit;
      }
    } catch (error) {
      // A broken deck answers like a day never opened; it must not throw
      // through the launcher and take the rest of the agenda with it.
      this.#logger.warn?.('school.word-ladder.day-status-unloadable', { learnerId: userId, deckId, day: target, error: error.message });
      return { doneToday: false, progressLabel: 'Not opened', remaining: null };
    }
  }
}

export default WordLadderSittingService;
