/**
 * The parents' evening read of the school day (school economy slice 1, C6).
 *
 * `run({studyDay})` sends two kinds of push to every teacher:
 *
 * - **digest**, one per study day covering every learner: served of asked
 *   (excused sections are not asked), silver earned, passes used and the
 *   day's most actionable failure (a print over a sheet over a code, the
 *   earliest within that rank). Copy from `composeSchoolPush({kind: 'digest'})`.
 * - **zero-days**, one per learner, when the last `zeroDaysAlert()` study days
 *   (today included) each asked for work and none was done.
 *
 * The previous study day is the previous day that ASKED for something. Days
 * with nothing asked (weekends, the household calendar, a day off for that
 * learner) are skipped, not counted as zeros and not as a break in the run.
 * The walk measures the whole run, so the copy can say third, fourth: it
 * stops at a day with work done, at a day that cannot be judged (`unknown`,
 * or a read that throws), or after LOOKBACK_DAYS calendar days. A stop at an
 * unknown day still fires on the days already counted, when they reach the
 * threshold; the unknown day itself is never counted as empty. Earlier days
 * are read through `termVerdicts.dayRow` (the verdict cache; only today and
 * yesterday are replayed), so the walk costs a cache read per day.
 *
 * Silver comes from the economy ledger only (`economyToday`). When the
 * catalog mode is not `live`, nothing was minted, so the composer shows no
 * silver figure (`dry-run` adds "Coins not live yet").
 *
 * Failures come from the school ledger (`SchoolLedgerTransport`'s JSONL),
 * read through the injected `ledger.readDay(day)`. A failure belongs to a
 * learner when its `data.learnerId` names them or its `data.sessionId` is one
 * of their sessions; an event naming neither is nobody's. A
 * `code.rejected` names the learner only when the code was known (used up,
 * expired); a code nobody issued has no owner and is never attributed. A
 * used-up code is left out entirely: retyping one is normal.
 *
 * `timezone` and `boundaryHour` are the household study calendar's, the
 * same pair the economy port uses, so the digest's day, its ledger window
 * and the economy's silver window are one window.
 *
 * Delivery follows `cardLadderTuning.mjs`: each teacher through
 * `notifications.send({category: 'school', ...})`, with a per-day
 * `dedupeKey`. A send held for quiet hours is
 * held in memory and resent by `retryHeld()` until it is delivered or the
 * next `run` replaces it; a push resent after its day names that day. A
 * delivered send is remembered for the process, so
 * a second run on the same day sends nothing again. Held and sent state is
 * not persisted: a restart forgets a held push.
 */
import { dayVerdict, addDays } from "../domain/termVerdict.mjs";
import { studyDayWindowForDate } from "../domain/studyDay.mjs";
import { composeSchoolPush } from "../domain/notifications/schoolPush.mjs";

export const LOOKBACK_DAYS = 14;

// Most actionable first: a grown-up can fix a printer; a code is the child's.
const FAILURE_RANK = { print_failed: 0, issue_failed: 1, old_code: 2, code_rejected: 2 };

/** A school ledger event as a digest failure code, or null. */
export function failureOf(entry) {
  const name = entry?.event;
  const data = entry?.data ?? {};
  if (name === 'school.issue.failed') return data.stage === 'print' ? 'print_failed' : 'issue_failed';
  if (name === 'school.selfservice.action.failed' && data.stage === 'print') return 'print_failed';
  if (name === 'school.card.print-failed') return 'print_failed';
  if (name === 'school.selfservice.code.rejected') {
    if (data.reason === 'used_up') return null;
    return data.reason === 'expired' ? 'old_code' : 'code_rejected';
  }
  if (typeof name === 'string' && name.startsWith('school.') && data.status === 'print_failed') return 'print_failed';
  return null;
}

const errorText = (error) => error?.message ?? String(error);

export class SchoolParentDigest {
  #roster; #learnerName; #completion; #termVerdicts; #economyToday; #coinsMode; #zeroDaysAlert;
  #ledger; #learnerSessionIds; #notifications; #teachers; #today; #timezone; #boundaryHour; #logger;
  #sent = new Set();
  #held = new Map();

