/** Read-side projections spanning School's append-only record sources. */
export class SchoolRecordsQueryService {
  constructor({
    attemptsStore = null, attestationLog = null, teacherNotesStore = null,
    enrichmentLog = null, academicPeriods = null, passOverrideStore = null,
    reviewQueue = null, curriculumQuery = null, schoolService = null,
    academicPeriodStore = null, milestoneStore = null, assignmentsStore = null,
    reassignmentLog = null,
  } = {}) {
    Object.assign(this, {
      attemptsStore, attestationLog, teacherNotesStore, enrichmentLog,
      academicPeriods, passOverrideStore, reviewQueue, curriculumQuery,
      schoolService, academicPeriodStore, milestoneStore, assignmentsStore,
      reassignmentLog,
    });
  }

  hasPeriods() { return Boolean(this.academicPeriods); }
  hasAttempts() { return Boolean(this.attemptsStore); }
  hasReviewQueue() { return Boolean(this.reviewQueue); }
  listPeriods() { return this.academicPeriods?.listPeriods?.() ?? []; }
  periodHistoryLength() { return this.academicPeriods?.historyLength?.() ?? 0; }
  passOverrides() { return this.passOverrideStore?.all?.() ?? {}; }
  attemptDays(learnerId) { return this.attemptsStore?.listAttemptDays?.(learnerId)?.slice(0, 14) ?? []; }
  attestations(options) { return this.attestationLog?.list?.(options) ?? []; }
  teacherNotes(options) { return this.teacherNotesStore?.list?.(options) ?? []; }
  enrichment(options) { return this.enrichmentLog?.list?.(options) ?? []; }

  attemptSummary(learnerId, day) {
    if (!this.attemptsStore) return [];
    const bankTitleById = new Map((this.schoolService?.listBanks?.() ?? [])
      .filter((bank) => bank?.id && bank?.title)
      .map((bank) => [bank.id, bank.title]));
    const byAssessment = new Map();
    for (const attempt of this.attemptsStore.readAttemptDay(learnerId, day)) {
      const id = attempt.sessionId ?? attempt.provenance?.recordId ?? null;
      if (!id) continue;
      const entry = byAssessment.get(id) ?? {
        assessmentId: id, count: 0, bankId: attempt.bankId ?? null,
        title: attempt.title ?? attempt.unitTitle ?? bankTitleById.get(attempt.bankId) ?? null,
        firstAt: attempt.at,
      };
      entry.count += 1;
      if (attempt.at < entry.firstAt) entry.firstAt = attempt.at;
      byAssessment.set(id, entry);
    }
    return [...byAssessment.values()];
  }

  async audit({ since = null, limit = 500 } = {}) {
    const rows = [];
    const push = (kind, at, payload) => {
      if (!at || (since && at < since)) return;
      rows.push({ kind, at, ...payload });
    };
    try { (this.academicPeriodStore?.history?.() ?? []).forEach((h) => push('periods', h.at, { by: h.editedBy ?? null, count: h.count ?? null })); } catch {}
    try { (this.passOverrideStore?.history?.() ?? []).forEach((h) => push('pass-override', h.at, { by: h.editedBy ?? null, unitId: h.unitId ?? null, percent: h.percent ?? null })); } catch {}
    try { (this.milestoneStore?.history?.() ?? []).forEach((h) => push('milestones', h.at, { by: h.editedBy ?? null, count: h.count ?? null })); } catch {}
    try {
      (this.reassignmentLog?.list?.() ?? []).forEach((h) => push('reassignment', h.at, {
        by: h.reassignedBy ?? null, learnerId: h.fromLearnerId ?? null,
        toLearnerId: h.toLearnerId ?? null, moved: h.moved ?? null,
      }));
    } catch {}
    if (this.assignmentsStore?.history && this.assignmentsStore?.list) {
      try {
        const records = await this.assignmentsStore.list();
        for (const record of records) {
          // eslint-disable-next-line no-await-in-loop
          const trail = await this.assignmentsStore.history(record.learnerId);
          trail.forEach((h) => push('assignments', h.recordedAt, {
            by: h.assignedBy ?? null, learnerId: record.learnerId, courses: (h.courses ?? []).length,
          }));
        }
      } catch {}
    }
    return rows.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit);
  }

  async learnerReview(learnerId, limit) {
    const items = this.reviewQueue ? await this.reviewQueue.listForLearner(learnerId, { limit }) : [];
    const titleOf = async (unitId) => {
      if (!unitId) return null;
      try { return (await this.curriculumQuery?.getUnit?.(unitId))?.title ?? null; } catch { return null; }
    };
    const notes = this.teacherNotes({ learnerId }).map((note) => ({
      itemId: note.id, sessionId: null, unitId: null, unitTitle: null,
      verdict: null, kind: 'note', note: note.note,
      gradedBy: note.from ?? null, gradedAt: note.at,
    }));
    const reviews = await Promise.all(items.map(async (item) => ({
      itemId: item.itemId, sessionId: item.sessionId, unitId: item.unitId ?? null,
      unitTitle: await titleOf(item.unitId), verdict: item.verdict,
      note: item.note ?? null, gradedBy: item.gradedBy ?? null,
      gradedAt: item.gradedAt ?? null, prompt: item.prompt ?? null,
      questionNumber: item.questionNumber ?? null,
    })));
    return [...reviews, ...notes]
      .sort((a, b) => String(b.gradedAt ?? '').localeCompare(String(a.gradedAt ?? '')))
      .slice(0, limit);
  }
}

export default SchoolRecordsQueryService;
