/** Report-card record access and PDF rendering orchestration. */
export class SchoolReportDocumentService {
  constructor({
    reportCardsStore = null,
    learnerDirectory = null,
    curriculumQuery = null,
    getReportCard = null,
    renderReportCardPdf = null,
    renderProgressReportPdf = null,
    renderCertificatePdf = null,
    renderTranscriptPdf = null,
    renderSyllabusPdf = null,
    getHouseholdOffsetMinutes = null,
    clock = () => Date.now(),
  } = {}) {
    Object.assign(this, {
      reportCardsStore, learnerDirectory, curriculumQuery, getReportCard,
      renderReportCardPdf, renderProgressReportPdf, renderCertificatePdf,
      renderTranscriptPdf, renderSyllabusPdf, getHouseholdOffsetMinutes, clock,
    });
  }

  hasFrozenReports() { return Boolean(this.reportCardsStore); }
  canRenderSyllabus() { return Boolean(this.renderSyllabusPdf && this.curriculumQuery?.isConfigured?.()); }
  canRenderCertificate() { return Boolean(this.getReportCard && this.renderCertificatePdf); }
  readFrozen(learnerId, periodId) { return this.reportCardsStore?.readReportCard?.(learnerId, periodId) ?? null; }
  listFrozen(learnerId) { return this.reportCardsStore?.listReportCards?.(learnerId) ?? null; }
  listFrozenVersions(learnerId, periodId) { return this.reportCardsStore?.listReportCardVersions?.(learnerId, periodId) ?? []; }

  async learnerName(learnerId, override = null, { fallbackToId = true } = {}) {
    if (override) return override;
    try {
      const roster = this.learnerDirectory ? await Promise.resolve(this.learnerDirectory.listLearners()) : [];
      return roster.find((row) => row.id === learnerId)?.name ?? (fallbackToId ? learnerId : null);
    } catch { return fallbackToId ? learnerId : null; }
  }

  async reportCardPdf(report, { learnerId, learnerName = null }) {
    if (!this.renderReportCardPdf) return null;
    return this.renderReportCardPdf(report, {
      learnerName: await this.learnerName(learnerId, learnerName, { fallbackToId: false }),
    });
  }
  async progressReportPdf(report) { return this.renderProgressReportPdf ? this.renderProgressReportPdf(report) : null; }
  async transcriptPdf(transcript, learnerId) {
    return this.renderTranscriptPdf
      ? this.renderTranscriptPdf(transcript, { learnerName: await this.learnerName(learnerId) })
      : null;
  }
  async syllabusPdf(courseId) {
    if (!this.renderSyllabusPdf || !this.curriculumQuery) return { kind: 'unconfigured' };
    const units = await this.curriculumQuery.getSyllabusUnits(courseId);
    if (units === null) return { kind: 'unconfigured' };
    if (!units.length) return { kind: 'not_found' };
    return { kind: 'rendered', ...(await this.renderSyllabusPdf({ courseId, units })) };
  }
  async certificatePdf({ learnerId, periodId, courseId, issuedBy = null }) {
    if (!this.getReportCard || !this.renderCertificatePdf) return { kind: 'unconfigured' };
    const card = await this.getReportCard.execute({ learnerId, periodId });
    const course = (card?.courses ?? []).find((row) => row.courseId === courseId);
    if (!course || typeof course.coursePercent !== 'number') return { kind: 'not_found' };
    const nowMs = this.clock();
    const issuedOn = new Date(nowMs + (this.getHouseholdOffsetMinutes?.(nowMs) ?? 0) * 60_000).toISOString().slice(0, 10);
    return {
      kind: 'rendered',
      ...(await this.renderCertificatePdf({
        learnerName: await this.learnerName(learnerId), courseId,
        percent: course.coursePercent, periodLabel: card.period?.label ?? periodId,
        issuedOn, issuedBy,
      })),
    };
  }
}

export default SchoolReportDocumentService;
