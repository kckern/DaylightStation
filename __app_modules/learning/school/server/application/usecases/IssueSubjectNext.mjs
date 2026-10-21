/**
 * IssueSubjectNext — "print my next sheet", from any School surface, with no
 * code (school economy slice 1, Task C1).
 *
 * The keypad prints through a six-digit code (`RunSelfServiceAction`). The
 * Portal's bank strip and the piano kiosk's lock screen have no code to type,
 * and the subject-code door (`IssueSubjectCode`) is fenced off from the
 * Portal. This is their door instead, and what keeps it Portal-safe is how
 * little it accepts: a learner on the roster, optionally one of THAT
 * learner's own subjects, and a device id for the log. Never a unit, a
 * session or a document. It can only print the sheet the learner's own plan
 * says is next — the same answer a scanned subject ticket gets
 * (`ResolveSubjectNext`).
 *
 * THE STEPS
 *
 *   1. With no subject named, the subject is chosen from the day's verdict
 *      (`GetLearnerDayCompletion`): obligated sections first, in plan order,
 *      then electives (excused, not yet served). Within a tier the first one
 *      whose next move is PAPER wins, so a program or a video sitting first
 *      does not swallow the button; with no paper anywhere, the first
 *      candidate answers with its own sentence.
 *   2. `ResolveSubjectNext` resolves that subject — and ensures the session,
 *      exactly as for a scanned ticket.
 *   3. When the card for that resolution offers `print`, the sheet goes out
 *      through `printSessionSheet`, the helper the keypad's `print` button
 *      uses. Anything else (served, locked, empty, a program, a video) gets
 *      its sentence and nothing is printed.
 *
 * THE DEBOUNCE IS PER LEARNER, AND IT COMES FIRST. `IssueDocument` already
 * refuses a reprint of one SESSION inside `printCooldownMinutes`; this is a
 * different guard, against one child tapping the strip and the kiosk (or one
 * button twice) a moment apart. It is checked and armed synchronously before
 * anything is read, so two requests in flight together still print once. It
 * is RELEASED when the tap printed nothing — a refusal, a failure, the
 * session cooldown — because "it's already on its way" must never be said
 * about a sheet that is not; a printer that failed must be retryable at once
 * (Phase A's heal-on-retry).
 *
 * `preview` is the dry run behind `GET /next`: which subject and unit the
 * button would print, read WITHOUT opening a session, plus an optional reward
 * label from an injected port.
 */
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { reduceSession, createEvent } from "../../domain/sessions/sessionEvents.mjs";
import { offeredCard } from "../../domain/selfService/offeredActions.mjs";
import { nextMove, remediationOptionsFor } from "./offerSession.mjs";
import { pausedExceptionFor } from "../curriculumExceptionProjection.mjs";
import { SYNTHETIC_SESSION_ID } from "./ResolveAccessCode.mjs";
import { PRINT_RESULTS, TELL_A_GROWN_UP, printSessionSheet } from "./printSessionSheet.mjs";

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;
const DEVICE_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,80}$/;
export const DEFAULT_DEBOUNCE_MS = 20_000;

const ON_ITS_WAY = PRINT_RESULTS.debounced.sentence;
/** The bulk card's own words for "nothing left today" (`ResolveAccessCode#bulkAllDone`). */
const ALL_DONE = "You're all done for today!";

const EVENTS = Object.freeze({
  failed: 'school.subject-next.failed',
  unwired: 'school.subject-next.unwired',
  unknownStatus: 'school.subject-next.unknown-status',
  useCaseFailed: 'school.subject-next.use-case-failed',
});

const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/** The one new line: work whose next step is not paper. */
const noSheetSentence = (work) => (work?.label
  ? `There's no sheet to print for this one. ${work.label} instead.`
  : TELL_A_GROWN_UP);

const unitView = (unit, fallbackSubject) => (unit ? {
  unitId: unit.unitId ?? null,
  title: unit.title ?? null,
  subject: unit.subject ?? fallbackSubject ?? null,
} : null);

export class IssueSubjectNext {
  #resolver; #completion; #projection; #sessions; #issue; #roster; #rewardFor;
  #debounceMs; #clock; #logger;
  /** learnerId -> epoch ms of the last tap still counted as on its way. */
  #taps = new Map();

