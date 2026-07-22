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
  shouldRollDay, chainFor, rungById, resolveRole, accuracy,
} from '#domains/school/language/index.mjs';
import { RUNG_IDS } from '#domains/school/language/ladder.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

const DEFAULT_DAILY_LIMIT = 5;
const MIN_DAILY_LIMIT = 1;
const MAX_DAILY_LIMIT = 100;
const DEFAULT_BOUNDARY_HOUR = 4;
/** Untouched for this long and the program stops claiming to be active. */
const IDLE_AFTER_DAYS = 14;
const TREND_BUCKETS = 12;

/**
 * Local UTC offset for an instant, in minutes.
 *
 * Computed per call rather than once at boot because the offset is not a
 * constant: a household on a DST-observing timezone would drift by an hour
 * twice a year, and a 4am study-day boundary computed with a stale offset
 * rolls the day at 3am or 5am — silently handing out tomorrow's sentences
 * early, or refusing them for an hour.
 */
function offsetMinutesFor(timezone, epochMs) {
  if (!timezone) return 0;
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]),
    );
    const asUTC = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
    );
    return Math.round((asUTC - epochMs) / 60000);
  } catch {
    return 0;
  }
}

export class LanguageStudyService {
  #ds; #logger; #now; #timezone; #boundaryHour;
  #corpusCache = new Map();

  constructor({
    datastore,
    logger = console,
    now = () => Date.now(),
    timezone = null,
    boundaryHour = DEFAULT_BOUNDARY_HOUR,
  }) {
    this.#ds = datastore;
    this.#logger = logger;
    this.#now = now;
    this.#timezone = timezone;
    this.#boundaryHour = boundaryHour;
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
    const log = this.#ds.readAllEvents(userId, corpusId);

    const queue = buildDayQueue({
      log,
      day: progress.day,
      dailyLimit: progress.dailyLimit,
      corpusSize: corpus.size,
      capabilities,
      languages: corpus.languages,
      playable: corpus.playable,
    });

    const now = this.#now();
    const roll = shouldRollDay({
      queue,
      lastActivity: progress.lastActivity ? Date.parse(progress.lastActivity) : null,
      now,
      boundaryHour: this.#boundaryHour,
      offsetMinutes: this.#offsetMinutes(now),
    });

    return {
      corpus: { id: corpus.id, label: corpus.label, languages: corpus.languages, size: corpus.size },
      day: progress.day,
      dailyLimit: progress.dailyLimit,
      chain: chainFor(capabilities, corpus.languages),
      queue: queue.map((entry) => this.#decorate(entry, corpus)),
      summary: summarizeQueue(queue),
      rollover: roll,
    };
  }

  /**
   * Attach everything a rung needs to render: the sentence text, and the
   * audio each prompt step should play — resolved from roles to concrete
   * language codes HERE, so no frontend component ever hardcodes EN or KR.
   */
  #decorate(entry, corpus) {
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
    };
  }

  // -- recording work ------------------------------------------------------

  /**
   * Append one attempt event. `given` is required for a text rung and ignored
   * otherwise; accuracy is computed for text responses but **gates nothing**
   * (design §3) — it exists for the learner's own diff on the Review surface.
   */
  logAttempt({ userId, corpusId, seq, rung, given = null, source = null }) {
    this.#requireUser(userId);
    const corpus = this.#requireCorpus(corpusId);

    const rungDef = rungById(rung);
    if (!rungDef) throw new ValidationError(`unknown rung: ${rung}`, { field: 'rung', value: rung });

    const sentence = corpus.index.get(Number(seq));
    if (!sentence) throw new EntityNotFoundError('sentence', `${corpusId}#${seq}`);

    const progress = this.#readProgress(userId, corpusId);
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
    this.#logger.debug?.('school.language.attempt', { userId, corpus: corpusId, seq, rung });
    return event;
  }

  /**
   * Store a voice recording, then log it. Order matters: the file is written
   * first so a crash between the two leaves an orphan file rather than an
   * event pointing at nothing. Evidence is the log — a file with no event
   * counts as not done, which is recoverable; an event with no file is not.
   */
  saveRecording({ userId, corpusId, seq, buffer, ext = 'webm' }) {
    this.#requireUser(userId);
    const corpus = this.#requireCorpus(corpusId);
    if (!buffer || buffer.length === 0) {
      throw new ValidationError('recording is empty', { field: 'audio' });
    }
    const language = corpus.languages.target;
    const written = this.#ds.writeRecording(corpusId, userId, seq, language, buffer, ext);
    if (!written) throw new ValidationError('could not store recording', { field: 'audio' });
    return this.logAttempt({ userId, corpusId, seq, rung: 'recording' });
  }

  // -- pacing --------------------------------------------------------------

  setPacing({ userId, corpusId, dailyLimit }) {
    this.#requireUser(userId);
    this.#requireCorpus(corpusId);
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
    const log = this.#ds.readAllEvents(userId, corpusId);

    const queue = buildDayQueue({
      log,
      day: progress.day,
      dailyLimit: progress.dailyLimit,
      corpusSize: corpus.size,
      capabilities,
      languages: corpus.languages,
      playable: corpus.playable,
    });

    const now = this.#now();
    const decision = shouldRollDay({
      queue,
      lastActivity: progress.lastActivity ? Date.parse(progress.lastActivity) : null,
      now,
      boundaryHour: this.#boundaryHour,
      offsetMinutes: this.#offsetMinutes(now),
    });

    if (!decision.roll) return { rolled: false, day: progress.day, reason: decision.reason };

    const next = { ...progress, day: progress.day + 1 };
    this.#writeProgress(userId, corpusId, next);
    this.#logger.info?.('school.language.day-rolled', { userId, corpus: corpusId, day: next.day });
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

  get id() { return 'language'; }

  get label() { return 'Language study'; }

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

  #summarizeCourse(userId, corpusId) {
    const corpus = this.#loadCorpus(corpusId);
    if (!corpus) return null;

    const log = this.#ds.readAllEvents(userId, corpusId);
    if (log.length === 0) return null;   // never touched — not a row on the board

    const progress = this.#readProgress(userId, corpusId);
    const queue = buildDayQueue({
      log,
      day: progress.day,
      dailyLimit: progress.dailyLimit,
      corpusSize: corpus.size,
      capabilities: { microphone: true, textInput: Object.values(corpus.languages) },
      languages: corpus.languages,
      playable: corpus.playable,
    });

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

export default LanguageStudyService;
