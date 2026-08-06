/**
 * GetProgressReport — the period-to-date read model (spec C2/C5): the live
 * report card's course grades and active days, the learner's milestones
 * PACED against their enrichment days (behind-but-covered → excused, never
 * delinquency), and the period's enrichment entries as their own credit
 * section. Read-only; derived fresh on every call.
 */
import { paceMilestones } from '#domains/school/milestones.mjs';

const dayMs = 86_400_000;
const parseDay = (d) => Date.parse(`${d}T00:00:00Z`);
/** Distinct enrichment dates clamped to the period window. */
function enrichmentDaysInPeriod(entries, fromDay, toDay) {
  const days = new Set();
  for (const e of entries) {
    if (typeof e?.from !== 'string') continue;
    const to = typeof e.to === 'string' ? e.to : e.from;
    for (let t = parseDay(e.from); t <= parseDay(to); t += dayMs) {
      const date = new Date(t).toISOString().slice(0, 10);
      if (date >= fromDay && date <= toDay) days.add(date);
    }
  }
  return days.size;
}
import { offsetMinutesFor } from '#domains/school/studyDay.mjs';

export class GetProgressReport {
  #getReportCard; #milestoneStatuses; #enrichmentLog; #timezone; #clock;

  constructor({ getReportCard, milestoneStatuses, enrichmentLog, timezone = null, clock = () => new Date() } = {}) {
    if (!getReportCard) throw new Error('GetProgressReport requires getReportCard');
    if (!milestoneStatuses) throw new Error('GetProgressReport requires milestoneStatuses');
    if (!enrichmentLog) throw new Error('GetProgressReport requires enrichmentLog');
    this.#getReportCard = getReportCard;
    this.#milestoneStatuses = milestoneStatuses;
    this.#enrichmentLog = enrichmentLog;
    this.#timezone = timezone;
    this.#clock = clock;
  }

  async execute({ learnerId, periodId } = {}) {
    const card = await this.#getReportCard.execute({ learnerId, periodId });
    const { milestones: allMilestones } = await this.#milestoneStatuses.execute({ learnerId });
    // Period-scoped by DUE DATE: a period-to-date report paces only the
    // targets due inside this period — next year's milestones are next
    // year's report's business.
    const fromDayScope = card.period.startsAt.slice(0, 10);
    const toDayScope = card.period.endsAt.slice(0, 10);
    const milestones = allMilestones.filter((m) => m.dueBy >= fromDayScope && m.dueBy <= toDayScope);
    const entries = this.#enrichmentLog.list({ learnerId });
    const inPeriod = entries.filter((e) => {
      const fromDay = card.period.startsAt.slice(0, 10);
      const toDay = card.period.endsAt.slice(0, 10);
      return e.from <= toDay && (e.to ?? e.from) >= fromDay;
    });
    const nowMs = this.#clock().getTime();
    const today = new Date(nowMs + offsetMinutesFor(this.#timezone, nowMs) * 60_000).toISOString().slice(0, 10);
    return {
      schema: 'school.progress-report/v1',
      learnerId,
      period: card.period,
      generatedAt: this.#clock().toISOString(),
      courses: card.courses,
      activeDays: card.activeDays,
      milestones: paceMilestones(milestones, inPeriod, { today }),
      enrichment: { entries: inPeriod, daysInPeriod: enrichmentDaysInPeriod(inPeriod, fromDayScope, toDayScope) },
    };
  }
}
