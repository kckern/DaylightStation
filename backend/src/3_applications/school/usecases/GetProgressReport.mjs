/**
 * GetProgressReport — the period-to-date read model (spec C2/C5): the live
 * report card's course grades and active days, the learner's milestones
 * PACED against their enrichment days (behind-but-covered → excused, never
 * delinquency), and the period's enrichment entries as their own credit
 * section. Read-only; derived fresh on every call.
 */
import { paceMilestones } from '#domains/school/milestones.mjs';
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
    const { milestones } = await this.#milestoneStatuses.execute({ learnerId });
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
      enrichment: { entries: inPeriod },
    };
  }
}