  /**
   * @param {object} deps
   * @param {import('./ResolveSubjectNext.mjs').ResolveSubjectNext} deps.resolveSubjectNext
   * @param {import('../GetLearnerDayCompletion.mjs').GetLearnerDayCompletion} deps.getLearnerDayCompletion
   * @param {import('../PlanProjection.mjs').PlanProjection} deps.planProjection
   *   the SAME projection `ResolveSubjectNext` plans from; read here only to
   *   look ahead without opening a session
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {import('./IssueDocument.mjs').IssueDocument} [deps.issueDocument]
   * @param {(() => Array<{id: string}>)|null} [deps.roster] - who may be named
   * @param {((args: {learnerId: string, unit: object}) => Promise<object|null>)|null} [deps.rewardFor]
   *   optional label source for `preview`; null, absent or throwing all mean
   *   "no reward shown"
   * @param {number} [deps.debounceMs]
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({
    resolveSubjectNext, getLearnerDayCompletion, planProjection, sessions,
    issueDocument = null, roster = null, rewardFor = null,
    debounceMs = DEFAULT_DEBOUNCE_MS, clock = () => new Date(), logger = console,
  } = {}) {
    if (!resolveSubjectNext || !getLearnerDayCompletion || !planProjection || !sessions) {
      throw new Error('IssueSubjectNext requires resolveSubjectNext, getLearnerDayCompletion, planProjection and sessions');
    }
    this.#resolver = resolveSubjectNext;
    this.#completion = getLearnerDayCompletion;
    this.#projection = planProjection;
    this.#sessions = sessions;
    this.#issue = issueDocument;
    this.#roster = roster;
    this.#rewardFor = typeof rewardFor === 'function' ? rewardFor : null;
    this.#debounceMs = debounceMs;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {{learnerId: string, subject?: string|null, deviceId?: string|null}} args
   * @returns {Promise<{status: string, outcome: 'done'|'debounced'|'refused'|'failed',
   *   sentence: string, subject: string|null,
   *   unit: {unitId: string|null, title: string|null, subject: string|null}|null,
   *   sessionId: string|null}>}
   * @throws {EntityNotFoundError} learner not on the roster
   * @throws {ValidationError} malformed ids, or a subject that is not the learner's
   */
  async execute({ learnerId, subject = null, deviceId = null } = {}) {
    this.#assertLearner(learnerId);
    const wanted = this.#subjectArg(subject);
    const device = typeof deviceId === 'string' && DEVICE_RE.test(deviceId) ? deviceId : null;

    // Checked and armed with no await in between: two taps in flight together
    // cannot both get past this line.
    const now = this.#clock().getTime();
    const last = this.#taps.get(learnerId);
    if (last !== undefined && now - last < this.#debounceMs) {
      const answer = {
        status: 'debounced', outcome: 'debounced', sentence: ON_ITS_WAY,
        subject: wanted, unit: null, sessionId: null,
      };
      this.#log(answer, { learnerId, deviceId: device });
      return answer;
    }
    this.#taps.set(learnerId, now);

    let answer;
    try {
      answer = await this.#run({ learnerId, subject: wanted });
    } catch (error) {
      this.#release(learnerId, now);
      if (error instanceof ValidationError || error instanceof EntityNotFoundError) throw error;
      this.#logger.error?.(EVENTS.failed, {
        stage: 'run', learnerId, subject: wanted, error: error?.message ?? String(error),
      });
      answer = {
        status: 'error', outcome: 'failed', sentence: TELL_A_GROWN_UP,
        subject: wanted, unit: null, sessionId: null,
      };
    }
    // Only a sheet that really went out stays "on its way".
    if (answer.outcome !== 'done') this.#release(learnerId, now);
    this.#log(answer, { learnerId, deviceId: device });
    return answer;
  }

  /**
   * The dry run: which subject and unit the button would print. Opens no
   * session, mints nothing, and never fails over the reward.
   *
   * @param {{learnerId: string, subject?: string|null}} args
   * @returns {Promise<{subject: string|null, unit: object|null, printable: boolean,
   *   reward: object|null}>}
   */
  async preview({ learnerId, subject = null } = {}) {
    this.#assertLearner(learnerId);
    const wanted = this.#subjectArg(subject);
    const sections = await this.#sections(learnerId, wanted);
    const look = await this.#lookahead(learnerId);
    // The SAME choice `execute` makes, so the label names what will print.
    const chosen = wanted ?? await this.#choose(sections, look);
    const peek = chosen ? look(chosen) : null;
    const unit = peek?.unit ?? null;
    const printable = (await peek?.printable) === true;
    return {
      subject: chosen ?? null,
      unit,
      printable,
      reward: unit ? await this.#reward({ learnerId, unit }) : null,
    };
  }

  async #run({ learnerId, subject }) {
    const sections = await this.#sections(learnerId, subject);
    let chosen = subject;
    if (!chosen) {
      const look = await this.#lookahead(learnerId);
      chosen = await this.#choose(sections, look);
      if (!chosen) {
        const allServed = sections.length > 0 && sections.every((s) => s.state === 'served');
        return {
          status: allServed ? 'served' : 'empty',
          outcome: 'refused',
          sentence: allServed ? ALL_DONE : TELL_A_GROWN_UP,
          subject: null, unit: null, sessionId: null,
        };
      }
    }

    const resolution = await this.#resolver.execute({ learnerId, subject: chosen });
    const unit = unitView(resolution?.unit ?? resolution?.entry ?? null, chosen);
    const card = offeredCard(resolution, {
      ...this.#bankOptions(resolution?.unit), now: this.#clock(),
    });
    const work = card.actions.find((a) => a.kind !== 'exit') ?? null;

    if (resolution?.kind !== 'move' || work?.kind !== 'print') {
      return {
        status: resolution?.kind === 'move' ? 'no_sheet' : (resolution?.kind ?? 'empty'),
        outcome: 'refused',
        sentence: card.sentence ?? noSheetSentence(work),
        subject: chosen, unit, sessionId: null,
      };
    }

    // `ResolveSubjectNext` ensured the session; the id handed to
    // `IssueDocument` is checked to be a real one all the same.
    const { sessionId } = resolution;
    if (typeof sessionId !== 'string' || !sessionId || sessionId === SYNTHETIC_SESSION_ID) {
      this.#logger.error?.('school.subject-next.no-session', { learnerId, subject: chosen, sessionId: sessionId ?? null });
      return {
        status: 'error', outcome: 'failed', sentence: TELL_A_GROWN_UP, subject: chosen, unit, sessionId: null,
      };
    }

    const printed = await printSessionSheet({
      issueDocument: this.#issue, sessionId, logger: this.#logger, events: EVENTS,
    });
    return {
      status: printed.effect?.status ?? 'error',
      outcome: printed.outcome,
      sentence: printed.sentence,
      subject: chosen,
      unit,
      sessionId,
    };
  }

  /** The learner's sections for today, and the subject check against them. */
  async #sections(learnerId, subject) {
    const completion = await this.#completion.execute({ learnerId });
    const sections = (completion?.sections ?? []).filter((s) => typeof s?.subject === 'string');
    if (subject && !sections.some((s) => s.subject === subject)) {
      throw new ValidationError(`${subject} is not one of this learner's subjects`, { field: 'subject' });
    }
    return sections;
  }

  /** Obligated first, then electives; plan order inside each tier. */
  #candidates(sections) {
    return [
      ...sections.filter((s) => s.state === 'obligated'),
      ...sections.filter((s) => s.state === 'excused'),
    ].map((s) => s.subject);
  }

  async #choose(sections, look) {
    const candidates = this.#candidates(sections);
    for (const subject of candidates) {
      // eslint-disable-next-line no-await-in-loop
      if (await look(subject).printable) return subject;
    }
    return candidates[0] ?? null;
  }

  /**
   * One projection read, then a per-subject look at the next move WITHOUT
   * ensuring a session: a sessionless entry is judged against a synthetic
   * `created` state, the way `ResolveAccessCode` judges a card before a
   * button is pressed. Only paper vs not-paper is decided here; the real
   * resolution is `ResolveSubjectNext`'s.
   */
  async #lookahead(learnerId) {
    const { sections, activeExceptions, projection } = await this.#projection.project({
      learnerId,
      planErrorEvent: 'school.subject-next.plan-errors',
      launcherFailedEvent: 'school.subject-next.launcher-failed',
    });
    const unitsById = new Map((projection?.units ?? []).map((u) => [u.unitId, u]));
    const nowIso = projection?.nowIso ?? this.#clock().toISOString();
    const cache = new Map();
    const peek = (subject) => {
      const section = (sections ?? []).find((s) => s.subject === subject);
      const entry = section && !section.servedToday ? section.next ?? null : null;
      if (!entry) return { unit: null, printable: false };
      const unit = unitsById.get(entry.unitId) ?? null;
      const view = unitView(unit ?? entry, subject);
      if (entry.program || pausedExceptionFor(activeExceptions, entry.unitId)) {
        return { unit: view, printable: false };
      }
      const printable = this.#readState({ entry, learnerId, nowIso }).then((state) => {
        const resolution = {
          kind: 'move', move: nextMove(unit ?? {}, state, remediationOptionsFor(entry)), state, unit, entry,
        };
        return offeredCard(resolution, { ...this.#bankOptions(unit), now: this.#clock() })
          .actions.some((a) => a.kind === 'print');
      }).catch((error) => {
        this.#logger.warn?.('school.subject-next.lookahead-failed', {
          learnerId, subject, error: error?.message ?? String(error),
        });
        return false;
      });
      return { unit: view, printable };
    };
    return (subject) => {
      if (!cache.has(subject)) cache.set(subject, peek(subject));
      return cache.get(subject);
    };
  }

  async #readState({ entry, learnerId, nowIso }) {
    if (entry.sessionId) return reduceSession(await this.#sessions.readEvents(entry.sessionId));
    const { errors, event } = createEvent({
      type: 'created', at: nowIso, sessionId: SYNTHETIC_SESSION_ID, learnerId, unitId: entry.unitId,
    });
    if (errors.length) throw new Error(`IssueSubjectNext: could not model a fresh session: ${errors.join('; ')}`);
    return reduceSession([{ ...event, seq: 1 }]);
  }

  /** `ResolveAccessCode#bankOptions`'s rule: is this bank paper today? */
  #bankOptions(unit) {
    if (!unit?.bank) return { bankPrintable: false };
    const bankIssue = !unit.document ? this.#issue?.getBankIssue?.(unit.bank) ?? null : null;
    if (bankIssue) return { bankPrintable: false, bankIssue };
    if (typeof this.#issue?.canIssueBank !== 'function') return { bankPrintable: false };
    try {
      return { bankPrintable: this.#issue.canIssueBank(unit.bank) === true };
    } catch (error) {
      this.#logger.warn?.('school.subject-next.bank-printable-failed', {
        bank: unit.bank, error: error?.message ?? String(error),
      });
      return { bankPrintable: false };
    }
  }

  async #reward({ learnerId, unit }) {
    if (!this.#rewardFor) return null;
    try {
      const reward = await this.#rewardFor({ learnerId, unit });
      return reward && typeof reward === 'object' ? reward : null;
    } catch (error) {
      this.#logger.warn?.('school.subject-next.reward-failed', {
        learnerId, unitId: unit?.unitId ?? null, error: error?.message ?? String(error),
      });
      return null;
    }
  }

  #assertLearner(learnerId) {
    if (typeof learnerId !== 'string' || !ID_RE.test(learnerId)) {
      throw new ValidationError('a learner id is required', { field: 'learnerId' });
    }
    if (this.#roster) {
      const known = (this.#roster() ?? []).some((person) => person?.id === learnerId);
      if (!known) throw new EntityNotFoundError('learner', learnerId);
    }
  }

  #subjectArg(subject) {
    if (subject === null || subject === undefined || subject === '') return null;
    if (typeof subject !== 'string' || !ID_RE.test(subject)) {
      throw new ValidationError('malformed subject', { field: 'subject' });
    }
    return subject;
  }

  /** Drop the stamp — but only our own, never a newer tap's. */
  #release(learnerId, stampedAt) {
    if (this.#taps.get(learnerId) === stampedAt) this.#taps.delete(learnerId);
  }

  #log(answer, { learnerId, deviceId }) {
    const event = answer.outcome === 'done' ? 'printed'
      : (answer.outcome === 'debounced' ? 'debounced' : 'refused');
    const level = answer.outcome === 'failed' ? 'warn' : 'info';
    this.#logger[level]?.(`school.subject-next.${event}`, {
      learnerId,
      subject: answer.subject ?? null,
      unitId: answer.unit?.unitId ?? null,
      status: answer.status,
      deviceId,
    });
  }
}

export default IssueSubjectNext;
