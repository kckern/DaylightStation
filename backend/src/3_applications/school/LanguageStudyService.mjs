/**
 * Use cases for School's language-study program (design §3, §4).
 *
 * Owns pacing policy and the record contract. The domain owns the ladder, the
 * datastore is dumb storage, the router is a thin shell.
 *
 * Nothing here is stored that can be derived. The day queue is rebuilt from
 * the attempt log on every read — the 2016 app stored it in a table, a server
 * migration lost the writes, and a real learner's progress silently froze for
 * weeks. Derived state cannot desynchronise from its own evidence.
 */
import {
  validateCorpus, indexBySeq, buildDayQueue, summarizeQueue,
  shouldRollDay, chainFor, creditChain, rungById, resolveRole, accuracy,
  validateProgramEnrollment,
} from '#domains/school/language/index.mjs';
import { resolveGate, capabilitiesUnder, allowsRung, gateMessage } from '#domains/school/accessGate.mjs';
import { requirementFor } from '#domains/school/language/ladder.mjs';
import { offsetMinutesFor } from '#domains/school/studyDay.mjs';
import { GuestForbiddenError, GateClosedError } from '#domains/school/errors.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

const DEFAULT_DAILY_LIMIT = 5;
const MIN_DAILY_LIMIT = 1;
const MAX_DAILY_LIMIT = 100;
const DEFAULT_BOUNDARY_HOUR = 4;
/** Untouched for this long and the program stops claiming to be active. */
const IDLE_AFTER_DAYS = 14;
const TREND_BUCKETS = 12;

export class SentenceLadderService {
  #ds; #logger; #now; #timezone; #boundaryHour; #readGate; #readProgramEnrollment; #eventBus;
  #corpusCache = new Map();

  constructor({
    datastore,
    logger = console,
    now = () => Date.now(),
    timezone = null,
    boundaryHour = DEFAULT_BOUNDARY_HOUR,
    // Optional: without it the gate is simply open, so an unconfigured
    // household is never locked out by a feature it did not ask for.
    readGate = null,
    readProgramEnrollment = null,
    eventBus = null,
  }) {
    this.#ds = datastore;
    this.#logger = logger;
    this.#now = now;
    this.#timezone = timezone;
    this.#boundaryHour = boundaryHour;
    this.#readGate = readGate;
    this.#readProgramEnrollment = typeof readProgramEnrollment === 'function' ? readProgramEnrollment : null;
    this.#eventBus = eventBus;
  }

  /** The resolved gate, for diagnosis. */
  describeGate() {
    const gate = this.#gate();
    return { ...gate, message: gateMessage(gate) };
  }

  /** The physical gate, or an open one when no gate is wired. */
  #gate() {
    if (!this.#readGate) return resolveGate({ presence: null, now: this.#now(), required: [] });
    return this.#readGate();
  }

  #offsetMinutes(at) {
    return offsetMinutesFor(this.#timezone, at);
  }

  // -- corpus --------------------------------------------------------------

