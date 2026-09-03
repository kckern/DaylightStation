/**
 * Use cases for the school app (spec §5). Owns session policy and the
 * mode-split answer contract; the datastore is dumb storage; the router is a
 * thin shell. Sessions are IN MEMORY by design — a restart costs the remainder
 * of one sitting, never a recorded attempt (those are already on disk).
 */
import {
  validateQuestionBank, summarizeQuestionBank, gradeAnswer, givenShapeError,
  createAttempt, isRegradeCorrection, effectiveAttempts, GuestForbiddenError, SessionGoneError, normalizeLearningContext, bankContentRev,
} from '#domains/school/index.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { PersistenceError } from '#apps/common/errors/SemanticErrors.mjs';
import { shortId } from '#system/utils/id.mjs';

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
// A persisted sitting outlives the in-memory session (2h) but not the day it
// belongs to: after 24h a half-finished quiz is a stale intention, not a
// resume point — it is ignored and the next run replaces it.
const SITTING_TTL_MS = 24 * 60 * 60 * 1000;
const MODES = new Set(['quiz', 'flashcard', 'drill', 'learning_probe']);
// The household has 4600+ bank files; even summarising them is 4600 synchronous
// file reads (~10s) — and the gating bank index rebuilds via listBanks() on
// EVERY unit lookup, so a 44-chapter material scanned them 44 times. Cache the
// small summaries (id/title/subject/unit/count — NOT the question items) briefly
// so a render, and every gating lookup within it, reuses one scan.
const BANK_SUMMARY_TTL_MS = 300_000; // 10 min? banks change rarely; 5 min keeps it warm through use gaps

export class SchoolService {
  #ds; #userService; #learnerDirectory; #logger; #now; #bankSources; #teacherGate; #teacherNotesRef; #sittings;
  #sessions = new Map(); // sessionId -> {id, userId|null, bankId, mode, bank, startedAt, lastActiveAt}
  #bankSummaries = null; // { at: number, list: Array<summary> }
  #warming = null; // in-flight warmBanks() promise (dedupe)

  constructor({ datastore, userService, learnerDirectory = null, logger = console, now = () => Date.now(), bankSources = [], teacherGate = null, teacherNotesRef = null, sittings = null }) {
    this.#ds = datastore;
    this.#sittings = sittings;
    this.#teacherGate = teacherGate;
    this.#teacherNotesRef = teacherNotesRef;
    this.#userService = userService;
    this.#learnerDirectory = learnerDirectory;
    this.#logger = logger;
    this.#now = now;
    this.#bankSources = bankSources;
  }

  /**
   * The household roster, in household order.
   *
   * Previously this sorted by `display_name` while the picker rendered
   * `group_label`, so the order was computed from strings nobody could see —
   * "parent-two" and "KC Kern" sorting into positions labelled "Mom" and "Dad".
   * It looked random because it was sorted on invisible keys, and it disagreed
   * with every other picker in the house.
   */
  getRoster() {
    return this.#learnerDirectory?.listLearners?.() ?? this.#userService.getHouseholdRoster();
  }

