/**
 * The printable course syllabus (advocacy B10): a course's units in
 * sequence with their objectives, grade bands, and pass bars — the thing a
 * teacher hands a spouse or a co-op at planning season. Renders from unit
 * SUMMARIES (no answer keys anywhere near this).
 */
import PDFDocument from 'pdfkit';
import { documentPdfTheme } from '../documents/documentPdfTheme.mjs';
import { registerDocumentFonts } from '../documents/measure.mjs';

const PINNED_CREATION_DATE = new Date('2000-01-01T00:00:00Z');

export function createSyllabusPdfRenderer({ theme = documentPdfTheme, fontDir = undefined } = {}) {
  return function renderSyllabusPdf({ courseId, courseLabel = null, units = [] }) {
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
      out.font(theme.fonts.bold.name).fontSize(20).fillColor(ink).text('Syllabus');
      out.moveDown(0.2);
      out.font(theme.fonts.regular.name).fontSize(12).fillColor(muted).text(courseLabel ?? courseId);
      out.moveDown(1);

      for (const unit of units) {
        out.font(theme.fonts.bold.name).fontSize(12).fillColor(ink)
          .text(`${unit.sequence != null ? `${unit.sequence}. ` : ''}${unit.title ?? unit.unitId}`);
        const meta = [];
        if ((unit.grades ?? []).length) meta.push(`grades: ${unit.grades.join(', ')}`);
        if (unit.passingPercent != null) meta.push(`pass bar: ${unit.passingPercent}%`);
        if (meta.length) out.font(theme.fonts.regular.name).fontSize(9).fillColor(muted).text(meta.join(' · '));
        for (const objective of unit.objectives ?? []) {
          out.font(theme.fonts.regular.name).fontSize(10).fillColor(ink).text(`• ${objective}`, { indent: 10 });
        }
        out.moveDown(0.6);
      }
      if (!units.length) {
        out.font(theme.fonts.regular.name).fontSize(11).fillColor(muted).text('No published units for this course.');
      }
      out.end();
    });
  };
}
