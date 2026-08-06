/**
 * The printable progress report (teacher-console spec C2/C5): period-to-date
 * course grades, PACED milestones (a behind-but-enrichment-covered target
 * prints "excused", never delinquency), and the enrichment entries as their
 * own credit section. Same bespoke-pdfkit posture, theme, fonts, and
 * pinned-CreationDate determinism as its sibling ReportCardRenderer.
 *
 * Consumes `school.progress-report/v1` (GetProgressReport) verbatim.
 */
import PDFDocument from 'pdfkit';
import { documentPdfTheme } from '../documents/documentPdfTheme.mjs';
import { registerDocumentFonts } from '../documents/measure.mjs';

const PINNED_CREATION_DATE = new Date('2000-01-01T00:00:00Z');
const pct = (v) => (typeof v === 'number' ? `${Math.round(v)}%` : '—');

function drawProgressReport(out, theme, report) {
  const ink = theme.ink?.text ?? '#111';
  const muted = theme.ink?.muted ?? '#666';
  out.font(theme.fonts.bold.name).fontSize(20).fillColor(ink)
    .text('Progress Report', { align: 'left' });
  out.moveDown(0.2);
  out.font(theme.fonts.regular.name).fontSize(11).fillColor(muted)
    .text(`${report.learnerId} — ${report.period?.label ?? report.period?.periodId ?? ''}`);
  out.moveDown(1);

  out.font(theme.fonts.bold.name).fontSize(13).fillColor(ink).text('Courses');
  out.moveDown(0.3);
  for (const course of report.courses ?? []) {
    out.font(theme.fonts.regular.name).fontSize(11).fillColor(ink)
      .text(`${course.courseId}: ${pct(course.coursePercent)}`);
  }
  if (!(report.courses ?? []).length) {
    out.font(theme.fonts.regular.name).fontSize(11).fillColor(muted).text('Nothing graded this period yet.');
  }
  out.moveDown(0.6);
  out.font(theme.fonts.regular.name).fontSize(10).fillColor(muted)
    .text(`${report.activeDays?.total ?? 0} active instructional days this period.`);
  out.moveDown(1);

  out.font(theme.fonts.bold.name).fontSize(13).fillColor(ink).text('Milestones');
  out.moveDown(0.3);
  for (const m of report.milestones ?? []) {
    const label = m.label ?? m.unitId;
    let line;
    if (m.effectiveStatus === 'excused') {
      line = `${label} — due ${m.dueBy}: excused (${m.excusedDays} enrichment day${m.excusedDays === 1 ? '' : 's'})`;
    } else if (m.effectiveStatus === 'behind') {
      line = `${label} — due ${m.dueBy}: behind by ${m.overdueDays} day${m.overdueDays === 1 ? '' : 's'}`
        + (m.excusedDays ? ` (${m.excusedDays} excused)` : '');
    } else {
      line = `${label} — due ${m.dueBy}: ${m.effectiveStatus}`;
    }
    out.font(theme.fonts.regular.name).fontSize(11).fillColor(ink).text(line);
  }
  if (!(report.milestones ?? []).length) {
    out.font(theme.fonts.regular.name).fontSize(11).fillColor(muted).text('No milestones set for this learner.');
  }
  out.moveDown(1);

  out.font(theme.fonts.bold.name).fontSize(13).fillColor(ink).text('Enrichment / experiential learning');
  out.moveDown(0.3);
  for (const e of report.enrichment?.entries ?? []) {
    const dates = e.to && e.to !== e.from ? `${e.from} → ${e.to}` : e.from;
    out.font(theme.fonts.regular.name).fontSize(11).fillColor(ink)
      .text(`${e.title} (${dates})${(e.subjectIds ?? []).length ? ` — ${e.subjectIds.join(', ')}` : ''}`);
    if (e.note) out.font(theme.fonts.regular.name).fontSize(9).fillColor(muted).text(`   ${e.note}`);
  }
  if (!(report.enrichment?.entries ?? []).length) {
    out.font(theme.fonts.regular.name).fontSize(11).fillColor(muted).text('No enrichment recorded this period.');
  }
}

export function createProgressReportPdfRenderer({ theme = documentPdfTheme, fontDir = undefined } = {}) {
  return function renderProgressReportPdf(report) {
    if (!report || typeof report !== 'object') {
      throw new TypeError('renderProgressReportPdf requires a school.progress-report/v1 report');
    }
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
      drawProgressReport(out, theme, report);
      out.end();
    });
  };
}