  /**
   * Record a child's request for a quiz on a unit that has none (quizzes are
   * authored on demand — the request list is the authoring backlog). Guests
   * cannot request: there is nobody to attribute the interest to. One request
   * per (user, unit); a repeat is acknowledged, not duplicated.
   */
  requestQuiz({ userId = null, unitId, materialId, unitTitle = null, materialTitle = null }) {
    if (!userId) throw new GuestForbiddenError('Sign in to request a quiz');
    if (!this.getRoster().some((u) => u.id === userId)) {
      throw new ValidationError(`unknown user: ${userId}`);
    }
    if (!unitId || !materialId) throw new ValidationError('unitId and materialId are required');

    const list = this.#ds.readQuizRequests();
    if (list.some((r) => r.unitId === unitId && r.userId === userId)) {
      return { requested: true, duplicate: true };
    }
    const entry = {
      at: new Date(this.#now()).toISOString(),
      userId, unitId, materialId, unitTitle, materialTitle,
    };
    this.#ds.saveQuizRequests([...list, entry]);
    this.#logger.info?.('school.quiz.requested', entry);
    return { requested: true, duplicate: false };
  }

  /** The request backlog, optionally scoped to one material. */
  listQuizRequests({ materialId = null } = {}) {
    const list = this.#ds.readQuizRequests();
    // A request is FULFILLED once a bank bound to its unit exists (the same
    // `unit:` backlink the quiz gate resolves) — the backlog can shrink by
    // authoring, not only by dismissal. Callers who need the flag warm
    // (route: await warmBanks() first) get real answers; a cold cache
    // degrades to fulfilled:false, never a throw.
    const boundUnits = new Set(this.listBanks().map((b) => b.unit).filter(Boolean));
    const scoped = materialId ? list.filter((r) => r.materialId === materialId) : list;
    return scoped.map((r) => ({ ...r, fulfilled: boundUnits.has(r.unitId) }));
  }

  /**
   * A KID asks for another go at something they failed (student-advocacy
   * A2): kid-safe like requestQuiz — no gate, no side effects beyond the
   * backlog row the teacher's Today tab lists. Dedupe per user+target.
   */
  requestRetake({ userId = null, bankId = null, unitId = null, title = null } = {}) {
    if (!userId) throw new GuestForbiddenError('Sign in to ask for a retake');
    if (!this.getRoster().some((u) => u.id === userId)) {
      throw new ValidationError(`unknown user: ${userId}`);
    }
    if (!bankId && !unitId) throw new ValidationError('bankId or unitId is required');
    const list = this.#ds.readQuizRequests();
    if (list.some((r) => r.kind === 'retake' && r.userId === userId
        && (r.bankId ?? null) === bankId && (r.unitId ?? null) === unitId)) {
      return { requested: true, duplicate: true };
    }
    const entry = {
      kind: 'retake', at: new Date(this.#now()).toISOString(), userId,
      ...(bankId ? { bankId } : {}), ...(unitId ? { unitId } : {}),
      ...(title ? { unitTitle: title } : {}),
    };
    this.#ds.saveQuizRequests([...list, entry]);
    this.#logger.info?.('school.retake.requested', entry);
    return { requested: true, duplicate: false };
  }

  /**
   * A KID flags something that seems wrong — a mis-keyed answer, a score
   * that doesn't match what they did, a broken screen (student-advocacy
   * wave 7: the child's voice channel). Kid-safe like requestQuiz; the row
   * lands in the same backlog the teacher's Today tab lists, kind:'flag'.
   * The note is the kid's own words, capped, never required.
   */
  flagConcern({ userId = null, bankId = null, sessionId = null, title = null, note = null } = {}) {
    if (!userId) throw new GuestForbiddenError('Sign in to flag a problem');
    if (!this.getRoster().some((u) => u.id === userId)) {
      throw new ValidationError(`unknown user: ${userId}`);
    }
    const list = this.#ds.readQuizRequests();
    if (list.some((r) => r.kind === 'flag' && r.userId === userId
        && (r.bankId ?? null) === bankId && (r.sessionId ?? null) === sessionId)) {
      return { flagged: true, duplicate: true };
    }
    const entry = {
      kind: 'flag', at: new Date(this.#now()).toISOString(), userId,
      ...(bankId ? { bankId } : {}), ...(sessionId ? { sessionId } : {}),
      ...(title ? { unitTitle: title } : {}),
      ...(typeof note === 'string' && note.trim() ? { note: note.trim().slice(0, 240) } : {}),
    };
    this.#ds.saveQuizRequests([...list, entry]);
    this.#logger.info?.('school.flag.raised', entry);
    return { flagged: true, duplicate: false };
  }

  /**
   * A teacher clears a backlog entry (teacher-console spec §4.6,
   * `teacher.quizrequests.clear`): gate-checked, then the entry is removed —
   * and (student-advocacy A5: no silent verbs about children) the dismissal
   * REQUIRES a reason, delivered to the child through the notes channel, so
   * the ✓ never just silently reverts on them.
   */
  async dismissQuizRequest({ unitId = null, bankId = null, kind = null, sessionId = null, userId, dismissedBy = null, pin = null, reason } = {}) {
    if (!this.#teacherGate) throw new GuestForbiddenError('Dismissing requests is not configured on this install');
    this.#teacherGate.assert({ userId: dismissedBy, pin, action: 'quizrequests.dismiss' });
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new ValidationError('a reason is required — the child is told why');
    }
    const list = this.#ds.readQuizRequests();
    // EXACTLY ONE row (M7 fix): a retake ask and a flag on the same bank are
    // different sentences owed to the same child — dismissing one must never
    // sweep the others. kind is part of identity ('' matches the legacy
    // quiz-request rows, which carry no kind field), and only the FIRST
    // matching row goes.
    const matches = (r) => r.userId === userId
      && (r.kind ?? null) === kind
      && (unitId ? r.unitId === unitId : true)
      && (bankId ? r.bankId === bankId : true)
      && (sessionId ? r.sessionId === sessionId : true);
    const idx = list.findIndex(matches);
    if (idx === -1) return { dismissed: false };
    const dismissedRow = list[idx];
    const keep = list.filter((_, i) => i !== idx);
    // The sentence to the child comes FIRST (M7 fix): if it cannot be
    // written, the row stays and the teacher sees the failure — a dismissal
    // whose reason never arrives is exactly the silent verb this contract
    // forbids. (A note without a dismissal, if the save below fails, is the
    // harmless direction.)
    const notes = this.#teacherNotesRef?.();
    if (notes) {
      const what = dismissedRow?.unitTitle ?? dismissedRow?.unitId ?? dismissedRow?.bankId ?? 'your request';
      await notes.append({
        id: `note_${Math.random().toString(36).slice(2, 10)}`,
        at: new Date(this.#now()).toISOString(),
        from: dismissedBy,
        learnerId: userId,
        note: `About ${what}: ${reason.trim()}`.slice(0, 240),
      });
    }
    this.#ds.saveQuizRequests(keep);
    this.#logger.info?.('school.quiz.request-dismissed', { unitId, bankId, kind, sessionId, learnerId: userId, dismissedBy });
    return { dismissed: true };
  }

  #loadBank(bankId) {
    for (const source of this.#bankSources) {
      const synth = source.resolve(bankId);
      if (synth) {
        const r = validateQuestionBank(synth);
        if (!r.ok) {
          this.#logger.warn?.('school.bank.invalid', { bankId, synthesized: true, reason: r.errors.join('; ') });
          return null;
        }
        return r.bank;
      }
    }
    const raw = this.#ds.readBankRaw(bankId);
    if (!raw) return null;
    const r = validateQuestionBank(raw);
    if (!r.ok) {
      this.#logger.warn?.('school.bank.invalid', { file: `${bankId}.yml`, reason: r.errors.join('; ') });
      return null;
    }
    return r.bank;
  }

  /** Generic catalog metadata from injected/generated bank sources. */
  listBankSourceSummaries({ collection = null } = {}) {
    const summaries = this.#bankSources.flatMap((source) => source.listSummaries());
    return collection
      ? summaries.filter((summary) => summary.collections?.includes(collection))
      : summaries;
  }

  // Listing/shelving reads each bank's HEADER only (summarizeQuestionBank) — no
  // per-item validation. That per-item loop across every bank was ~5s of
  // synchronous work blocking the event loop on each home load; the list never
  // renders items, so it never needed them validated. Full validation still
  // happens when a bank is actually opened (getBank -> #loadBank).
  #bankSummariesFresh() {
    return this.#bankSummaries && (this.#now() - this.#bankSummaries.at) < BANK_SUMMARY_TTL_MS;
  }

  // Populate the summary cache via the datastore's bulk read. Legacy files
  // read async; v2 courses are one sync walk each with a macrotask yield
  // between works (see YamlSchoolDatastore.readAllBankRaws). Deduped:
  // concurrent callers share one scan.
  async warmBanks({ force = false } = {}) {
    if (!force && this.#bankSummariesFresh()) return this.#bankSummaries.list;
    if (this.#warming) return this.#warming;
    this.#warming = (async () => {
      const raws = await this.#ds.readAllBankRaws();
      // A bank that fails to summarize must not VANISH (admin advocacy #7):
      // with ~4600 files, one YAML typo silently un-authoring a quiz gate is
      // indistinguishable from "never written". Name every casualty once per
      // warm, and keep the count readable (bankHealth) for a health surface.
      const failed = [];
      const list = raws
        .map(({ id, raw }) => {
          const s = raw ? summarizeQuestionBank(raw) : null;
          if (!s) { failed.push(id); return null; }
          return { ...s, id: s.id ?? id, subject: s.subject ?? null };
        })
        .filter(Boolean);
      if (failed.length) {
        this.#logger.error?.('school.bank.summarize-failed', {
          count: failed.length, ids: failed.slice(0, 20), truncated: failed.length > 20,
        });
      }
      this.#bankSummaries = { at: this.#now(), list, failed };
      return list;
    })().finally(() => { this.#warming = null; });
    return this.#warming;
  }

  // SYNC read of the cached summaries — never scans files itself (that would
  // block the event loop). If the cache is missing/stale it kicks an async
  // refresh and serves what it has (empty on the very first call, until the
  // boot pre-warm lands). Callers that need the full list on a cold cache
  // (the /banks route) await warmBanks() first.
  listBanks({ audience } = {}) {
    if (!this.#bankSummariesFresh()) this.warmBanks().catch(() => {});
    const list = this.#bankSummaries?.list ?? [];
    return audience ? list.filter((b) => b.audience === audience) : list;
  }

  /** Health read (admin advocacy #7): how the last warm went. */
  bankHealth() {
    return {
      warmedAt: this.#bankSummaries?.at ?? null,
      banks: this.#bankSummaries?.list?.length ?? 0,
      failed: [...(this.#bankSummaries?.failed ?? [])],
    };
  }

  getBank(bankId) {
    const bank = this.#loadBank(bankId);
    if (!bank) throw new EntityNotFoundError('bank', bankId);
    return bank;
  }

  #isExpired(session) {
    return this.#now() - session.lastActiveAt > SESSION_TTL_MS;
  }

  // Sweeps every stale entry out of #sessions. Driven by normal traffic (called
  // from openSession, which runs as a public HTTP endpoint) rather than a timer,
  // so an opened-then-abandoned session (reload, dropped connection, a kid who
  // never comes back) doesn't sit in memory forever waiting for someone to look
  // it up by id. Uses the same #isExpired/#now/SESSION_TTL_MS as #session() —
  // one notion of expiry, not two.
  #sweepExpired() {
    for (const [id, s] of this.#sessions) {
      if (this.#isExpired(s)) this.#sessions.delete(id);
    }
  }

  /**
   * Live in-memory sittings, projected to `{userId, lastActiveAt}` ONLY —
   * never the session object itself (which carries the whole loaded bank).
   * This is the portal DoNow surface's occupancy source (spec §5/§5.1):
   * an open quiz/drill session IS the on-screen-work signal, so the sweep
   * runs first — an expired sitting must not read as "occupied" just
   * because nobody has looked it up by id since it went stale.
   */
  activeSittings() {
    this.#sweepExpired();
    return [...this.#sessions.values()].map((s) => ({ userId: s.userId, lastActiveAt: s.lastActiveAt }));
  }

  openSession({ userId = null, bankId, mode, fresh = false }) {
    const bank = this.getBank(bankId); // throws EntityNotFoundError
    return this.#openResolvedSession({ userId, bank, mode, learningContext: null, fresh });
  }

  /**
   * Open against a bank already resolved by a trusted application use case.
   * HTTP never supplies this snapshot directly: Catalog session opening first
   * verifies learner visibility, address, module, mode, and bank identity.
   */
  openResolvedSession({ userId = null, bankSnapshot, mode, learningContext = null, provenance = null, fresh = false }) {
    const validated = validateQuestionBank(bankSnapshot);
    if (!validated.ok) {
      throw new ValidationError(`resolved question bank is invalid: ${validated.errors.join('; ')}`);
    }
    return this.#openResolvedSession({ userId, bank: validated.bank, mode, learningContext, provenance, fresh });
  }

  #openResolvedSession({ userId, bank, mode, learningContext, provenance = null, fresh = false }) {
    const bankRev = bankContentRev(bank);
    this.#sweepExpired();
    if (!MODES.has(mode)) throw new ValidationError(`mode must be quiz|flashcard|drill|learning_probe, got: ${mode}`);
    if (userId != null && !this.#isLearner(userId)) throw new ValidationError(`unknown learner: ${userId}`);
    const normalized = normalizeLearningContext(learningContext, { path: 'session.learning' });
    if (normalized.errors.length) throw new ValidationError(normalized.errors.join('; '));
    if (userId == null && bank.audience !== 'generic') {
      throw new GuestForbiddenError(`guests cannot open assigned bank: ${bank.id}`);
    }
    const session = {
      id: `ses_${shortId(8)}`, userId, bankId: bank.id, mode, bank, bankRev,
      learningContext: normalized.learning, provenance,
      startedAt: this.#now(), lastActiveAt: this.#now(), responseClaims: new Map(),
    };
    // Mid-quiz resumability (Task 17): only interactively-opened, signed-in
    // QUIZ sessions carry a sitting — never guests (nothing on disk to
    // resume), never drill/flashcard/probe (different evidence purposes),
    // never the synthetic sessions the import paths build (they manage their
    // own dedupe via provenance). The sitting is a convenience: every branch
    // below is best-effort and can only cost the resume point, never a grade.
    const resume = this.#sittings && userId != null && mode === 'quiz'
      ? this.#attachSitting(session, { fresh })
      : null;
    this.#sessions.set(session.id, session);
    this.#logger.info?.('school.session.open', {
      sessionId: session.id, bankId: bank.id, mode, userId,
      lessonId: normalized.learning.lessonId ?? null,
      moduleId: normalized.learning.moduleId ?? null,
      ...(resume ? { resumedAnswers: resume.answeredItemIds.length } : {}),
    });
    return resume ? { sessionId: session.id, resume } : { sessionId: session.id };
  }

  /**
   * Wire a session to its persisted sitting. Marks the session
   * sitting-eligible (so #gradeAndRecord upserts after each recorded answer),
   * and, unless `fresh`, preloads a matching sitting: same mode, carrying
   * the originating sessionId (reused as the resumed session's id), same
   * bankRev (an edited bank invalidates the resume point — the questions the
   * answers belong to no longer exist as asked), younger than 24h, and
   * strictly PARTIAL (a full sitting should have been deleted on completion;
   * if one survives a crash, reopening it would leave nothing to answer).
   * Returns the resume payload for the caller, or null.
   */
  #attachSitting(session, { fresh }) {
    session.sittingEligible = true;
    session.sittingStartedAt = new Date(this.#now()).toISOString();
    session.sittingAnswers = [];
    session.answeredItemIds = new Set();
    if (fresh) {
      // A deliberate restart wipes the old run before it can ever resume.
      try {
        this.#sittings.remove(session.userId, session.bankId);
      } catch (err) {
        this.#logger.warn?.('school.sitting.write-failed', {
          userId: session.userId, bankId: session.bankId, op: 'fresh-wipe', error: err?.message,
        });
      }
      return null;
    }
    let sitting;
    try {
      sitting = this.#sittings.read(session.userId, session.bankId); // corrupt file → null (store warns)
    } catch (err) {
      // A convenience must never cost the open: a throwing store reads as
      // "no sitting" — the quiz starts at the top instead of 500ing.
      this.#logger.warn?.('school.sitting.read-failed', {
        userId: session.userId, bankId: session.bankId, error: err?.message,
      });
      return null;
    }
    if (!sitting || sitting.mode !== 'quiz') return null;
    // A sitting persisted before session identity was recorded (no sessionId)
    // cannot resume: the resumed run would answer under a NEW session id, so
    // quizSessionPassed — which folds distinct-correct items BY sessionId —
    // would never see one passing session, and the unit gate would stay shut
    // while the runner shows "Passed". Ignored + replaced, same as the
    // bankRev/prefix rules (final-review F1).
    if (typeof sitting.sessionId !== 'string' || sitting.sessionId.length === 0) return null;
    if ((sitting.bankRev ?? null) !== (session.bankRev ?? null)) return null;
    const age = this.#now() - Date.parse(sitting.startedAt ?? '');
    if (!Number.isFinite(age) || age < 0 || age >= SITTING_TTL_MS) return null;
    const answers = sitting.answers
      .filter((a) => a && typeof a.itemId === 'string')
      .map((a) => ({ itemId: a.itemId, correct: a.correct === true ? true : a.correct === false ? false : null }));
    if (answers.length === 0 || answers.length >= session.bank.items.length) return null;
    // Resume is INDEX-BASED (the runner restarts at answers.length), so the
    // sitting must be an ordered PREFIX of the bank. A gap — an append that
    // failed mid-run, leaving e.g. [q1, q3] — would resume onto an
    // already-answered item, get refused, and loop until the TTL; and its
    // outcomes would misattribute positionally in the summary dots. Any
    // mismatch is ignored and replaced, same as the stale/bankRev rules.
    if (!answers.every((a, i) => a.itemId === session.bank.items[i]?.id)) return null;
    session.sittingStartedAt = typeof sitting.startedAt === 'string' ? sitting.startedAt : session.sittingStartedAt;
    session.sittingAnswers = answers;
    session.answeredItemIds = new Set(answers.map((a) => a.itemId));
    // REUSE the originating session id: the resumed run's attempts land in
    // the attempt log under the same sessionId as the answers it resumes, so
    // the whole quiz reads as ONE session to quizSessionPassed. If a
    // still-live entry holds that id in this process (a same-process reopen),
    // the caller's #sessions.set(session.id, …) deliberately replaces it —
    // same identity, same sitting, fresher state.
    session.id = sitting.sessionId;
    return {
      answeredItemIds: answers.map((a) => a.itemId),
      score: answers.filter((a) => a.correct === true).length,
      outcomes: answers.map((a) => a.correct),
    };
  }

  #session(sessionId) {
    const s = this.#sessions.get(sessionId);
    if (!s) throw new SessionGoneError(`no session ${sessionId}`);
    if (this.#isExpired(s)) {
      this.#sessions.delete(sessionId);
      throw new SessionGoneError(`session expired: ${sessionId}`);
    }
    s.lastActiveAt = this.#now();
    return s;
  }

  /**
   * `transport` is provenance only (spec §7.1): a paper answer is graded by the
   * same engine, against the same bank, producing the same attempt — "paper
   * earns nothing the screen couldn't". It defaults to `'screen'`, so every
   * existing caller is unaffected.
   */
  answer({
    sessionId, itemId, given, selfGrade, transport = 'screen', provenance = null,
    probeAttemptNumber = null, responseId = null,
  }) {
    const s = this.#session(sessionId);
    const item = s.bank.items.find((i) => i.id === itemId);
    if (!item) throw new ValidationError(`unknown item: ${itemId}`);
    if (s.mode === 'learning_probe') {
      if (!Number.isInteger(probeAttemptNumber) || probeAttemptNumber < 1 || probeAttemptNumber > 3) {
        throw new ValidationError('learning_probe answer requires probeAttemptNumber from 1 to 3');
      }
      if (typeof responseId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(responseId)) {
        throw new ValidationError('learning_probe answer requires a stable responseId');
      }
      provenance = { ...(provenance ?? {}), probe: { attemptNumber: probeAttemptNumber } };
    } else if (probeAttemptNumber !== null) {
      throw new ValidationError('probeAttemptNumber is accepted only for learning_probe sessions');
    }

    if (responseId) {
      const fingerprint = stableValue({ itemId, given, selfGrade, probeAttemptNumber });
      const prior = s.responseClaims.get(responseId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ValidationError(`responseId conflict: ${responseId}`);
        return structuredClone(prior.outcome);
      }
      const outcome = this.#gradeAndRecord({ session: s, item, given, selfGrade, transport, provenance });
      s.responseClaims.set(responseId, { fingerprint, outcome: structuredClone(outcome) });
      return outcome;
    }
    return this.#gradeAndRecord({ session: s, item, given, selfGrade, transport, provenance });
  }

  /**
   * Return the server-authoritative evidence needed to offer tutoring after a
   * completed Catalog quiz. This is an application-to-application seam, not an
   * HTTP response: the immutable bank snapshot and answers never go back to
   * the browser. Attempts are read from durable storage so a resumed quiz is
   * complete even when some answers came from an earlier process.
   */
  completedQuizAssessment({ sessionId, learnerId } = {}) {
    const session = this.#session(sessionId);
    if (!learnerId || session.userId !== learnerId) {
      throw new GuestForbiddenError('quiz session does not belong to this learner');
    }
    if (session.mode !== 'quiz' || !session.learningContext?.lessonId || !session.learningContext?.moduleId) {
      throw new ValidationError('adaptive tutoring requires a Catalog quiz session');
    }
    const attempts = effectiveAttempts(this.#ds.readAllAttempts(learnerId))
      .filter((attempt) => attempt.sessionId === session.id
        && attempt.bankId === session.bankId
        && !isRegradeCorrection(attempt));
    const byItem = new Map();
    for (const attempt of attempts) byItem.set(attempt.itemId, attempt);
    const responses = session.bank.items.map((item) => byItem.get(item.id))
      .filter(Boolean)
      .map((attempt) => ({ itemId: attempt.itemId, given: structuredClone(attempt.given) }));
    if (responses.length !== session.bank.items.length) {
      throw new ValidationError('quiz must be complete before adaptive tutoring is offered');
    }
    return {
      sessionId: session.id,
      learnerId,
      bankRev: session.bankRev,
      bank: structuredClone(session.bank),
      learning: structuredClone(session.learningContext),
      responses,
    };
  }

  #gradeAndRecord({ session: s, item, given, selfGrade, transport, provenance, recordedAt = null, learningContext = null }) {
    // A resumed sitting has already banked some answers: re-answering one
    // would double-record the item and skew the score, so it is refused
    // outright (the runner skips answered items; only a stale/forged client
    // can reach this). SCREEN answers only: a sitting is the interactive
    // screen run — paper grading (GradeSubmission opens a quiz session with
    // transport 'paper') manages its own dedupe and must be neither refused
    // by nor recorded into a screen sitting.
    if (transport === 'screen' && s.answeredItemIds?.has(item.id)) {
      throw new ValidationError(`item ${item.id} already answered in this sitting`);
    }
    let correct, expected, recordedGiven;
    if (s.mode === 'quiz' || s.mode === 'drill' || s.mode === 'learning_probe') {
      if (selfGrade !== undefined) throw new ValidationError('selfGrade is not accepted on a quiz session');
      const shapeErr = givenShapeError(item, given);
      if (shapeErr) throw new ValidationError(shapeErr);
      ({ correct, expected } = gradeAnswer(item, given));
      recordedGiven = given;
    } else {
      if (given !== undefined) throw new ValidationError('given is not accepted on a flashcard session; send selfGrade');
      if (selfGrade !== 'correct' && selfGrade !== 'incorrect') throw new ValidationError(`selfGrade must be correct|incorrect, got: ${selfGrade}`);
      correct = selfGrade === 'correct';
      recordedGiven = null;
    }

    let attemptId = null;
    if (s.userId != null) {
      const attemptAt = recordedAt ?? new Date(this.#now()).toISOString();
      const attempt = createAttempt({
        id: `att_${shortId(8)}`,
        at: attemptAt,
        sessionId: s.id, bankId: s.bankId, itemId: item.id, itemType: item.type,
        mode: s.mode, given: recordedGiven, correct, attributedTo: s.userId, transport,
        provenance: s.provenance ? { ...s.provenance, ...(provenance ?? {}) } : provenance,
        bankRev: s.bankRev ?? null,
        learning: {
          ...(learningContext ?? s.learningContext ?? {}),
          ...((learningContext ?? s.learningContext)?.subjectId || !s.bank.subject ? {} : { subjectId: s.bank.subject }),
          ...((learningContext ?? s.learningContext)?.unitId || !s.bank.unit ? {} : { unitId: s.bank.unit }),
          conceptIds: [...new Set([
            ...((learningContext ?? s.learningContext)?.conceptIds ?? []),
            ...(item.concepts ?? []),
          ])],
          tags: [...new Set([
            ...((learningContext ?? s.learningContext)?.tags ?? []),
            ...(s.bank.topics ?? []),
          ])],
        },
      });
      // appendAttempt can fail two ways: it can throw (router 500, UI shows
      // "unrecorded"), or — per YamlSchoolDatastore — return null/falsy without
      // throwing when it can't resolve the user's attempts dir (a profile lookup
      // that disagrees with the one openSession checked). A falsy return must be
      // treated as a failure too, or the caller gets a plausible attemptId for an
      // attempt that was never written.
      const appended = this.#ds.appendAttempt(s.userId, attempt);
      if (!appended) {
        throw new PersistenceError('write', `attempt not recorded for user ${s.userId} (session ${s.id})`, {
          userId: s.userId, sessionId: s.id, itemId: item.id, bankId: s.bankId,
        });
      }
      attemptId = attempt.id;
      // Sitting persistence (Task 17) — ONLY after the attempt append
      // succeeded, ONLY for sessions #attachSitting marked eligible
      // (signed-in interactive quiz), and ONLY for screen answers (see the
      // transport note above). Best-effort by contract: the attempt IS the
      // record; a sitting-store failure warns and never fails the answer.
      if (s.sittingEligible && transport === 'screen') {
        s.answeredItemIds.add(item.id);
        s.sittingAnswers.push({ itemId: item.id, correct });
        try {
          if (s.sittingAnswers.length >= s.bank.items.length) {
            this.#sittings.remove(s.userId, s.bankId); // complete — nothing left to resume
          } else {
            this.#sittings.upsert(s.userId, s.bankId, {
              mode: s.mode,
              // The ORIGINATING session identity: #attachSitting reuses it as
              // the resumed session's id so the attempt log stays one session.
              sessionId: s.id,
              startedAt: s.sittingStartedAt,
              bankRev: s.bankRev ?? null,
              answers: s.sittingAnswers.map((a) => ({ itemId: a.itemId, correct: a.correct })),
            });
          }
        } catch (err) {
          this.#logger.warn?.('school.sitting.write-failed', {
            userId: s.userId, bankId: s.bankId, itemId: item.id, error: err?.message,
          });
        }
      }
    }
    return (s.mode === 'quiz' || s.mode === 'drill' || s.mode === 'learning_probe')
      ? { correct, expected, attemptId }
      : { attemptId };
  }

  /**
   * Import a verified calculator receipt through the ordinary drill grader.
   * The receipt id is retained on every attempt, so a scan retry only fills a
   * previously interrupted import and never earns duplicate credit.
   */
  importCalculatorReceipt({ userId, bankId, receiptId, calculatorId, packId, attemptSequence, record = null, answers }) {
    if (!userId) throw new GuestForbiddenError('Sign in to import a calculator result');
    if (!Array.isArray(answers) || answers.length === 0) throw new ValidationError('calculator receipt has no answers');
    const bank = this.getBank(bankId);
    if (answers.length !== bank.items.length) throw new ValidationError(`calculator receipt has ${answers.length} answers; ${bank.items.length} required`);
    const prior = this.#ds.readAllAttempts(userId).filter((a) => a.provenance?.receiptId === receiptId);
    // A calculator sequence is immutable. A second payload claiming that same
    // identity is not a harmless duplicate: it is corruption or tampering and
    // must not receive the original record's idempotency acknowledgement.
    const priorRecords = new Set(prior.map((a) => a.provenance?.record).filter(Boolean));
    if (priorRecords.size && (!record || !priorRecords.has(record))) {
      throw new ValidationError(`calculator receipt collision: ${receiptId}`);
    }
    const recorded = new Set(prior.map((a) => a.itemId));
    const { sessionId } = this.openSession({ userId, bankId, mode: 'drill' });
    const results = [];
    bank.items.forEach((item, index) => {
      if (recorded.has(item.id)) return;
      const choiceIndex = Number(answers[index]) - 1;
      if (!Number.isInteger(choiceIndex) || !item.choices?.[choiceIndex]) throw new ValidationError(`invalid choice for ${item.id}`);
      results.push(this.answer({ sessionId, itemId: item.id, given: item.choices[choiceIndex], transport: 'calculator',
        provenance: { receiptId, record, calculatorId, packId, attemptSequence, question: index + 1 } }));
    });
    return { receiptId, duplicate: results.length === 0, imported: results.length, correct: results.filter((r) => r.correct).length, total: bank.items.length };
  }

  /**
   * Import stable-ID SchoolCalc responses through the same session grader used
   * by the screen and paper surfaces. A retry scans attempt provenance first,
   * so an interruption after append but before ledger completion resumes only
   * missing items.
   */
  importSchoolCalcAssessment({ learnerId, submission, bankSnapshot, mode, recordDigest, receivedAt, learningContext = null }) {
    if (!learnerId) throw new GuestForbiddenError('SchoolCalc result has no learner binding');
    if (!MODES.has(mode)) throw new ValidationError(`SchoolCalc assessment mode must be quiz|flashcard|drill|learning_probe, got: ${mode}`);
    if (!isCanonicalTimestamp(receivedAt)) {
      throw new ValidationError('SchoolCalc receivedAt must be a canonical ISO-8601 timestamp');
    }
    const validated = validateQuestionBank(bankSnapshot);
    if (!validated.ok) {
      throw new ValidationError(`SchoolCalc artifact bank is invalid: ${validated.errors.join('; ')}`);
    }
    const bank = validated.bank;
    const resultId = `${submission.deviceId}:${submission.sequence}`;
    const prior = this.#ds.readAllAttempts(learnerId)
      .filter((attempt) => attempt.provenance?.schoolCalc?.resultId === resultId);
    const priorDigests = new Set(prior.map((attempt) => attempt.provenance?.schoolCalc?.recordDigest).filter(Boolean));
    if (priorDigests.size && !priorDigests.has(recordDigest)) {
      throw new ValidationError(`SchoolCalc result collision: ${resultId}`);
    }

    // The immutable artifact interpretation is the authority for what the
    // learner actually saw. This intentionally does not reload today's YAML:
    // an offline result may arrive after the source bank was edited.
    const expected = new Set(bank.items.map((item) => item.id));
    for (const response of submission.responses) {
      if (!expected.has(response.itemId)) throw new ValidationError(`unknown item: ${response.itemId}`);
    }
    const recorded = new Set(prior.map((attempt) => attempt.itemId));
    const session = {
      id: `schoolcalc:${resultId}`,
      userId: learnerId,
      bankId: bank.id,
      mode,
      bank,
      learningContext,
    };
    const results = [];
    for (const response of submission.responses) {
      if (recorded.has(response.itemId)) continue;
      const item = bank.items.find((entry) => entry.id === response.itemId);
      const selfGrade = mode === 'flashcard'
        ? response.given === true ? 'correct' : response.given === false ? 'incorrect' : response.given
        : undefined;
      results.push(this.#gradeAndRecord({
        session,
        item,
        given: mode === 'flashcard' ? undefined : response.given,
        selfGrade,
        transport: 'calculator',
        recordedAt: receivedAt,
        provenance: {
          schoolCalc: {
            resultId,
            recordDigest,
            timeBasis: 'backend_received',
            deviceId: submission.deviceId,
            sequence: submission.sequence,
            artifactId: submission.artifactId,
            lessonId: submission.lessonId,
            moduleId: submission.moduleId,
            ...(response.probe ? { probe: structuredClone(response.probe) } : {}),
          },
        },
      }));
    }
    return {
      resultId,
      imported: results.length,
      duplicateItems: submission.responses.length - results.length,
      correct: results.filter((entry) => entry.correct).length,
      total: submission.responses.length,
    };
  }

  /**
   * Return only completed, server-tagged assessments for an assigned flashcard
   * deck. Ordinary practice of the same bank is deliberately not evidence: the
   * tag can be created only by FlashcardStudyService's assignment gate.
   */
  flashcardTestStatus(userId, { deckId, bankId, passingPercent = 80 } = {}) {
    if (!this.#isLearner(userId)) throw new ValidationError(`unknown learner: ${userId}`);
    const grouped = new Map();
    for (const attempt of effectiveAttempts(this.#ds.readAllAttempts(userId))) {
      const test = attempt?.provenance?.flashcardTest;
      if (isRegradeCorrection(attempt) || attempt.mode !== 'quiz' || attempt.bankId !== bankId
          || !test || test.deckId !== deckId || !Number.isInteger(test.itemCount) || test.itemCount < 1) continue;
      const key = `${attempt.sessionId}/${test.testId ?? ''}`;
      if (!grouped.has(key)) grouped.set(key, { sessionId: attempt.sessionId, itemCount: test.itemCount, items: new Map(), at: attempt.at });
      const group = grouped.get(key);
      // A contradictory tag cannot be made into a passing run by mixing rows.
      if (group.itemCount !== test.itemCount) { group.invalid = true; continue; }
      group.items.set(attempt.itemId, attempt.correct === true);
      if (String(attempt.at) > String(group.at)) group.at = attempt.at;
    }
    const completed = [...grouped.values()].filter((group) => !group.invalid && group.items.size === group.itemCount)
      .map((group) => ({ ...group, correct: [...group.items.values()].filter(Boolean).length }))
      .map((group) => ({ ...group, percent: Math.round((group.correct / group.itemCount) * 100) }));
    completed.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const passing = completed.find((group) => group.percent >= passingPercent) ?? null;
    return { passed: Boolean(passing), passingPercent, latest: completed[0] ?? null, passing };
  }

  getResults(userId, { bankId } = {}) {
    if (!this.#isLearner(userId)) throw new ValidationError(`unknown learner: ${userId}`);
    const all = effectiveAttempts(this.#ds.readAllAttempts(userId));
    const byBank = new Map();
    for (const a of all) {
      if (isRegradeCorrection(a)) continue; // verdict amendments, not new work (M8)
      if (bankId && a.bankId !== bankId) continue;
      if (!byBank.has(a.bankId)) {
        byBank.set(a.bankId, { bankId: a.bankId,
          quiz: { attempts: 0, correct: 0, lastAt: null },
          flashcard: { attempts: 0, correct: 0, lastAt: null },
          drill: { attempts: 0, correct: 0, lastAt: null },
          learningProbe: { attempts: 0, correct: 0, lastAt: null },
          items: {} });
      }
      const b = byBank.get(a.bankId);
      const lane = a.mode === 'flashcard' ? b.flashcard
        : a.mode === 'drill' ? b.drill
          : a.mode === 'learning_probe' ? b.learningProbe
            : b.quiz; // distinct evidence purposes are never merged (spec §5)
      lane.attempts += 1;
      if (a.correct) lane.correct += 1;
      lane.lastAt = a.at;
      if (a.mode === 'quiz') { // items feed the future R2.5 completion gate: quiz-mode only
        const it = b.items[a.itemId] || (b.items[a.itemId] = { quizAttempts: 0, quizCorrect: 0, lastCorrect: null });
        it.quizAttempts += 1;
        if (a.correct) it.quizCorrect += 1;
        it.lastCorrect = a.correct;
      }
    }
    if (bankId) {
      return byBank.get(bankId) || { bankId,
        quiz: { attempts: 0, correct: 0, lastAt: null },
        flashcard: { attempts: 0, correct: 0, lastAt: null },
        drill: { attempts: 0, correct: 0, lastAt: null },
        learningProbe: { attempts: 0, correct: 0, lastAt: null }, items: {} };
    }
    return [...byBank.values()];
  }

  #isLearner(userId) {
    return this.#learnerDirectory?.hasLearner?.(userId) ?? Boolean(this.#userService.getProfile(userId));
  }

  // -- program report (IProgramReporter) -----------------------------------

  get id() { return 'quizzes'; }

  get label() { return 'Quizzes & flashcards'; }

  /**
   * Quiz and flashcard standing for one learner.
   *
   * Emits no `next`, and that is the contract working as intended rather than
   * a gap: nothing here assigns work, so there is no honest next step to name.
   * A program reports what it truthfully has — inventing a "next" would put a
   * suggestion on the board indistinguishable from a real assignment.
   *
   * Quiz and flashcard tallies stay separate for the same reason they always
   * have: one is server-graded evidence, the other a self-report, and a merged
   * score would silently launder the second into the first.
   */
  summarize({ userId }) {
    if (!userId) return [];
    // Deliberately NOT windowed like the dedup reads elsewhere in this file
    // (`importCalculatorReceipt`, `importSchoolCalcAssessment`) or the
    // evidence-source read `YamlSchoolAttemptEvidenceSource` uses for a
    // scoped progress query: every metric below ("questions answered",
    // accuracy, cards drilled) is LIFETIME by definition — sets attempted,
    // ever. Windowing this read would silently change every number a family
    // sees on the board depending on when they last loaded it. If this full
    // scan ever becomes the cost floor (years of accumulated attempt-day
    // files per learner), the parked remedy is a per-user month index —
    // attempts pre-aggregated by `YYYY-MM` so a lifetime summarize stays
    // O(months) instead of O(days) — not built now, since no household is
    // near that scale.
    const attempts = effectiveAttempts(this.#ds.readAllAttempts(userId))
      .filter((a) => !isRegradeCorrection(a));
    if (attempts.length === 0) return [];

    const graded = attempts.filter((a) => a.mode === 'quiz');
    const drilledCards = attempts.filter((a) => a.mode === 'flashcard');
    const drilledGeo = attempts.filter((a) => a.mode === 'drill');
    const lastActivity = attempts.reduce((max, a) => (String(a.at) > max ? String(a.at) : max), '');
    const banks = new Set(attempts.map((a) => a.bankId).filter(Boolean));

    const metrics = [
      { id: 'answered', kind: 'count', label: 'Questions answered', value: graded.length, unit: 'questions' },
    ];
    // Accuracy stays parent-only by default (see reporting.mjs): side by side
    // with a sibling's on a hallway panel it is a public ranking.
    if (graded.length) {
      metrics.push({
        id: 'accuracy', kind: 'score', label: 'Quiz accuracy',
        value: graded.filter((a) => a.correct).length / graded.length,
      });
    }
    if (drilledCards.length) {
      metrics.push({ id: 'drilled', kind: 'count', label: 'Cards drilled', value: drilledCards.length, unit: 'cards' });
    }
    if (drilledGeo.length) {
      metrics.push({ id: 'drilled-geo', kind: 'count', label: 'Geography drilled', value: drilledGeo.length, unit: 'questions' });
    }

    const idleMs = this.#now() - Date.parse(lastActivity || 0);
    return [{
      program: this.id,
      instanceId: 'banks',
      label: this.label,
      userId,
      state: idleMs > 14 * 86400000 ? 'idle' : 'active',
      lastActivity: lastActivity || null,
      headline: `${banks.size} ${banks.size === 1 ? 'set' : 'sets'} attempted`,
      next: null,
      metrics,
    }];
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

export default SchoolService;
