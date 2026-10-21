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
 *   1. Validate: the learner is on the roster, and a named subject is one of
 *      that learner's sections today (`GetLearnerDayCompletion`). A foreign
 *      subject is always a 400, never "it's already on its way".
 *   2. Look before writing. `ResolveSubjectNext.peek` resolves without opening
 *      a session. With no subject named, the candidates are obligated sections
 *      first, then electives (excused, not yet served), in plan order; the
 *      first whose card offers PAPER wins, so a program or a video at the top
 *      does not swallow the button. When nothing is paper, the answer comes
 *      straight from the peek — the card's sentence, or its button label as
 *      one ("Open Math Facts.") — and no session is opened.
 *   3. Paper: `ResolveSubjectNext.execute` ensures the session, and the sheet
 *      goes out through `printSessionSheet` (the keypad's `print` step), or,
 *      for a failed attempt's paper `retry`, `printFreshSheet` (the keypad's
 *      retry step: open the remediation, print the fresh session).
 *
 * THE DEBOUNCE IS PER LEARNER AND SUBJECT (`learnerId:subject`), so Math then
 * Reading a moment apart both print, while the strip and the kiosk tapped for
 * the same sheet print once. Two parts:
 *
 *   - IN FLIGHT. The print promise is kept per key. A tap that lands while it
 *     is running awaits it: if it put a sheet in the tray the tap is answered
 *     "It's already on its way", otherwise with that same failure. A
 *     debounced tap never claims a sheet that is not coming.
 *   - AFTER. A print that went out stamps the key; a tap within 20 s of it is
 *     debounced. Elapsed time below zero (a clock stepped backwards) counts as
 *     expired rather than holding the key indefinitely.
 *
 * Both live in process memory only: a restart forgets them. `IssueDocument`'s
 * per-session `printCooldownMinutes` is the durable backstop.
 *
 * `preview` is the dry run behind `GET /next`: which subject and unit the
 * button would print, read through the same peek, plus an optional reward
 * label from an injected port.
 */
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { offeredCard } from "../../domain/selfService/offeredActions.mjs";
import { SYNTHETIC_SESSION_ID } from "./ResolveAccessCode.mjs";
import {
  PRINT_RESULTS, TELL_A_GROWN_UP, printSessionSheet, printFreshSheet,
} from "./printSessionSheet.mjs";

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;
const DEVICE_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,80}$/;
export const DEFAULT_DEBOUNCE_MS = 20_000;

const ON_ITS_WAY = PRINT_RESULTS.debounced.sentence;
/** The bulk card's own words for "nothing left today" (`ResolveAccessCode#bulkAllDone`). */
const ALL_DONE = "You're all done for today!";

/**
 * `PRINT_RESULTS` rows reworded for a surface with no code. The keypad's
 * "Type your code again" is an instruction the Portal and the kiosk cannot
 * follow.
 */
const SENTENCES = Object.freeze({
  already_done: 'That one is finished. Tap again to see what is next.',
});

/**
 * Event names. The first four are the shared print helper's (`failed` there
 * means "a use case threw"); the rest are this file's own, including the one
 * line logged per tap.
 */
const EVENTS = Object.freeze({
  failed: 'school.subject-next.threw',
  unwired: 'school.subject-next.unwired',
  unknownStatus: 'school.subject-next.unknown-status',
  useCaseFailed: 'school.subject-next.use-case-failed',
  noSession: 'school.subject-next.no-session',
  printed: 'school.subject-next.printed',
  debounced: 'school.subject-next.debounced',
  refused: 'school.subject-next.refused',
  outcomeFailed: 'school.subject-next.failed',
});

const capitalise = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/**
 * Work whose next step is not paper answers with the card's own button label
 * as a sentence ("Open Math Facts.", "Play the video."), capitalised the way
 * `offeredActions`'s `waitingSentence` capitalises a move's label.
 */
const labelSentence = (work) => {
  const label = typeof work?.label === 'string' ? capitalise(work.label.trim()) : '';
  if (!label) return TELL_A_GROWN_UP;
  return /[.!?]$/.test(label) ? label : `${label}.`;
};

/**
 * Does this card action put paper in the tray? A plain `print`, or a `retry`
 * whose fresh session's first step is a print ("Print a fresh sheet").
 */
const isPaper = (work) => work?.kind === 'print' || (work?.kind === 'retry' && work.operation === 'print');

/**
 * The unit as surfaces see it. `elective: true` only when known: the
 * completion view reads the unit's section as `excused` today (an elective),
 * so the reward port does not price it as required work.
 */
const unitView = (unit, fallbackSubject, { elective = false } = {}) => (unit ? {
  unitId: unit.unitId ?? null,
  title: unit.title ?? null,
  subject: unit.subject ?? fallbackSubject ?? null,
  ...(elective ? { elective: true } : {}),
} : null);

