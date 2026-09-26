/**
 * School's side of the economy's earning-evidence port
 * (`#apps/economy/ports/IEarningEvidenceSource.mjs` — ISchoolEarningEvidence).
 *
 * One learner's school week as facts, in the term grid's own vocabulary:
 *   days         each study day's verdict (met | partial | none | exempt | unknown)
 *   sectionDays  each day's per-subject state (served | obligated | excused | faulted)
 *   week         the week row (Monday id), with `open` while the week is under way
 *   units        the week's graded work sessions, with subject/course from the curriculum
 *
 * Reads only the application services School already has (term verdicts, the
 * learner session list, the curriculum), never files. Every fact is stamped
 * `timeliness: 'on-time'`: makeup (taxonomy D14) is not built, and the field
 * keeps future payout refs stable when it is.
 */
import { ISchoolEarningEvidence } from '#apps/economy/ports/IEarningEvidenceSource.mjs';

const ON_TIME = 'on-time';

export class SchoolEarningEvidence extends ISchoolEarningEvidence {
  #termVerdicts;
  #sessions;
  #unitInfo;
  #logger;

  /**
   * @param {object} deps
   * @param {{read: (learnerId: string, opts: object) => Promise<object>}} deps.termVerdicts - TermVerdictService
   * @param {{execute: (args: {learnerId: string}) => Promise<object[]>}} deps.sessions - ListLearnerSessions
   * @param {(unitId: string) => Promise<{subject?: string, courseId?: string}|null>} [deps.unitInfo]
   */
  constructor({ termVerdicts, sessions, unitInfo = null, logger = console }) {
    super();
    if (!termVerdicts?.read) throw new Error('SchoolEarningEvidence requires termVerdicts');
    if (!sessions?.execute) throw new Error('SchoolEarningEvidence requires sessions');
    this.#termVerdicts = termVerdicts;
    this.#sessions = sessions;
    this.#unitInfo = unitInfo;
    this.#logger = logger;
  }

  async schoolWeek({ learnerId, week }) {
    const inWeek = (day) => typeof day === 'string' && day >= week.from && day <= week.to;
    const term = await this.#termVerdicts.read(learnerId, { detail: true });
    // The grid reads only the term containing today. A week outside it has no
    // verdicts at all — say so, rather than hand back an empty week that the
    // economy would read as "not on the plan".
    const bounds = term?.term ?? null;
    if (!bounds || (bounds.from && week.to < bounds.from) || (bounds.to && week.from > bounds.to)) {
      return { sectionDays: [], days: [], week: null, units: [], coverage: 'outside-term' };
    }
    const rows = (term?.days ?? []).filter((d) => inWeek(d.studyDay));
    const days = rows.map((d) => ({ day: d.studyDay, state: d.state, reason: d.reason ?? null, timeliness: ON_TIME }));
    const sectionDays = rows.flatMap((d) => (d.sections ?? []).map((s) => ({
      day: d.studyDay, subject: s.subject, state: s.state, reason: s.reason ?? null, timeliness: ON_TIME,
    })));
    const row = (term?.weeks ?? []).find((w) => w.weekId === week.from) ?? null;
    const weekFact = row ? { weekId: row.weekId, state: row.state, reason: row.reason ?? null, open: row.open === true } : null;
    return { sectionDays, days, week: weekFact, units: await this.#units(learnerId, inWeek), coverage: 'ok' };
  }

  async #units(learnerId, inWeek) {
    const rows = await this.#sessions.execute({ learnerId });
    const graded = (rows ?? []).filter((s) => inWeek(s.studyDay ?? s.day) && s.unitId && (s.outcome?.result || s.state === 'graded'));
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
