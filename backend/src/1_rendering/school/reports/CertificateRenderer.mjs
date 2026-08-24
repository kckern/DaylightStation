/**
 * The course-completion certificate (teacher-console spec C2): one landscape
 * Letter page. Wave-9 ceremony (design audit #9): a certificate is THEATRE — a
 * double border rule, content vertically centered on the page (not crammed
 * into the top half), the learner's name at display size, a humane date,
 * and a real signature line above "Teacher". A child should want this on
 * the wall. Same theme/fonts/pinned-CreationDate posture as its report
 * siblings; the caller still decides eligibility (no fabricated diplomas).
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
        layout: 'landscape',
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
      const pageW = 792; const pageH = 612; // US Letter landscape, points
      const m = theme.page.marginPt;

      // The frame: a double border rule — outer heavy, inner hairline.
      out.save();
      out.lineWidth(2).strokeColor(ink).rect(m, m, pageW - 2 * m, pageH - 2 * m).stroke();
      out.lineWidth(0.5).strokeColor(muted).rect(m + 8, m + 8, pageW - 2 * (m + 8), pageH - 2 * (m + 8)).stroke();
      out.restore();

      // Content block, vertically centered by construction: start a third of
      // the way down so the composition sits at the page's optical center.
      const humaneDate = (() => {
        const d = new Date(issuedOn);
        if (!Number.isFinite(d.valueOf())) return issuedOn ?? '';
        const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
      })();

      out.y = pageH * 0.16;
      out.font(theme.fonts.bold.name).fontSize(30).fillColor(ink)
        .text('Certificate of Completion', { align: 'center' });
      out.moveDown(1.6);
      out.font(theme.fonts.regular.name).fontSize(13).fillColor(muted).text('This certifies that', { align: 'center' });
      out.moveDown(0.6);
      out.font(theme.fonts.bold.name).fontSize(40).fillColor(ink).text(learnerName, { align: 'center' });
      out.moveDown(0.6);
      out.font(theme.fonts.regular.name).fontSize(13).fillColor(muted).text('has completed', { align: 'center' });
      out.moveDown(0.6);
      out.font(theme.fonts.bold.name).fontSize(22).fillColor(ink).text(courseLabel ?? courseId, { align: 'center' });
      if (typeof percent === 'number') {
        out.moveDown(0.6);
        out.font(theme.fonts.regular.name).fontSize(13).fillColor(muted)
          .text(`with a course grade of ${Math.round(percent)}%`, { align: 'center' });
      }
      out.moveDown(1.4);
      out.font(theme.fonts.regular.name).fontSize(12).fillColor(muted)
        .text([periodLabel, humaneDate].filter(Boolean).join(' · '), { align: 'center' });

      // Signature block anchored to the LOWER band of the frame: a real rule
      // to sign above, the issuer's name beneath it, the role beneath that.
      const sigW = 220;
      const sigX = (pageW - sigW) / 2;
      const sigY = pageH - m - 86;
      out.save().lineWidth(0.75).strokeColor(ink)
        .moveTo(sigX, sigY).lineTo(sigX + sigW, sigY).stroke().restore();
      out.font(theme.fonts.regular.name).fontSize(12).fillColor(ink)
        .text(issuedBy ?? '', sigX, sigY + 6, { width: sigW, align: 'center' });
      out.font(theme.fonts.regular.name).fontSize(9).fillColor(muted)
        .text('Teacher', sigX, sigY + 24, { width: sigW, align: 'center' });
      out.end();
    });
  };
}
