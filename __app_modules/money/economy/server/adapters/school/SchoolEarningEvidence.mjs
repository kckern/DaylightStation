/**
 * School's side of the economy's earning-evidence port
 * (`#apps/economy/ports/IEarningEvidenceSource.mjs` — ISchoolEarningEvidence).
 *
 * One learner's school week as facts, in the term grid's own vocabulary:
 *   days         each study day's verdict (met | partial | none | exempt | unknown),
 *                with `greenWeek`: whether the day counts toward Green Week
 *                (a weekday the household calendar does not excuse)
 *   sectionDays  each day's per-subject state (served | obligated | excused | faulted)
 *   week         the week row (Monday id), with `open` while the week is under way
 *                and `excusedDays`: the week's weekdays a day-off tier excuses,
 *                future ones included; `weekendSubjects`: the subjects the
 *                learner's latest weekend asked for (weekend scripture)
 *   units        the week's graded work sessions, with subject/course from the curriculum
 *
 * Reads only the application services School already has (term verdicts, the
 * learner session list, the curriculum), never files. Every fact is stamped
 * `timeliness: 'on-time'`: makeup (taxonomy D14) is not built, and the field
 * keeps future payout refs stable when it is.
 */
import { ISchoolEarningEvidence } from "../../application/ports/IEarningEvidenceSource.mjs";
import { dayOffTier, EXCUSING_TIERS, isoWeekday } from "../../../../../learning/school/server/study-calendar.mjs";

const ON_TIME = 'on-time';

export class SchoolEarningEvidence extends ISchoolEarningEvidence {
  #termVerdicts;
  #sessions;
  #unitInfo;
  #debriefs;
  #logger;
  #householdSchedule;

  /**
   * @param {object} deps
   * @param {{read: (learnerId: string, opts: object) => Promise<object>}} deps.termVerdicts - TermVerdictService
   * @param {{execute: (args: {learnerId: string}) => Promise<object[]>}} deps.sessions - ListLearnerSessions
   * @param {{week: (args: {learnerId: string, week: {from, to}}) => Promise<object[]|null>}} [deps.debriefs] - after-school debrief facts (null = not enrolled)
   * @param {(unitId: string) => Promise<{subject?: string, courseId?: string}|null>} [deps.unitInfo]
   */
  constructor({ termVerdicts, sessions, unitInfo = null, debriefs = null, householdSchedule = null, logger = console }) {
    super();
    if (!termVerdicts?.read) throw new Error('SchoolEarningEvidence requires termVerdicts');
    if (!sessions?.execute) throw new Error('SchoolEarningEvidence requires sessions');
    this.#termVerdicts = termVerdicts;
    this.#sessions = sessions;
    this.#unitInfo = unitInfo;
    this.#debriefs = debriefs;
    this.#logger = logger;
    this.#householdSchedule = householdSchedule;
  }

