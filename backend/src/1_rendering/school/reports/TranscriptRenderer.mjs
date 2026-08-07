/**
 * The printable transcript (advocacy B11): one Letter PDF, every frozen
 * period in order with its course grades — the audit-season answer. Same
 * theme/fonts/pinned-CreationDate posture as its report siblings.
 */
import PDFDocument from 'pdfkit';
import { documentPdfTheme } from '../documents/documentPdfTheme.mjs';
import { registerDocumentFonts } from '../documents/measure.mjs';

const PINNED_CREATION_DATE = new Date('2000-01-01T00:00:00Z');
const pct = (v) => (typeof v === 'number' ? `${Math.round(v)}%` : '—');

export function createTranscriptPdfRenderer({ theme = documentPdfTheme, fontDir = undefined } = {}) {
  return function renderTranscriptPdf(transcript, { learnerName = null } = {}) {
    return new Promise((resolve, reject) => {
      const out = new PDFDocument({
        size: 'letter',
        margin: theme.page.marginPt,
        autoFirstPage: false,
        info: { CreationDate: PINNED_CREATION_DATE },
      });
      registerDocumentFonts(out, { theme, fontDir });
      let pageCount = 0;
      out.on('pageAdded', () => { pageCount += 1; });
      out.on('error', reject);
      const chunks = [];
      out.on('data', (chunk) => chunks.push(chunk));
      out.on('end', () => resolve({ pdf: Buffer.concat(chunks), pageCount }));
      out.addPage();

      const ink = theme.ink?.text ?? '#111';
      const muted = theme.ink?.muted ?? '#666';
      out.font(theme.fonts.bold.name).fontSize(20).fillColor(ink).text('Transcript');
      out.moveDown(0.2);
      out.font(theme.fonts.regular.name).fontSize(11).fillColor(muted)
        .text(learnerName ?? transcript.learnerId);
      out.moveDown(1);

      if (!(transcript.periods ?? []).length) {
        out.font(theme.fonts.regular.name).fontSize(11).fillColor(muted)
          .text('No closed terms yet. When a term is closed, its final grades are recorded here permanently — one section per term.');
      }
      for (const period of transcript.periods ?? []) {
        out.font(theme.fonts.bold.name).fontSize(13).fillColor(ink).text(period.label);
        out.font(theme.fonts.regular.name).fontSize(9).fillColor(muted)
          .text(`Closed ${String(period.closedAt ?? '').slice(0, 10)} by ${period.closedBy ?? 'unknown'} · ${period.activeDays} active days`);
        out.moveDown(0.2);
        for (const course of period.courses) {
          out.font(theme.fonts.regular.name).fontSize(11).fillColor(ink)
            .text(`${course.courseId}: ${pct(course.coursePercent)}`);
        }
        if (!period.courses.length) {
          out.font(theme.fonts.regular.name).fontSize(11).fillColor(muted).text('Nothing graded this period.');
        }
        out.moveDown(0.8);
      }
      out.end();
    });
  };
}
