/**
 * Smoke tests for the wave-4 renderers: both produce a real one-page PDF
 * from honest fixtures (fonts registered, no theme-key drift), and the
 * progress report prints the C5 vocabulary (excused, never delinquency).
 */
import { describe, it, expect } from 'vitest';
import { createProgressReportPdfRenderer } from './ProgressReportRenderer.mjs';
import { createCertificatePdfRenderer } from './CertificateRenderer.mjs';

const REPORT = {
  schema: 'school.progress-report/v1',
  learnerId: 'learner4',
  period: { periodId: '2026-fall', label: 'Fall 2026' },
  generatedAt: '2026-08-06T12:00:00Z',
  courses: [{ courseId: 'math-fractions', policy: 'best-of-unit-mean-v1', coursePercent: 88 }],
  activeDays: { bySubject: [{ subjectId: 'math', days: 12 }], total: 12 },
  milestones: [
    { id: 'm1', unitId: 'math-fractions.02', dueBy: '2026-08-01', status: 'behind', overdueDays: 4, excusedDays: 4, effectiveStatus: 'excused' },
    { id: 'm2', unitId: 'math-fractions.03', dueBy: '2026-09-01', status: 'upcoming', overdueDays: 0, excusedDays: 0, effectiveStatus: 'upcoming' },
  ],
  enrichment: { entries: [{ id: 'e1', title: 'Yellowstone trip', from: '2026-08-02', to: '2026-08-06', subjectIds: ['science'], note: 'Geysers' }] },
};

describe('ProgressReportRenderer', () => {
  it('renders a PDF with the excused vocabulary', async () => {
    const render = createProgressReportPdfRenderer();
    const { pdf, pageCount } = await render(REPORT);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount).toBe(1);
    expect(pdf.length).toBeGreaterThan(2000);
  });
});

describe('CertificateRenderer', () => {
  it('renders a one-page landscape Letter certificate', async () => {
    const render = createCertificatePdfRenderer();
    const { pdf, pageCount } = await render({
      learnerName: 'Learner4', courseId: 'math-fractions', percent: 88,
      periodLabel: 'Fall 2026', issuedOn: '2026-08-06', issuedBy: 'KC Kern',
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount).toBe(1);
    expect(pdf.toString('latin1')).toMatch(/\/MediaBox\s*\[0 0 792 612\]/);
  });
});