  #loadCorpus(corpusId) {
    if (this.#corpusCache.has(corpusId)) return this.#corpusCache.get(corpusId);
    const raw = this.#ds.readCorpus(corpusId);
    if (!raw) return null;
    const result = validateCorpus(raw);
    if (!result.ok) {
      // Loud, not silent: an invalid corpus makes the whole course unavailable,
      // and a learner staring at an empty program deserves a log line naming why.
      this.#logger.warn?.('school.language.corpus-invalid', {
        corpus: corpusId, reason: result.errors.join('; '),
      });
      return null;
    }
    const corpus = { ...result.corpus, index: indexBySeq(result.corpus) };
    this.#corpusCache.set(corpusId, corpus);
    return corpus;
  }

  listCourses() {
    return this.#ds.listCorpusIds()
      .map((id) => this.#loadCorpus(id))
      .filter(Boolean)
      .map((c) => ({ id: c.id, label: c.label, languages: c.languages, size: c.size }));
  }

  #requireCorpus(corpusId) {
    const corpus = this.#loadCorpus(corpusId);
    if (!corpus) throw new EntityNotFoundError('corpus', corpusId);
    return corpus;
  }

  /**
   * Every write requires an identified learner. A guest produces no records,
   * so the affordance is absent in the UI rather than failing here — this is
   * the server-side backstop, not the primary enforcement.
   */
  #requireUser(userId) {
    if (!userId) throw new GuestForbiddenError('language study requires a signed-in learner');
    return userId;
  }

  // -- progress ------------------------------------------------------------

  #readProgress(userId, corpusId) {
    const stored = this.#ds.readProgress(userId, corpusId) || {};
    return {
      corpus: corpusId,
      day: Number.isInteger(stored.day) && stored.day > 0 ? stored.day : 1,
      dailyLimit: this.#clampLimit(stored.daily_limit ?? stored.dailyLimit),
      lastActivity: stored.last_activity ?? stored.lastActivity ?? null,
    };
  }

  #writeProgress(userId, corpusId, progress) {
    return this.#ds.writeProgress(userId, corpusId, {
      corpus: corpusId,
      day: progress.day,
      daily_limit: progress.dailyLimit,
      last_activity: progress.lastActivity,
    });
  }

  #clampLimit(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_DAILY_LIMIT;
    return Math.min(MAX_DAILY_LIMIT, Math.max(MIN_DAILY_LIMIT, Math.round(n)));
  }

  #enrollment(userId, corpus) {
    if (!this.#readProgramEnrollment) return null;
    const raw = this.#readProgramEnrollment(userId, corpus.id);
    if (!raw) return null;
    const result = validateProgramEnrollment(raw, { corpus });
    if (result.errors.length) {
      this.#logger.warn?.('school.language.program-policy-invalid', {
        learnerId: userId, corpus: corpus.id, errors: result.errors,
      });
      throw new ValidationError(`invalid Sentence Ladder enrollment: ${result.errors.join('; ')}`);
    }
    return result.enrollment;
  }

  /** Write-boundary validator used by SetAssignments. */
  validateEnrollment(raw) {
    const programId = raw?.programId === 'language' ? 'sentence-ladder' : raw?.programId;
    if (programId !== 'sentence-ladder') {
      return { errors: [`unknown Sentence Ladder programId: ${programId ?? '(missing)'}`] };
    }
    let corpus;
    try { corpus = this.#requireCorpus(raw?.corpusId); } catch (error) { return { errors: [error.message] }; }
    return validateProgramEnrollment({ ...raw, programId }, { corpus });
  }

  #queuePolicy(userId, corpus, progress) {
    const enrollment = this.#enrollment(userId, corpus);
    const chain = enrollment ? creditChain(enrollment.rungs, corpus.languages) : null;
    const dailyLimit = enrollment
      ? Math.max(1, Math.round(enrollment.lessonSize / chain.length))
      : progress.dailyLimit;
    const admission = enrollment?.scope?.flatMap((item) => {
      const range = typeof item === 'string'
        ? corpus.bands?.find((band) => band.id === item)?.range
        : item.range;
      return range ? Array.from({ length: range[1] - range[0] + 1 }, (_, i) => range[0] + i) : [];
    }) ?? null;
    return { enrollment, chain, dailyLimit, admission };
  }

  #emitDayComplete(userId, corpus, day, policy) {
    if (!policy.enrollment || !this.#eventBus?.publish) return;
    const queue = buildDayQueue({
      log: this.#ds.readAllEvents(userId, corpus.id), day,
      dailyLimit: policy.dailyLimit, corpusSize: corpus.size,
      capabilities: { microphone: true, textInput: Object.values(corpus.languages) },
      languages: corpus.languages, playable: corpus.playable,
      admission: policy.admission, rungChain: policy.chain,
    });
    if (queue.length > 0 && summarizeQueue(queue).done === queue.length) {
      this.#eventBus.publish('school.language.day-complete', {
        learnerId: userId, corpusId: corpus.id, day, programId: policy.enrollment.programId,
      });
    }
  }

  // -- the day -------------------------------------------------------------

  /**
   * Today's work, fully derived. Capabilities come from the CLIENT because
   * they describe the device in the learner's hands, not the server — a mic
   * and an IME are properties of the panel, and the same account studying from
   * a laptop gets a different ladder.
   *
   * @param {object} args
   * @param {string} args.userId
   * @param {string} args.corpusId
   * @param {{microphone?: boolean, textInput?: string[]}} [args.capabilities]
   */
  getDay({ userId, corpusId, capabilities = {} }) {
    this.#requireUser(userId);
    const corpus = this.#requireCorpus(corpusId);
    const progress = this.#readProgress(userId, corpusId);
    const policy = this.#queuePolicy(userId, corpus, progress);
    const log = this.#ds.readAllEvents(userId, corpusId);

    // The client DECLARES what it can do; the gate KNOWS. A keyboard absent at
    // a known MAC is a fact, and it wins over a stored localStorage claim.
    const gate = this.#gate();
    const allowed = capabilitiesUnder(gate, capabilities);

    const queue = buildDayQueue({
      log,
      day: progress.day,
      dailyLimit: policy.dailyLimit,
      corpusSize: corpus.size,
      capabilities: allowed,
      languages: corpus.languages,
      playable: corpus.playable,
      admission: policy.admission,
      rungChain: policy.chain,
    });

    const now = this.#now();
    const roll = shouldRollDay({
      queue,
      lastActivity: progress.lastActivity ? Date.parse(progress.lastActivity) : null,
      now,
      boundaryHour: this.#boundaryHour,
      offsetMinutes: this.#offsetMinutes(now),
    });
    if (roll.roll) this.#emitDayComplete(userId, corpus, progress.day, policy);

    return {
      corpus: { id: corpus.id, label: corpus.label, languages: corpus.languages, size: corpus.size },
      day: progress.day,
      dailyLimit: policy.dailyLimit,
      chain: chainFor(allowed, corpus.languages).filter((rung) => !policy.chain || policy.chain.includes(rung)),
      creditChain: policy.chain ?? creditChain(null, corpus.languages),
      missingCreditRungs: policy.chain
        ? policy.chain.filter((rung) => !chainFor(allowed, corpus.languages).includes(rung))
        : [],
      enrollment: policy.enrollment ? {
        lessonSize: policy.enrollment.lessonSize,
        rungs: policy.enrollment.rungs,
        ...(policy.enrollment.dictationMode ? { dictationMode: policy.enrollment.dictationMode } : {}),
      } : null,
      gate: { level: gate.level, message: gateMessage(gate), missing: gate.missing },
      queue: queue.map((entry) => this.#decorate(entry, corpus, policy.enrollment?.dictationMode)),
      summary: summarizeQueue(queue),
      rollover: roll,
    };
  }

  /**
   * A teacher's guest preview is deliberately a different operation from
   * `getDay()`: it has no learner identity and reads no progress or event
   * store.  The queue is a fresh, in-memory day-one example of this published
   * corpus.  The browser may mark its local copy complete, but nothing it
   * does can become School evidence.
   */
  previewDay({ corpusId, capabilities = {} }) {
    const corpus = this.#requireCorpus(corpusId);
    const gate = this.#gate();
    const allowed = capabilitiesUnder(gate, capabilities);
    const queue = buildDayQueue({
      log: [], day: 1, dailyLimit: DEFAULT_DAILY_LIMIT,
      corpusSize: corpus.size, capabilities: allowed,
      languages: corpus.languages, playable: corpus.playable,
      admission: null, rungChain: null,
    });
    return {
      schema: 'school.sentence-ladder-guest-preview/v1',
      corpus: { id: corpus.id, label: corpus.label, languages: corpus.languages, size: corpus.size },
      day: 1,
      dailyLimit: DEFAULT_DAILY_LIMIT,
      chain: chainFor(allowed, corpus.languages),
      creditChain: creditChain(null, corpus.languages),
      missingCreditRungs: [],
      enrollment: null,
      gate: { level: gate.level, message: gateMessage(gate), missing: gate.missing },
      queue: queue.map((entry) => this.#decorate(entry, corpus)),
      summary: summarizeQueue(queue),
      rollover: { roll: false, reason: 'guest-preview' },
    };
  }

  /**
   * Attach everything a rung needs to render: the sentence text, and the
   * audio each prompt step should play — resolved from roles to concrete
   * language codes HERE, so no frontend component ever hardcodes EN or KR.
   */
  #decorate(entry, corpus, dictationMode = null) {
    const sentence = corpus.index.get(entry.seq) ?? null;
    const rung = rungById(entry.rung);
    const prompt = (rung?.prompt ?? []).map((role) => ({
      role,
      language: resolveRole(role, corpus.languages),
    }));
    const response = rung?.response
      ? { ...rung.response, language: resolveRole(rung.response.role, corpus.languages) }
      : null;
    return {
      seq: entry.seq,
      rung: entry.rung,
      done: entry.done,
      text: sentence?.text ?? null,
      prompt,
      response,
      // Copy mode preserves the target-language typing practice while making
      // the text visible. It is an enrollment policy, not a client choice.
      copyPrompt: entry.rung === 'dictation' && dictationMode === 'copy',
    };
  }

  // -- recording work ------------------------------------------------------

  /**
   * Append one attempt event. `given` is required for a text rung and ignored
   * otherwise; accuracy is computed for text responses but **gates nothing**
   * (design §3) — it exists for the learner's own diff on the Review surface.
   */
  logAttempt({ userId, corpusId, seq, rung, given = null, source = null, capabilities = {} }) {
    if (rung === 'recording') {
      throw new ValidationError('recording evidence requires an audio upload', { field: 'rung' });
    }
    return this.#recordAttempt({ userId, corpusId, seq, rung, given, source, capabilities });
  }

  #recordAttempt({
    userId, corpusId, seq, rung, given = null, source = null, capabilities = {},
    allowRecording = false, skipDueCheck = false,
  }) {
    this.#requireUser(userId);
    const corpus = this.#requireCorpus(corpusId);

    const rungDef = rungById(rung);
    if (!rungDef) throw new ValidationError(`unknown rung: ${rung}`, { field: 'rung', value: rung });
    if (rung === 'recording' && !allowRecording) {
      throw new ValidationError('recording evidence requires an audio upload', { field: 'rung' });
    }

    // Gated PER RUNG, so the recorder agrees with the queue. A missing keyboard
    // must not refuse a repetition drill the queue just offered — that was the
    // shape of the bug this replaces.
    const sentence = corpus.index.get(Number(seq));
    if (!sentence) throw new EntityNotFoundError('sentence', `${corpusId}#${seq}`);

    const progress = this.#readProgress(userId, corpusId);
    if (!skipDueCheck) this.#assertOutstanding({ userId, corpus, progress, seq, rung, capabilities });

    const at = new Date(this.#now()).toISOString();

    const event = {
      at,
      day: progress.day,
      seq: Number(seq),
      rung,
      attributedTo: userId,
    };
    if (source) event.source = source;

    if (rungDef.response?.modality === 'text') {
      if (typeof given !== 'string' || given.trim() === '') {
        throw new ValidationError(`${rung} requires a written response`, { field: 'given' });
      }
      const language = resolveRole(rungDef.response.role, corpus.languages);
      const expected = sentence.text[language] ?? '';
      event.given = given.trim();
      event.expected = expected;
      event.language = language;
      event.accuracy = accuracy(given, expected);
    }

    // The datastore returns null rather than throwing when it will not resolve
    // a path (unknown profile, malformed corpus id). Swallowing that would
    // report a saved attempt that was never written — the precise failure
    // School's "failures are never silent" rule exists to prevent, and the
    // one a learner cannot detect until their history turns up empty.
    const stored = this.#ds.appendEvent(userId, corpusId, event);
    if (!stored) {
      this.#logger.error?.('school.language.attempt-unrecorded', {
        userId, corpus: corpusId, seq, rung,
      });
      throw new EntityNotFoundError('learner', userId);
    }

    this.#writeProgress(userId, corpusId, { ...progress, lastActivity: at });
    const policy = this.#queuePolicy(userId, corpus, progress);
    this.#emitDayComplete(userId, corpus, progress.day, policy);
    this.#logger.debug?.('school.language.attempt', { learnerId: userId, corpus: corpusId, seq, rung });
    return event;
  }

  #assertOutstanding({ userId, corpus, progress, seq, rung, capabilities }) {
    const rungDef = rungById(rung);
    const gate = this.#gate();
    const allowed = capabilitiesUnder(gate, capabilities);
    if (!allowsRung(gate, requirementFor(rungDef, corpus.languages), allowed)) {
      throw new GateClosedError(gateMessage(gate) || 'That is unavailable right now', gate);
    }
    const policy = this.#queuePolicy(userId, corpus, progress);
    const queue = buildDayQueue({
      log: this.#ds.readAllEvents(userId, corpus.id),
      day: progress.day,
      dailyLimit: policy.dailyLimit,
      corpusSize: corpus.size,
      capabilities: allowed,
      languages: corpus.languages,
      playable: corpus.playable,
      admission: policy.admission,
      rungChain: policy.chain,
    });
    const due = queue.find((entry) => !entry.done && entry.seq === Number(seq) && entry.rung === rung) ?? null;
    if (!due) {
      throw new ValidationError('attempt does not match an outstanding ladder step', {
        field: 'attempt', expected: queue.filter((entry) => !entry.done).map(({ seq: dueSeq, rung: dueRung }) => ({ seq: dueSeq, rung: dueRung })),
      });
    }
  }

  /**
   * Store a voice recording, then log it. Order matters: the file is written
   * first so a crash between the two leaves an orphan file rather than an
   * event pointing at nothing. Evidence is the log — a file with no event
   * counts as not done, which is recoverable; an event with no file is not.
   */
  saveRecording({ userId, corpusId, seq, buffer, ext = 'webm', capabilities = {} }) {
    this.#requireUser(userId);
    const corpus = this.#requireCorpus(corpusId);
    if (!buffer || buffer.length === 0) {
      throw new ValidationError('recording is empty', { field: 'audio' });
    }
    const progress = this.#readProgress(userId, corpusId);
    this.#assertOutstanding({ userId, corpus, progress, seq, rung: 'recording', capabilities });
    const language = corpus.languages.target;
    const written = this.#ds.writeRecording(corpusId, userId, seq, language, buffer, ext);
    if (!written) throw new ValidationError('could not store recording', { field: 'audio' });
    return this.#recordAttempt({
      userId, corpusId, seq, rung: 'recording', capabilities,
      allowRecording: true, skipDueCheck: true,
    });
  }

  // -- pacing --------------------------------------------------------------

  setPacing({ userId, corpusId, dailyLimit }) {
    this.#requireUser(userId);
    const corpus = this.#requireCorpus(corpusId);
    if (this.#enrollment(userId, corpus)) {
      throw new ValidationError('daily pacing is governed by the learner program enrollment');
    }
    const progress = this.#readProgress(userId, corpusId);
    const next = { ...progress, dailyLimit: this.#clampLimit(dailyLimit) };
    this.#writeProgress(userId, corpusId, next);
    this.#logger.info?.('school.language.pacing', {
      userId, corpus: corpusId, dailyLimit: next.dailyLimit,
    });
    return { dailyLimit: next.dailyLimit };
  }

  /**
   * Advance to the next study day. The rule is re-checked server-side: a
   * client that asks early is refused, so finishing at noon cannot hand out
   * tomorrow's sentences. The spacing IS the method.
   */
  rollDay({ userId, corpusId, capabilities = {} }) {
    this.#requireUser(userId);
    const corpus = this.#requireCorpus(corpusId);
    const progress = this.#readProgress(userId, corpusId);
    const policy = this.#queuePolicy(userId, corpus, progress);
    const log = this.#ds.readAllEvents(userId, corpusId);

    const queue = buildDayQueue({
      log,
      day: progress.day,
      dailyLimit: policy.dailyLimit,
      corpusSize: corpus.size,
      capabilities,
      languages: corpus.languages,
      playable: corpus.playable,
      admission: policy.admission,
      rungChain: policy.chain,
    });

    const now = this.#now();
    const decision = shouldRollDay({
      queue,
      lastActivity: progress.lastActivity ? Date.parse(progress.lastActivity) : null,
      now,
      boundaryHour: this.#boundaryHour,
      offsetMinutes: this.#offsetMinutes(now),
    });
    if (decision.roll) this.#emitDayComplete(userId, corpus, progress.day, policy);

    if (!decision.roll) return { rolled: false, day: progress.day, reason: decision.reason };

    const next = { ...progress, day: progress.day + 1 };
    this.#writeProgress(userId, corpusId, next);
    this.#logger.info?.('school.language.day-rolled', { learnerId: userId, corpus: corpusId, day: next.day });
    return { rolled: true, day: next.day, reason: decision.reason };
  }

  // -- history -------------------------------------------------------------

  /**
   * The log folded by study day for the Review surface, newest first.
   * A rollup, deliberately computed and never stored (School convention 2).
   */
  getHistory({ userId, corpusId }) {
    this.#requireUser(userId);
    const corpus = this.#requireCorpus(corpusId);
    const events = this.#ds.readAllEvents(userId, corpusId);
    const recordings = this.#ds.listRecordingKeys(corpusId, userId);

    const byDay = new Map();
    for (const event of events) {
      const day = Number(event.day);
      if (!byDay.has(day)) byDay.set(day, []);
      const sentence = corpus.index.get(Number(event.seq));
      byDay.get(day).push({
        ...event,
        text: sentence?.text ?? null,
        // Only offer playback for a recording that is actually on disk; the
        // event stands as evidence either way.
        hasAudio: event.rung === 'recording'
          && recordings.has(`${Number(event.seq)}-${corpus.languages.target}`),
      });
    }

    return {
      corpus: { id: corpus.id, label: corpus.label, languages: corpus.languages },
      days: [...byDay.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([day, items]) => ({ day, items })),
    };
  }

  // -- program report (IProgramReporter) -----------------------------------

  get id() { return 'sentence-ladder'; }

  get label() { return 'Sentence Ladder'; }

  /**
   * One report per course this learner has touched (design: program interface).
   *
   * Reported for the FULL ladder rather than a device-filtered one: the board
   * answers "what is next for this learner", which is not a property of
   * whichever panel happens to be asking. Device filtering belongs to the
   * drill, not the summary.
   *
   * Never throws — the aggregate view calls every program, and one failure
   * must not blank the board.
   */
  summarize({ userId }) {
    if (!userId) return [];
    return this.#ds.listCorpusIds()
      .map((corpusId) => {
        try {
          return this.#summarizeCourse(userId, corpusId);
        } catch (err) {
          this.#logger.error?.('school.language.summarize-failed', {
            userId, corpus: corpusId, error: err.message,
          });
          return null;
        }
      })
      .filter(Boolean);
  }

  /**
   * The unfiltered ladder — every rung, as if every capability were present.
   * Reporting and status answer "what is next for this learner" (design
   * §IProgramReporter), which is not a property of whichever panel happens to
   * be asking; device filtering belongs to `getDay`, not to a summary.
   *
   * Shared by `#summarizeCourse` and `todayStatus` so the day-queue math (and
   * the progress it is built from) is derived exactly once per call site,
   * never duplicated.
   */
  #fullDayQueue(userId, corpusId, corpus, log, progress) {
    const policy = this.#queuePolicy(userId, corpus, progress);
    return buildDayQueue({
      log,
      day: progress.day,
      dailyLimit: policy.dailyLimit,
      corpusSize: corpus.size,
      capabilities: { microphone: true, textInput: Object.values(corpus.languages) },
      languages: corpus.languages,
      playable: corpus.playable,
      admission: policy.admission,
      rungChain: policy.chain,
    });
  }

  /**
   * Today's status for the program-launcher surface (design §IProgramLauncher):
   * has this learner cleared everything the day's queue asked of them, and
   * what day are they on. `score` is always `null` — the ladder does not
   * grade (design §3); accuracy is informational only.
   *
   * Scans every course this learner has touched (in `listCorpusIds()` order)
   * and reports on the first one with any evidence at all — a stored progress
   * record or a logged attempt. A learner with neither, for any course, has
   * never touched language study, and gets the null triple rather than a
   * fabricated "Day 1" for a course they have not started.
   *
   * Never throws — the `IProgramLauncher.status` contract says one failing
   * program must not blank the agenda for the rest (mirrors `summarize`'s
   * per-course try/catch, one level up since this returns a single object).
   *
   * @param {{userId: string, corpusId?: string|null}} args
   * @returns {{doneToday: boolean, progressLabel: string|null, score: number|null}}
   */
  // READ-ONLY by contract: the agenda preview GET depends on status() never writing (preview spec §3).
  todayStatus({ userId, corpusId = null }) {
    if (!userId) return { doneToday: false, progressLabel: null, score: null };
    try {
      const corpusIds = corpusId ? [corpusId] : this.#ds.listCorpusIds();
      for (const candidateCorpusId of corpusIds) {
        const corpus = this.#loadCorpus(candidateCorpusId);
        if (!corpus) continue;

        const rawProgress = this.#ds.readProgress(userId, candidateCorpusId);
        const log = this.#ds.readAllEvents(userId, candidateCorpusId);
        if (!rawProgress && log.length === 0) continue; // never touched this course

        const progress = this.#readProgress(userId, candidateCorpusId);
        let day = progress.day;
        let queue = this.#fullDayQueue(userId, candidateCorpusId, corpus, log, progress);

        // The stored day only advances when the learner next opens the app,
        // so a day finished last week still reads as day N with everything
        // cleared. Apply the same rollover the live session applies on open —
        // otherwise the agenda prints "done today" for work finished days ago
        // and hides the subject (found live: a day-1 queue cleared 2026-07-22
        // still reported done on 07-30).
        const nowMs = this.#now();
        const roll = shouldRollDay({
          queue,
          lastActivity: progress.lastActivity ? Date.parse(progress.lastActivity) : null,
          now: nowMs,
          boundaryHour: this.#boundaryHour,
          offsetMinutes: this.#offsetMinutes(nowMs),
        });
        if (roll.roll) {
          day += 1;
          queue = this.#fullDayQueue(userId, candidateCorpusId, corpus, log, { ...progress, day });
        }

        const summary = summarizeQueue(queue);
        const outstanding = summary.total - summary.done;

        // An empty queue counts as complete: a fresh learner can never present
        // one (new sentences fill it), so empty means every available sentence
        // has been retired — the same rule `shouldRollDay` uses to advance
        // rather than stall on a vacuous condition (rollover.mjs:45-46: "An
        // empty queue counts as complete...").
        const doneToday = outstanding === 0;
        const progressLabel = summary.total === 0 ? 'Course complete' : `Day ${day}`;
        return { doneToday, progressLabel, score: null };
      }
      return { doneToday: false, progressLabel: null, score: null };
    } catch (err) {
      this.#logger.error?.('school.language.today-status-failed', { learnerId: userId, error: err.message });
      return { doneToday: false, progressLabel: null, score: null };
    }
  }

  #summarizeCourse(userId, corpusId) {
    const corpus = this.#loadCorpus(corpusId);
    if (!corpus) return null;

    const log = this.#ds.readAllEvents(userId, corpusId);
    if (log.length === 0) {
      // Never touched. This used to return null, which meant a brand-new
      // learner's home had nothing on it at all — the one child who most needs
      // a way in got the emptiest screen. A course they have not started is an
      // invitation, and `not-started` is exactly the state for it.
      const progress = this.#readProgress(userId, corpusId);
      return {
        program: this.id,
        instanceId: corpus.id,
        label: corpus.label,
        userId,
        state: 'not-started',
        lastActivity: null,
        headline: `${corpus.languages.source} to ${corpus.languages.target}`,
        next: {
          label: 'Start here',
          detail: `${progress.dailyLimit} sentences a day`,
          estimate: { count: progress.dailyLimit, unit: 'sentences' },
          blocked: false,
        },
        metrics: [],
      };
    }

    const progress = this.#readProgress(userId, corpusId);
    const queue = this.#fullDayQueue(userId, corpusId, corpus, log, progress);

    const touched = new Set(log.map((e) => Number(e.seq)).filter(Number.isFinite));
    const retired = new Set(
      [...touched].filter((seq) => RUNG_IDS.every(
        (rung) => log.some((e) => Number(e.seq) === seq && e.rung === rung),
      )),
    );

    const scored = log.filter((e) => typeof e.accuracy === 'number');
    const recordings = log.filter((e) => e.rung === 'recording').length;
    const outstanding = queue.filter((e) => !e.done);

    const lastActivity = progress.lastActivity
      ?? log.reduce((max, e) => (String(e.at) > max ? String(e.at) : max), '');
    const idleMs = this.#now() - Date.parse(lastActivity || 0);
    // `satisfied` rather than `idle` when today's set is cleared: a learner who
    // did everything asked must not be told they are paused.
    const state = retired.size >= corpus.playable.size ? 'complete'
      : outstanding.length === 0 ? 'satisfied'
        : idleMs > IDLE_AFTER_DAYS * 86400000 ? 'idle'
          : 'active';

    const done = queue.length - outstanding.length;
    const metrics = [
      // TODAY's bounded set — the number a learner can actually move, and the
      // one that belongs on their own surface.
      {
        id: 'today', kind: 'progress', label: 'Today', scope: 'today',
        value: done, total: Math.max(queue.length, 1), unit: 'sentences',
        audience: 'learner',
      },
      // The lifetime figure is real, and useless to a child: a bar at 20% that
      // will not visibly move for a year says "you are nowhere".
      {
        id: 'sentences', kind: 'progress', label: 'Sentences started', scope: 'total',
        value: touched.size, total: corpus.playable.size, unit: 'sentences',
      },
      // An odometer, not a fuse — it only advances, so it is safe to show.
      { id: 'day', kind: 'count', label: 'Study day', value: progress.day, unit: 'days', audience: 'learner' },
      { id: 'recordings', kind: 'count', label: 'Recordings', value: recordings, unit: 'recordings' },
    ];
    if (scored.length) {
      metrics.push({
        id: 'accuracy', kind: 'score', label: 'Typing accuracy',
        value: scored.reduce((a, e) => a + e.accuracy, 0) / scored.length,
      });
      const trend = this.#accuracyTrend(scored);
      if (trend.length > 1) {
        metrics.push({ id: 'accuracy-trend', kind: 'trend', label: 'Accuracy over time', points: trend });
      }
    }

    return {
      program: this.id,
      instanceId: corpus.id,
      label: corpus.label,
      userId,
      state,
      lastActivity: lastActivity || null,
      headline: `Day ${progress.day} · ${progress.dailyLimit} new a day`,
      next: outstanding.length
        ? {
          label: `${outstanding.length} sentences today`,
          detail: this.#describeOutstanding(outstanding),
          estimate: { count: outstanding.length, unit: 'sentences' },
          blocked: false,
        }
        : { label: 'Done for today', detail: 'Come back tomorrow for the next set', blocked: false },
      metrics,
    };
  }

  /** Mean accuracy per study day, thinned to a readable number of points. */
  #accuracyTrend(scored) {
    const byDay = new Map();
    for (const event of scored) {
      const day = Number(event.day);
      if (!Number.isFinite(day)) continue;
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(event.accuracy);
    }
    const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
    const step = Math.max(1, Math.ceil(days.length / TREND_BUCKETS));
    return days
      .filter((_, i) => i % step === 0)
      .map(([day, values]) => ({
        at: `Day ${day}`,
        value: values.reduce((a, v) => a + v, 0) / values.length,
      }));
  }

  #describeOutstanding(outstanding) {
    const counts = outstanding.reduce((acc, e) => ({ ...acc, [e.rung]: (acc[e.rung] ?? 0) + 1 }), {});
    return RUNG_IDS.filter((r) => counts[r])
      .map((r) => `${counts[r]} ${r}`)
      .join(', ');
  }

  resolveAudioPath(corpusId, seq, language) {
    return this.#ds.resolveAudioPath(corpusId, seq, language);
  }

  resolveRecordingPath(corpusId, userId, seq, ext) {
    const corpus = this.#requireCorpus(corpusId);
    return this.#ds.resolveRecordingPath(corpusId, userId, seq, corpus.languages.target, ext);
  }
}

// Compatibility export for callers that have not crossed the canonical module
// boundary yet. Persistence paths remain stable; runtime vocabulary does not.
export const LanguageStudyService = SentenceLadderService;
export default SentenceLadderService;