export class IssueSubjectNext {
  #resolver; #completion; #issue; #remediation; #roster; #rewardFor;
  #debounceMs; #clock; #logger;
  /** `learnerId:subject` -> epoch ms a sheet last went out. */
  #stamps = new Map();
  /** `learnerId:subject` -> the print running now. */
  #inflight = new Map();

  /**
   * @param {object} deps
   * @param {import('./ResolveSubjectNext.mjs').ResolveSubjectNext} deps.resolveSubjectNext
   *   `peek` to look, `execute` to open the session for a print
   * @param {import('../GetLearnerDayCompletion.mjs').GetLearnerDayCompletion} deps.getLearnerDayCompletion
   * @param {import('./IssueDocument.mjs').IssueDocument} [deps.issueDocument]
   * @param {import('./OpenRemediation.mjs').OpenRemediation} [deps.openRemediation]
   *   opens the fresh session behind a failed attempt's "Print a fresh sheet"
   * @param {(() => Array<{id: string}>)|null} [deps.roster] - who may be named
   * @param {((args: {learnerId: string, unit: object}) => Promise<object|null>)|null} [deps.rewardFor]
   *   optional label source for `preview`; null, absent or throwing all mean
   *   "no reward shown"
   * @param {number} [deps.debounceMs]
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({
    resolveSubjectNext, getLearnerDayCompletion,
    issueDocument = null, openRemediation = null, roster = null, rewardFor = null,
    debounceMs = DEFAULT_DEBOUNCE_MS, clock = () => new Date(), logger = console,
  } = {}) {
    if (typeof resolveSubjectNext?.peek !== 'function' || typeof resolveSubjectNext?.execute !== 'function'
      || !getLearnerDayCompletion) {
      throw new Error('IssueSubjectNext requires resolveSubjectNext (peek + execute) and getLearnerDayCompletion');
    }
    this.#resolver = resolveSubjectNext;
    this.#completion = getLearnerDayCompletion;
    this.#issue = issueDocument;
    this.#remediation = openRemediation;
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
    const sections = await this.#sections(learnerId, wanted);

    let answer;
    try {
      answer = await this.#tap({ learnerId, wanted, sections });
    } catch (error) {
      this.#logger.error?.(EVENTS.failed, {
        stage: 'run', learnerId, subject: wanted, error: error?.message ?? String(error),
      });
      answer = {
        status: 'error', outcome: 'failed', sentence: TELL_A_GROWN_UP,
        subject: wanted, unit: null, sessionId: null,
      };
    }
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
    // The SAME choice `execute` makes, so the label names what will print.
    const look = wanted ? await this.#look(learnerId, wanted) : await this.#choose(learnerId, sections);
    // An elective today (the same `excused` tier `#candidates` reads) says so.
    const elective = sections.find((s) => s.subject === look?.subject)?.state === 'excused';
    const unit = look?.unit ? unitView(look.unit, look.subject, { elective }) : null;
    return {
      subject: look?.subject ?? null,
      unit,
      printable: look?.paper === true,
      reward: unit ? await this.#reward({ learnerId, unit }) : null,
    };
  }

  async #tap({ learnerId, wanted, sections }) {
    const look = wanted ? await this.#look(learnerId, wanted) : await this.#choose(learnerId, sections);
    if (!look) {
      const allServed = sections.length > 0 && sections.every((s) => s.state === 'served');
      return {
        status: allServed ? 'served' : 'empty',
        outcome: 'refused',
        sentence: allServed ? ALL_DONE : TELL_A_GROWN_UP,
        subject: null, unit: null, sessionId: null,
      };
    }
    // Not paper: answered from the peek. No session is opened for a tap that
    // will not print.
    if (!look.paper) return this.#fromCard(look);

    const key = `${learnerId}:${look.subject}`;
    // From here to `#inflight.set` there is no await: two taps cannot both
    // find the key empty.
    const running = this.#inflight.get(key);
    if (running) {
      const first = await running;
      return first.outcome === 'done' ? this.#debounced(look) : { ...first };
    }
    const now = this.#clock().getTime();
    const stamped = this.#stamps.get(key);
    if (stamped !== undefined) {
      const elapsed = now - stamped;
      if (elapsed >= 0 && elapsed < this.#debounceMs) return this.#debounced(look);
      this.#stamps.delete(key);
    }

    const pending = this.#print({ learnerId, subject: look.subject, fallback: look })
      .catch((error) => {
        this.#logger.error?.(EVENTS.failed, {
          stage: 'print', learnerId, subject: look.subject, error: error?.message ?? String(error),
        });
        return {
          status: 'error', outcome: 'failed', sentence: TELL_A_GROWN_UP,
          subject: look.subject, unit: look.unit, sessionId: null,
        };
      });
    this.#inflight.set(key, pending);
    try {
      const answer = await pending;
      if (answer.outcome === 'done') this.#stamps.set(key, this.#clock().getTime());
      return answer;
    } finally {
      this.#inflight.delete(key);
    }
  }

  /** Open the session and print. Only reached when the peek said paper. */
  async #print({ learnerId, subject, fallback }) {
    const resolution = await this.#resolver.execute({ learnerId, subject });
    const look = this.#judge(resolution, subject);
    // The state moved between the peek and now (a sibling's scan, a grade
    // landing): answer from what is true now rather than print stale work.
    if (!look.paper) return this.#fromCard(look);

