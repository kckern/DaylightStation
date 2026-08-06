/**
 * GetTranscript — the cumulative record (advocacy B11): every FROZEN period
 * for one learner, newest last, each with its course grades and active
 * days — the pile of per-period cards assembled into one answer for
 * grandma, the co-op, or a state homeschool audit. Frozen records only:
 * a transcript is a record of closes, never a live projection.
 */
export class GetTranscript {
  #reportCardsStore;

  constructor({ reportCardsStore } = {}) {
    if (!reportCardsStore) throw new Error('GetTranscript requires reportCardsStore');
    this.#reportCardsStore = reportCardsStore;
  }

  async execute({ learnerId } = {}) {
    const records = this.#reportCardsStore.listReportCards(learnerId) ?? [];
    const periods = records
      .slice()
      .sort((a, b) => String(a.period?.startsAt ?? '').localeCompare(String(b.period?.startsAt ?? '')))
      .map((rec) => ({
        periodId: rec.period?.periodId ?? rec.periodId,
        label: rec.period?.label ?? rec.period?.periodId ?? rec.periodId,
        closedBy: rec.closedBy ?? null,
        closedAt: rec.closedAt ?? null,
        activeDays: rec.activeDays?.total ?? 0,
        courses: (rec.courses ?? []).map((c) => ({
          courseId: c.courseId, coursePercent: c.coursePercent ?? null,
        })),
      }));
    return { schema: 'school.transcript/v1', learnerId, periods };
  }
}