  constructor({
    roster, learnerName = () => null, getLearnerDayCompletion, termVerdicts = null,
    economyToday = null, coinsMode = () => 'off', zeroDaysAlert = () => null,
    ledger = null, learnerSessionIds = null, notifications, teachers = () => [],
    today, timezone = null, boundaryHour = 4, logger = console,
  } = {}) {
    if (!roster || !getLearnerDayCompletion?.execute || !notifications?.send || typeof today !== 'function') {
      throw new Error('SchoolParentDigest requires roster, getLearnerDayCompletion, notifications and today');
    }
    this.#roster = roster;
    this.#learnerName = learnerName;
    this.#completion = getLearnerDayCompletion;
    this.#termVerdicts = termVerdicts;
    this.#economyToday = economyToday;
    this.#coinsMode = coinsMode;
    this.#zeroDaysAlert = zeroDaysAlert;
    this.#ledger = ledger;
    this.#learnerSessionIds = learnerSessionIds;
    this.#notifications = notifications;
    this.#teachers = teachers;
    this.#today = today;
    this.#timezone = timezone;
    this.#boundaryHour = boundaryHour;
    this.#logger = logger;
  }

  /**
   * @param {{studyDay?: string}} [args] - defaults to today's study day
   * @returns {Promise<{studyDay: string, digest: 'sent'|'suppressed'|'failed'|'skipped', zeroDays: string[]}>}
   */
  async run({ studyDay = null } = {}) {
    const today = this.#today();
    const day = studyDay ?? today;
    this.#dropHeldBefore(day);
    const teachers = (await this.#teachers()) ?? [];
    const learners = ((await this.#roster()) ?? []).map((l) => l?.id ?? l?.learnerId).filter(Boolean);
    if (!learners.length || !teachers.length) {
      this.#logger.info?.('school.parent-digest.skipped', { studyDay: day, reason: learners.length ? 'no-teachers' : 'no-learners' });
      return { studyDay: day, digest: 'skipped', zeroDays: [] };
    }

    const coins = this.#readCoinsMode();
    const failures = await this.#failuresOn(day);
    const rows = [];
    const zeroDays = [];
    for (const learnerId of learners) {
      // eslint-disable-next-line no-await-in-loop
      const { row, verdict } = await this.#learnerRow(learnerId, day, today, failures);
      rows.push(row);
      // eslint-disable-next-line no-await-in-loop
      if (await this.#alertIfEmptyRun(learnerId, row.child, verdict, day, today, teachers)) zeroDays.push(learnerId);
    }

    const event = { kind: 'digest', studyDay: day, today, coins, learners: rows };
    const push = composeSchoolPush(event);
    const { status, error } = push
      ? await this.#deliver(push, { event, teachers, dedupeKey: `digest:${day}`, urgency: 'normal', studyDay: day, kind: 'digest' })
      : { status: 'skipped', error: null };
    if (status === 'sent') this.#logger.info?.('school.parent-digest.sent', { studyDay: day, learners: rows.length, teachers: teachers.length, coins });
    else if (status === 'skipped') this.#logger.info?.('school.parent-digest.skipped', { studyDay: day, reason: push ? 'already-sent' : 'nothing-to-say' });
    else if (status === 'suppressed') this.#logger.info?.('school.parent-digest.skipped', { studyDay: day, reason: 'suppressed', held: true });
    else if (status === 'failed') this.#logger.warn?.('school.parent-digest.failed', { studyDay: day, reason: 'not delivered', ...(error ? { error } : {}) });
    return { studyDay: day, digest: status, zeroDays };
  }

  /** Resend every held push. @returns {Promise<{sent: number, held: number}>} */
  async retryHeld() {
    let sent = 0;
    const today = this.#today();
    for (const [key, held] of [...this.#held]) {
      let results;
      try {
        // eslint-disable-next-line no-await-in-loop
        results = await this.#notifications.send(this.#current(held, today));
      } catch (error) {
        results = [{ delivered: false, error: errorText(error) }];
      }
      const status = statusOf(results);
      if (status === 'suppressed') continue;
      this.#held.delete(key);
      if (status === 'cooldown') {
        this.#sent.add(key);
        this.#logger.info?.('school.parent-digest.skipped', { studyDay: held.studyDay, kind: held.kind, reason: 'already-sent', retried: true });
      } else if (status === 'sent') {
        this.#sent.add(key);
        sent += 1;
        this.#logger.info?.(held.kind === 'digest' ? 'school.parent-digest.sent' : 'school.zero-days.sent',
          { studyDay: held.studyDay, ...(held.learnerId ? { learnerId: held.learnerId } : {}), retried: true });
      } else {
        this.#logger.warn?.('school.parent-digest.failed', { studyDay: held.studyDay, kind: held.kind, reason: 'not delivered on retry' });
      }
    }
    return { sent, held: this.#held.size };
  }

  #readCoinsMode() {
    try { return this.#coinsMode() ?? 'off'; } catch (error) {
      this.#logger.warn?.('school.parent-digest.coins-mode-failed', { error: errorText(error) });
      return 'off';
    }
  }

  async #learnerRow(learnerId, day, today, failures) {
    let child = null;
    try { child = (await this.#learnerName(learnerId)) || null; } catch (error) {
      this.#logger.warn?.('school.parent-digest.name-failed', { learnerId, error: errorText(error) });
    }
    let verdict = null;
    try {
      const completion = await this.#completion.execute({ learnerId, ...(day === today ? {} : { studyDay: day }) });
      verdict = dayVerdict({ studyDay: day, today, completion, sections: completion?.sections ?? [] });
    } catch (error) {
      this.#logger.warn?.('school.parent-digest.learner-failed', { learnerId, studyDay: day, error: errorText(error) });
    }
    let economy = null;
    if (this.#economyToday) {
      try { economy = await this.#economyToday(learnerId, day); } catch (error) {
        this.#logger.warn?.('school.parent-digest.economy-failed', { learnerId, studyDay: day, error: errorText(error) });
      }
    }
    const row = {
      learnerId, child,
      judged: Boolean(verdict) && verdict.state !== 'unknown',
      served: verdict?.served ?? 0, asked: verdict?.asked ?? 0,
      silverEarned: economy?.silverEarned ?? null, passesUsed: economy?.passesUsed ?? null,
      failure: await this.#firstFailureFor(learnerId, failures),
    };
    return { row, verdict };
  }

  /** The study day's failure events, most actionable first, then oldest first. Files are named by process-local day, so read the neighbours too. */
  async #failuresOn(day) {
    if (!this.#ledger?.readDay) return [];
    const window = studyDayWindowForDate(day, { timezone: this.#timezone, boundaryHour: this.#boundaryHour });
    if (!window) return [];
    const events = [];
    for (const fileDay of [addDays(day, -1), day, addDays(day, 1)]) {
      try {
        // eslint-disable-next-line no-await-in-loop
        events.push(...((await this.#ledger.readDay(fileDay)) ?? []));
      } catch (error) {
        this.#logger.warn?.('school.parent-digest.ledger-failed', { day: fileDay, error: errorText(error) });
      }
    }
    return events
      .map((entry) => ({ entry, code: failureOf(entry), ms: Date.parse(entry?.ts ?? '') }))
      .filter(({ code, ms }) => code && Number.isFinite(ms) && ms >= window.startAtMs && ms < window.endAtMs)
      .sort((a, b) => (FAILURE_RANK[a.code] - FAILURE_RANK[b.code]) || (a.ms - b.ms));
  }

  async #firstFailureFor(learnerId, failures) {
    if (!failures.length) return null;
    let sessions = null;
    for (const { entry, code } of failures) {
      const data = entry.data ?? {};
      if (data.learnerId === learnerId) return code;
      if (data.learnerId || !data.sessionId || !this.#learnerSessionIds) continue;
      if (!sessions) {
        try { sessions = new Set(await this.#learnerSessionIds(learnerId)); } catch { sessions = new Set(); }
      }
      if (sessions.has(data.sessionId)) return code;
    }
    return null;
  }

  /**
   * The run of empty asking days ending today, measured to its start (a day
   * with work done), an unknown day, or LOOKBACK_DAYS, so the copy can say
   * third, fourth. Fires only when the run reaches the threshold.
   */
  async #alertIfEmptyRun(learnerId, child, verdict, day, today, teachers) {
    let threshold = null;
    try { threshold = this.#zeroDaysAlert(); } catch { threshold = null; }
    const readDay = this.#termVerdicts?.dayRow
      ? (id, d) => this.#termVerdicts.dayRow(id, d, today)
      : this.#termVerdicts?.computeDay ? (id, d) => this.#termVerdicts.computeDay(id, d, today) : null;
    if (!Number.isInteger(threshold) || threshold < 2 || !readDay) return false;
    if (verdict?.state !== 'none') return false;
    let empty = 1;
    for (let back = 1; back <= LOOKBACK_DAYS; back += 1) {
      const earlier = addDays(day, -back);
      let prior;
      try {
        // eslint-disable-next-line no-await-in-loop
        prior = await readDay(learnerId, earlier);
      } catch (error) {
        this.#logger.warn?.('school.parent-digest.verdict-failed', { learnerId, studyDay: earlier, error: errorText(error) });
        break;
      }
      if (prior?.state === 'unknown') break;
      if (!(prior?.asked > 0)) continue;
      if (prior.state !== 'none') break;
      empty += 1;
    }
    if (empty < threshold) return false;
    const event = { kind: 'zero-days', learnerId, child, days: empty, studyDay: day, today };
    const push = composeSchoolPush(event);
    const { status, error } = await this.#deliver(push, {
      event, teachers, dedupeKey: `zero:${learnerId}:${day}`, urgency: 'high', studyDay: day, kind: 'zero-days', learnerId,
    });
    if (status === 'sent') this.#logger.info?.('school.zero-days.sent', { learnerId, studyDay: day, days: empty, threshold });
    else if (status === 'skipped') this.#logger.info?.('school.parent-digest.skipped', { learnerId, studyDay: day, kind: 'zero-days', reason: 'already-sent' });
    else if (status === 'suppressed') this.#logger.info?.('school.parent-digest.skipped', { learnerId, studyDay: day, kind: 'zero-days', reason: 'suppressed', held: true });
    else if (status === 'failed') this.#logger.warn?.('school.parent-digest.failed', { learnerId, studyDay: day, kind: 'zero-days', ...(error ? { error } : {}) });
    return status === 'sent' || status === 'suppressed';
  }

  /**
   * The cardLadderTuning send: each teacher, one intent each. Sent when any
   * copy was delivered; suppressed when quiet hours held one (held per
   * teacher for `retryHeld`); failed otherwise. A `cooldown` suppression
   * means this key already reached that teacher, so it counts as sent and is
   * never retried (a retry after the cooldown lapses would deliver it twice).
   * Already-sent teachers are skipped; all of them skipped is `skipped`.
   */
  async #deliver(push, { event, teachers, dedupeKey, urgency, studyDay, kind, learnerId = null }) {
    const statuses = [];
    let error = null;
    for (const username of teachers) {
      const key = `${username}|${dedupeKey}`;
      if (this.#sent.has(key) || this.#held.has(key)) { statuses.push('already'); continue; }
      const held = { event, username, dedupeKey, urgency, studyDay, kind, learnerId };
      let results;
      try {
        // eslint-disable-next-line no-await-in-loop
        results = await this.#notifications.send(intentFor(push, held));
      } catch (thrown) {
        // Logged once, by the caller, with the run's outcome.
        error = errorText(thrown);
        results = [];
      }
      const status = statusOf(results);
      if (status === 'sent' || status === 'cooldown') this.#sent.add(key);
      if (status === 'suppressed') this.#held.set(key, held);
      statuses.push(status === 'cooldown' ? 'already' : status);
    }
    if (statuses.includes('sent')) return { status: 'sent', error };
    if (statuses.includes('suppressed')) return { status: 'suppressed', error };
    if (statuses.every((s) => s === 'already')) return { status: 'skipped', error };
    return { status: 'failed', error };
  }

  /** A held push as it should read now: recomposed with today, so one resent after its day names that day. */
  #current(held, today) {
    return intentFor(composeSchoolPush({ ...held.event, today }), held);
  }

  #dropHeldBefore(day) {
    for (const [key, held] of [...this.#held]) {
      if (held.studyDay >= day) continue;
      this.#held.delete(key);
      this.#logger.info?.('school.parent-digest.dropped', { studyDay: held.studyDay, kind: held.kind, reason: 'held-until-next-run' });
    }
  }
}

function intentFor(push, { username, dedupeKey, urgency }) {
  return {
    title: push.title,
    body: push.message,
    category: 'school',
    urgency,
    actions: [{ label: 'Open the console', action: 'open', data: { url: '/school/teacher' } }],
    metadata: { username, pushData: push.data },
    dedupeKey,
  };
}

/** sent | suppressed (quiet hours: hold and retry) | cooldown (already sent) | failed. */
function statusOf(results) {
  const rows = Array.isArray(results) ? results : [];
  if (rows.some((row) => row?.delivered)) return 'sent';
  if (rows.some((row) => row?.suppressed && row.reason === 'quiet_hours')) return 'suppressed';
  if (rows.some((row) => row?.suppressed && row.reason === 'cooldown')) return 'cooldown';
  return 'failed';
}

export default SchoolParentDigest;