    const { sessionId } = resolution;
    if (typeof sessionId !== 'string' || !sessionId || sessionId === SYNTHETIC_SESSION_ID) {
      this.#logger.error?.(EVENTS.noSession, { learnerId, subject, sessionId: sessionId ?? null });
      return {
        status: 'error', outcome: 'failed', sentence: TELL_A_GROWN_UP,
        subject, unit: look.unit ?? fallback.unit, sessionId: null,
      };
    }

    const retry = look.work.kind === 'retry';
    // A failed attempt prints a FRESH sheet on a new session, through the
    // same open-then-print step the keypad's retry button takes.
    const printed = retry
      ? await printFreshSheet({
        openRemediation: this.#remediation, issueDocument: this.#issue, sessionId,
        logger: this.#logger, events: EVENTS, sentences: SENTENCES,
      })
      : await printSessionSheet({
        issueDocument: this.#issue, sessionId, logger: this.#logger, events: EVENTS, sentences: SENTENCES,
      });
    // A retry names a session only when a fresh one was actually opened
    // (`retryAnswer` stamps `remediationOf`); an unwired, throwing or refused
    // remediation opened nothing.
    const openedFresh = retry ? printed.effect?.remediationOf === sessionId : true;
    return {
      status: printed.effect?.status ?? 'error',
      outcome: printed.outcome,
      sentence: printed.sentence,
      subject,
      unit: look.unit,
      sessionId: openedFresh ? (printed.sessionId ?? null) : null,
    };
  }

  /** One subject, peeked and judged. */
  async #look(learnerId, subject) {
    return this.#judge(await this.#resolver.peek({ learnerId, subject }), subject);
  }

  /** A resolution -> its card, its one work action, and whether that is paper. */
  #judge(resolution, subject) {
    const card = offeredCard(resolution, {
      ...this.#bankOptions(resolution?.unit), now: this.#clock(),
    });
    const work = card.actions.find((a) => a.kind !== 'exit') ?? null;
    return {
      subject,
      resolution,
      card,
      work,
      paper: resolution?.kind === 'move' && isPaper(work),
      unit: unitView(resolution?.unit ?? resolution?.entry ?? null, subject),
    };
  }

  #fromCard(look) {
    const kind = look.resolution?.kind ?? 'empty';
    return {
      status: kind === 'move' ? 'no_sheet' : kind,
      outcome: 'refused',
      sentence: look.card.sentence ?? labelSentence(look.work),
      subject: look.subject,
      unit: look.unit,
      sessionId: null,
    };
  }

  #debounced(look) {
    return {
      status: 'debounced', outcome: 'debounced', sentence: ON_ITS_WAY,
      subject: look.subject, unit: look.unit, sessionId: null,
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

  /**
   * Obligated first, then electives; plan order inside each tier.
   *
   * The tiers come from the completion view, which is narrower than the
   * projection `ResolveSubjectNext` resolves against (no attested passes, no
   * curriculum exceptions). At the edges the two can disagree: a section the
   * verdict calls obligated may resolve as served or locked once an
   * attestation or a pause is applied. That is safe because the resolver has
   * the last word: a candidate that is not paper there is passed over, and
   * nothing prints from the completion view alone.
   */
  #candidates(sections) {
    return [
      ...sections.filter((s) => s.state === 'obligated'),
      ...sections.filter((s) => s.state === 'excused'),
    ].map((s) => s.subject);
  }

  /** The first candidate that is paper; else the first candidate; else null. */
  async #choose(learnerId, sections) {
    let first = null;
    for (const subject of this.#candidates(sections)) {
      let look;
      try {
        // eslint-disable-next-line no-await-in-loop
        look = await this.#look(learnerId, subject);
      } catch (error) {
        this.#logger.warn?.('school.subject-next.lookahead-failed', {
          learnerId, subject, error: error?.message ?? String(error),
        });
        continue;
      }
      if (look.paper) return look;
      first ??= look;
    }
    return first;
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

  /** One line per tap: printed | debounced | failed (warn) | refused. */
  #log(answer, { learnerId, deviceId }) {
    const { event, level } = {
      done: { event: EVENTS.printed, level: 'info' },
      debounced: { event: EVENTS.debounced, level: 'info' },
      failed: { event: EVENTS.outcomeFailed, level: 'warn' },
    }[answer.outcome] ?? { event: EVENTS.refused, level: 'info' };
    this.#logger[level]?.(event, {
      learnerId,
      subject: answer.subject ?? null,
      unitId: answer.unit?.unitId ?? null,
      status: answer.status,
      deviceId,
    });
  }
}

export default IssueSubjectNext;
