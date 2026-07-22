/**
 * Use cases for the school app (spec §5). Owns session policy and the
 * mode-split answer contract; the datastore is dumb storage; the router is a
 * thin shell. Sessions are IN MEMORY by design — a restart costs the remainder
 * of one sitting, never a recorded attempt (those are already on disk).
 */
import { validateQuestionBank, gradeAnswer, givenShapeError, createAttempt, GuestForbiddenError, SessionGoneError } from '#domains/school/index.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { PersistenceError } from '#system/utils/errors/index.mjs';
import { shortId } from '#domains/core/utils/id.mjs';

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MODES = new Set(['quiz', 'flashcard']);

export class SchoolService {
  #ds; #userService; #logger; #now;
  #sessions = new Map(); // sessionId -> {id, userId|null, bankId, mode, bank, startedAt, lastActiveAt}

  constructor({ datastore, userService, logger = console, now = () => Date.now() }) {
    this.#ds = datastore;
    this.#userService = userService;
    this.#logger = logger;
    this.#now = now;
  }

  /**
   * The household roster, in household order.
   *
   * Previously this sorted by `display_name` while the picker rendered
   * `group_label`, so the order was computed from strings nobody could see —
   * "Elizabeth" and "KC Kern" sorting into positions labelled "Mom" and "Dad".
   * It looked random because it was sorted on invisible keys, and it disagreed
   * with every other picker in the house.
   */
  getRoster() {
    return this.#userService.getHouseholdRoster();
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
    return materialId ? list.filter((r) => r.materialId === materialId) : list;
  }

  #loadBank(bankId) {
    const raw = this.#ds.readBankRaw(bankId);
    if (!raw) return null;
    const r = validateQuestionBank(raw);
    if (!r.ok) {
      this.#logger.warn?.('school.bank.invalid', { file: `${bankId}.yml`, reason: r.errors.join('; ') });
      return null;
    }
    return r.bank;
  }

  listBanks({ audience } = {}) {
    return this.#ds.listBankIds()
      .map((id) => this.#loadBank(id))
      .filter(Boolean)
      .filter((b) => !audience || b.audience === audience)
      .map((b) => ({ id: b.id, title: b.title, audience: b.audience, topics: b.topics, subject: b.subject ?? null, itemCount: b.items.length, unit: b.unit }));
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

  openSession({ userId = null, bankId, mode }) {
    this.#sweepExpired();
    if (!MODES.has(mode)) throw new ValidationError(`mode must be quiz|flashcard, got: ${mode}`);
    if (userId != null && !this.#userService.getProfile(userId)) throw new ValidationError(`unknown user: ${userId}`);
    const bank = this.getBank(bankId); // throws EntityNotFoundError
    if (userId == null && bank.audience !== 'generic') {
      throw new GuestForbiddenError(`guests cannot open assigned bank: ${bankId}`);
    }
    const session = { id: `ses_${shortId(8)}`, userId, bankId, mode, bank, startedAt: this.#now(), lastActiveAt: this.#now() };
    this.#sessions.set(session.id, session);
    this.#logger.info?.('school.session.open', { sessionId: session.id, bankId, mode, userId });
    return { sessionId: session.id };
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

  answer({ sessionId, itemId, given, selfGrade }) {
    const s = this.#session(sessionId);
    const item = s.bank.items.find((i) => i.id === itemId);
    if (!item) throw new ValidationError(`unknown item: ${itemId}`);

    let correct, expected, recordedGiven;
    if (s.mode === 'quiz') {
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
      const attempt = createAttempt({
        sessionId: s.id, bankId: s.bankId, itemId, itemType: item.type,
        mode: s.mode, given: recordedGiven, correct, attributedTo: s.userId,
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
          userId: s.userId, sessionId: s.id, itemId, bankId: s.bankId,
        });
      }
      attemptId = attempt.id;
    }
    return s.mode === 'quiz' ? { correct, expected, attemptId } : { attemptId };
  }

  getResults(userId, { bankId } = {}) {
    if (!this.#userService.getProfile(userId)) throw new ValidationError(`unknown user: ${userId}`);
    const all = this.#ds.readAllAttempts(userId);
    const byBank = new Map();
    for (const a of all) {
      if (bankId && a.bankId !== bankId) continue;
      if (!byBank.has(a.bankId)) {
        byBank.set(a.bankId, { bankId: a.bankId, quiz: { attempts: 0, correct: 0, lastAt: null }, flashcard: { attempts: 0, correct: 0, lastAt: null }, items: {} });
      }
      const b = byBank.get(a.bankId);
      const lane = a.mode === 'flashcard' ? b.flashcard : b.quiz; // never merged (spec §5)
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
      return byBank.get(bankId) || { bankId, quiz: { attempts: 0, correct: 0, lastAt: null }, flashcard: { attempts: 0, correct: 0, lastAt: null }, items: {} };
    }
    return [...byBank.values()];
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
    const attempts = this.#ds.readAllAttempts(userId) || [];
    if (attempts.length === 0) return [];

    const graded = attempts.filter((a) => a.mode === 'quiz');
    const drilled = attempts.filter((a) => a.mode === 'flashcard');
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
    if (drilled.length) {
      metrics.push({ id: 'drilled', kind: 'count', label: 'Cards drilled', value: drilled.length, unit: 'cards' });
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

export default SchoolService;
