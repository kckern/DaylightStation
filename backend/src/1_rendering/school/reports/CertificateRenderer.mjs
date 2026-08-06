/**
 * The course-completion certificate (teacher-console spec C2): one Letter
 * page, deliberately plain and dignified — learner, course, percent, period,
 * issue date, issuer line. Same theme/fonts/pinned-CreationDate posture as
 * its report siblings. The caller decides eligibility (no fabricated
 * diplomas here — the route refuses a course with nothing graded).
 */
import PDFDocument from 'pdfkit';
import { documentPdfTheme } from '../documents/documentPdfTheme.mjs';
import { registerDocumentFonts } from '../documents/measure.mjs';

const PINNED_CREATION_DATE = new Date('2000-01-01T00:00:00Z');

export function createCertificatePdfRenderer({ theme = documentPdfTheme, fontDir = undefined } = {}) {
  return function renderCertificatePdf({
    learnerName, courseId, courseLabel = null, percent = null, periodLabel = null, issuedOn, issuedBy = null,
  }) {
    return new Promise((resolve, reject) => {
      const out = new PDFDocument({
        size: 'letter',
        margin: theme.page.marginPt,
        autoFirstPage: false,
        info: { CreationDate: PINNED_CREATION_DATE },
      });
      registerDocumentFonts(out, { theme, fontDir });
      out.on('error', reject);
      const chunks = [];
      out.on('data', (chunk) => chunks.push(chunk));
      out.on('end', () => resolve({ pdf: Buffer.concat(chunks), pageCount: 1 }));
      out.addPage();

      const ink = theme.ink?.text ?? '#111';
      const muted = theme.ink?.muted ?? '#666';
      out.moveDown(4);
      out.font(theme.fonts.bold.name).fontSize(26).fillColor(ink)
        .text('Certificate of Completion', { align: 'center' });
      out.moveDown(1.5);
      out.font(theme.fonts.regular.name).fontSize(12).fillColor(muted).text('This certifies that', { align: 'center' });
      out.moveDown(0.5);
      out.font(theme.fonts.bold.name).fontSize(22).fillColor(ink).text(learnerName, { align: 'center' });
      out.moveDown(0.5);
      out.font(theme.fonts.regular.name).fontSize(12).fillColor(muted).text('has completed', { align: 'center' });
      out.moveDown(0.5);
      out.font(theme.fonts.bold.name).fontSize(18).fillColor(ink).text(courseLabel ?? courseId, { align: 'center' });
      if (typeof percent === 'number') {
        out.moveDown(0.5);
        out.font(theme.fonts.regular.name).fontSize(12).fillColor(muted)
          .text(`with a course grade of ${Math.round(percent)}%`, { align: 'center' });
      }
      out.moveDown(1.5);
      out.font(theme.fonts.regular.name).fontSize(11).fillColor(muted)
        .text([periodLabel, issuedOn].filter(Boolean).join(' · '), { align: 'center' });
      if (issuedBy) {
        out.moveDown(2);
        out.font(theme.fonts.regular.name).fontSize(11).fillColor(ink).text(issuedBy, { align: 'center' });
        out.font(theme.fonts.regular.name).fontSize(9).fillColor(muted).text('Teacher', { align: 'center' });
      }
      out.end();
    });
  };
}