  /** A weekday no day-off tier excuses: a Green Week day. */
  #greenWeekDay(day) {
    if (isoWeekday(day) > 5) return false;
    const off = this.#householdSchedule ? dayOffTier(day, this.#householdSchedule) : null;
    return !(off && EXCUSING_TIERS.includes(off.tier));
  }

  async schoolWeek({ learnerId, week }) {
    const inWeek = (day) => typeof day === 'string' && day >= week.from && day <= week.to;
    const term = await this.#termVerdicts.read(learnerId, { detail: true });
    // The grid reads only the term containing today. A week outside it has no
    // verdicts at all — say so, rather than hand back an empty week that the
    // economy would read as "not on the plan".
    const bounds = term?.term ?? null;
    if (!bounds || (bounds.from && week.to < bounds.from) || (bounds.to && week.from > bounds.to)) {
      return { sectionDays: [], days: [], week: null, units: [], debriefs: [], coverage: 'outside-term' };
    }
    const rows = (term?.days ?? []).filter((d) => inWeek(d.studyDay));
    const days = rows.map((d) => ({
      day: d.studyDay, state: d.state, reason: d.reason ?? null, greenWeek: this.#greenWeekDay(d.studyDay), timeliness: ON_TIME,
    }));
    const weekdays = [0, 1, 2, 3, 4].map((i) => new Date(Date.parse(`${week.from}T00:00:00.000Z`) + i * 86_400_000)
      .toISOString().slice(0, 10));
    const excusedDays = weekdays.filter((day) => !this.#greenWeekDay(day));
    const sectionDays = rows.flatMap((d) => (d.sections ?? []).map((s) => ({
      day: d.studyDay, subject: s.subject, state: s.state, reason: s.reason ?? null, timeliness: ON_TIME,
    })));
    const row = (term?.weeks ?? []).find((w) => w.weekId === week.from) ?? null;
    const weekFact = row ? {
      weekId: row.weekId, state: row.state, reason: row.reason ?? null, open: row.open === true, excusedDays,
      weekendSubjects: this.#weekendSubjects(term?.days ?? [], week.to),
    } : null;
    return { sectionDays, days, week: weekFact, units: await this.#units(learnerId, inWeek), debriefs: await this.#debriefRows(learnerId, week), coverage: 'ok' };
  }

  /**
   * The subjects the most recent judged weekend (up to `through`) asked for:
   * a section there that was served or owed, not excused. A learner with
   * weekend scripture has `scripture` here, so a Friday sheet cannot claim to
   * finish a week whose Saturday and Sunday still count.
   */
  #weekendSubjects(days, through) {
    const weekend = days.filter((d) => typeof d.studyDay === 'string' && d.studyDay <= through
      && isoWeekday(d.studyDay) >= 6 && Array.isArray(d.sections) && d.sections.length);
    const latest = weekend.map((d) => d.studyDay).sort().at(-1);
    if (!latest) return [];
    const saturday = isoWeekday(latest) === 7
      ? new Date(Date.parse(`${latest}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10) : latest;
    const subjects = new Set();
    weekend.filter((d) => d.studyDay >= saturday && d.studyDay <= latest).forEach((d) => d.sections
      .filter((s) => s.subject && s.state !== 'excused').forEach((s) => subjects.add(s.subject)));
    return [...subjects].sort();
  }

  async #debriefRows(learnerId, week) {
    if (!this.#debriefs?.week) return [];
    try { return (await this.#debriefs.week({ learnerId, week })) ?? []; }
    catch (error) {
      this.#logger.warn?.('school.earning-evidence.debriefs-failed', { learnerId, error: error?.message });
      return [{ day: week.from, state: 'unknown', timeliness: ON_TIME, substantive: false, teachable: false, quiz: { right: 0, graded: 0 }, quizPassed: false }];
    }
  }

  async #units(learnerId, inWeek) {
    const rows = await this.#sessions.execute({ learnerId });
    // Curriculum work only. A program's own session (`sentence-ladder:<corpus>`,
    // any `<program>:<instance>` id) is credited by that program's section-day
    // rule; counting it here paid Korean twice, once as a "worksheet".
    const graded = (rows ?? []).filter((s) => inWeek(s.studyDay ?? s.day) && s.unitId && !String(s.unitId).includes(':')
      && (s.outcome?.result || s.state === 'graded'));
    // One lookup per unit, in parallel — a retried unit shares its answer.
    const infos = new Map();
    await Promise.all([...new Set(graded.map((s) => s.unitId))].map(async (unitId) => {
      try {
        infos.set(unitId, this.#unitInfo ? await this.#unitInfo(unitId) : null);
      } catch (err) {
        infos.set(unitId, null);
        this.#logger.warn?.('school.earning-evidence.unit-info-failed', { unitId, error: err?.message ?? String(err) });
      }
    }));
    const out = [];
    for (const s of graded) {
      const info = infos.get(s.unitId) ?? null;
      out.push({
        day: s.studyDay ?? s.day, unitId: s.unitId, subject: info?.subject ?? null, courseId: info?.courseId ?? null,
        result: s.outcome?.result ?? null, timeliness: ON_TIME,
      });
    }
    return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  }
}

export default SchoolEarningEvidence;
