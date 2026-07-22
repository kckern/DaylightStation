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

  getRoster() {
    const profiles = [...this.#userService.getAllProfiles().values()];
    return profiles
      .map((p) => ({ id: p.username, name: p.display_name || p.username, group_label: p.group_label }))
      .sort((a, b) => a.name.localeCompare(b.name));
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
      .map((b) => ({ id: b.id, title: b.title, audience: b.audience, topics: b.topics, itemCount: b.items.length, unit: b.unit }));
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
}

export default SchoolService;
