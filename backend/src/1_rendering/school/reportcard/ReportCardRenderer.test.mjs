/**
 * Task 7 — the printable report card. A bespoke, one-or-two-page Letter PDF
 * built directly with pdfkit (NOT the worksheet/document block pipeline —
 * that machinery exists for card-backed question sheets, and a report card
 * is neither measured nor scanned). Reuses the `documents/` theme's fonts
 * and the same pinned-`CreationDate` determinism convention as
 * `DocumentPdfRenderer`.
 */
import { describe, it, expect } from 'vitest';
import { createReportCardPdfRenderer } from './ReportCardRenderer.mjs';

const LIVE_REPORT = Object.freeze({
  schema: 'school.report-card/v1',
  learnerId: 'kid1',
  period: {
    schema: 'school.academic-period/v1',
    periodId: 'fall-2026',
    kind: 'semester',
    label: 'Fall 2026',
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2026-06-01T00:00:00.000Z',
  },
  generatedAt: '2026-06-02T00:00:00.000Z',
  courses: [
    {
      courseId: 'math-5',
      policy: 'best-of-unit-mean-v1',
      coursePercent: 87.5,
      unitGrades: [
        { unitId: 'fractions-3', bestPercent: 95, passed: true, attempts: 2 },
        { unitId: 'fractions-4', bestPercent: 80, passed: true, attempts: 1 },
        { unitId: 'fractions-5', bestPercent: null, passed: false, attempts: 0 },
      ],
      unitOutcomes: [
        { unitId: 'fractions-3', result: 'passed', gradedPercent: 95, sessionId: 's2' },
        { unitId: 'fractions-4', result: 'passed', gradedPercent: 80, sessionId: 's3' },
        { unitId: 'fractions-5', result: null, gradedPercent: null, sessionId: null },
      ],
    },
  ],
  materials: [
    { materialId: 'piano-hymns', label: 'piano-hymns', unitsDone: 4, unitTotal: 10 },
  ],
  evidence: null,
  activeDays: {
    bySubject: [{ subjectId: 'math', days: 12 }],
    total: 20,
  },
  pendingReview: 2,
  remediationArcs: [
    {
      unitId: 'fractions-3', originalSessionId: 's1', remediationSessionId: 's2', result: 'passed',
    },
  ],
});

const FROZEN_REPORT = Object.freeze({
  ...LIVE_REPORT,
  closedBy: 'dad',
  closedAt: '2026-06-02T12:00:00.000Z',
  supersededVersions: 0,
});

describe('renderReportCardPdf', () => {
  it('renders a fixture live report to a parseable, single-or-more-page PDF, tagged draft', async () => {
    const renderReportCardPdf = createReportCardPdfRenderer();
    const { pdf, pageCount, mode } = await renderReportCardPdf(LIVE_REPORT, { learnerName: 'Milo K.' });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount).toBeGreaterThanOrEqual(1);
    expect(mode).toBe('draft');
  });

  it('renders a frozen report tagged frozen', async () => {
    const renderReportCardPdf = createReportCardPdfRenderer();
    const { pdf, pageCount, mode } = await renderReportCardPdf(FROZEN_REPORT, { learnerName: 'Milo K.' });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount).toBeGreaterThanOrEqual(1);
    expect(mode).toBe('frozen');
  });

  it('falls back to the learnerId when no learnerName is given', async () => {
    const renderReportCardPdf = createReportCardPdfRenderer();
    const { pdf } = await renderReportCardPdf(LIVE_REPORT, {});
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('produces a deterministic byte stream across two renders of the same report', async () => {
    const renderReportCardPdf = createReportCardPdfRenderer();
    const first = await renderReportCardPdf(LIVE_REPORT, { learnerName: 'Milo K.' });
    const second = await renderReportCardPdf(LIVE_REPORT, { learnerName: 'Milo K.' });
    expect(first.pdf.equals(second.pdf)).toBe(true);
  });

  it('paginates a report with many courses onto more than one page', async () => {
    const renderReportCardPdf = createReportCardPdfRenderer();
    const manyCourses = {
      ...LIVE_REPORT,
      courses: Array.from({ length: 40 }, (_, i) => ({
        courseId: `course-${i}`,
        policy: 'best-of-unit-mean-v1',
        coursePercent: 80,
        unitGrades: [{ unitId: `unit-${i}`, bestPercent: 80, passed: true, attempts: 1 }],
        unitOutcomes: [{ unitId: `unit-${i}`, result: 'passed', gradedPercent: 80, sessionId: `s-${i}` }],
      })),
    };
    const { pageCount } = await renderReportCardPdf(manyCourses, { learnerName: 'Milo K.' });
    expect(pageCount).toBeGreaterThan(1);
  });
});
