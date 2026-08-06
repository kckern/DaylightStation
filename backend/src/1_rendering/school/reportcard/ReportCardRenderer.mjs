/**
 * The printable report card (adequacy MUST 2, Task 7). A bespoke, one-or-
 * two-page Letter PDF built directly with pdfkit — deliberately NOT routed
 * through `documents/measure.mjs` + `layout.mjs` + `DocumentPdfRenderer.mjs`,
 * which exist to measure-then-place card-backed question sheets. A report
 * card has no bubbles, no card-id strip, and nothing a scanner ever reads;
 * pdfkit's own automatic text pagination (it adds a page mid-`.text()` call
 * once content would cross the bottom margin — see `LineWrapper`) is enough.
 *
 * Reuses the `documents/` theme (`documentPdfTheme.mjs`) for fonts/ink/page
 * geometry via `registerDocumentFonts`, and the same pinned-`CreationDate`
 * determinism convention `DocumentPdfRenderer` uses, so two renders of the
 * same report produce byte-identical output.
 *
 * Consumes `school.report-card/v1` (Task 6's `GetReportCard`) verbatim,
 * either the LIVE shape or the FROZEN one (the live shape plus `{closedBy,
 * closedAt, supersededVersions}` — `CloseAcademicPeriod`'s frozen payload).
 * `mode` is derived from the presence of `closedAt`: a live report never
 * carries one, a frozen record always does.
 *
 * Two design gaps versus the brief's illustrative narrative line
 * ("Fractions unit 3: 60% → tutored → 95%"), both because the actual Task 6
 * shape does not carry the fields that example implies:
 *  - `remediationArcs` entries (`{unitId, originalSessionId,
 *    remediationSessionId, result}`) carry no gradedPercent of their own
 *    (Task 6's own report flags this as provisional). The "after" percent
 *    used below is looked up from `courses[].unitOutcomes` for the same
 *    unit — the best in-period session for that unit, which for a unit that
 *    got remediated is normally the remediation session itself. There is no
 *    "before" percent available anywhere in the v1 shape, so the line omits
 *    one rather than fabricate it.
 *  - Task 10 (concept registry + mastery facet) added a real `concepts`
 *    field to the report shape (`{mastered, developing}`, each an array of
 *    `{conceptId, label, ratio, responses}` from `conceptMastery` — the
 *    domain aggregation over graded evidence bound to `learning.conceptIds`,
 *    labeled via the household concept registry). A "Concepts — mastered /
 *    developing" section renders ALONGSIDE the unit pass/fail section below,
 *    never replacing it — the two answer different questions (which DISCRETE
 *    IDEAS a learner has vs. which WHOLE UNITS they passed), and a report
 *    predating Task 10 (or with an unwired/empty registry) simply omits or
 *    empties `concepts`, so the section renders only when there is
 *    something honest to say.
 *
 * @module rendering/school/reportcard/ReportCardRenderer
 */
import PDFDocument from 'pdfkit';
import { documentPdfTheme } from '../documents/documentPdfTheme.mjs';
import { registerDocumentFonts } from '../documents/measure.mjs';
import { COURSE_GRADE_POLICY } from '#domains/school/progress/courseGrade.mjs';

/** Same determinism convention as `DocumentPdfRenderer.mjs`: never the clock. */
const PINNED_CREATION_DATE = new Date(0);

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * Create a report-card PDF renderer.
 *
 * @param {Object} [deps]
 * @param {Object} [deps.theme=documentPdfTheme]
 * @param {string} [deps.fontDir] - override the bundled font directory
 * @returns {(report: object, opts?: {learnerName?: string|null}) =>
 *   Promise<{pdf: Buffer, pageCount: number, mode: 'draft'|'frozen'}>}
 *   a plain function (not a `{execute}` use case) — the router's DI param
 *   calls it directly as `renderReportCardPdf(report, {learnerName})`.
 */
export function createReportCardPdfRenderer({ theme = documentPdfTheme, fontDir = undefined } = {}) {
  return function renderReportCardPdf(report, { learnerName = null } = {}) {
    if (!report || typeof report !== 'object') {
      throw new TypeError('renderReportCardPdf requires a school.report-card/v1 report');
    }
    const mode = isNonEmptyString(report.closedAt) ? 'frozen' : 'draft';

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
      out.on('end', () => resolve({ pdf: Buffer.concat(chunks), pageCount, mode }));

      out.addPage();
      drawReportCard(out, theme, report, { learnerName, mode });
      out.end();
    });
  };
}

// ── drawing ──────────────────────────────────────────────────────────────

function setFont(doc, theme, fontKey, sizePt, inkKey = 'text') {
  doc.font(theme.fonts[fontKey].name).fontSize(sizePt).fillColor(theme.ink[inkKey]);
  return doc;
}

function writeLine(doc, theme, str, {
  font = 'regular', sizePt = 11, ink = 'text', gapAfterPt = 4,
} = {}) {
  setFont(doc, theme, font, sizePt, ink);
  doc.text(str, { width: doc.page.width - 2 * theme.page.marginPt });
  doc.y += gapAfterPt;
}

function sectionHeading(doc, theme, title) {
  writeLine(doc, theme, title, {
    font: 'bold', sizePt: 13, ink: 'text', gapAfterPt: 6,
  });
}

function ruleAcross(doc, theme, { gapAbovePt = 8, gapBelowPt = 10, widthPt = 0.8 } = {}) {
  doc.y += gapAbovePt;
  const left = theme.page.marginPt;
  const right = theme.page.widthPt - theme.page.marginPt;
  doc.save().lineWidth(widthPt).strokeColor(theme.ink.rule)
    .moveTo(left, doc.y).lineTo(right, doc.y).stroke().restore();
  doc.y += gapBelowPt;
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${Math.round(value * 100) / 100}%`;
}

function formatTimestamp(iso) {
  return isNonEmptyString(iso) ? iso.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : '—';
}

function drawReportCard(doc, theme, report, { learnerName, mode }) {
  drawHeader(doc, theme, report, { learnerName, mode });
  ruleAcross(doc, theme);

  drawCourses(doc, theme, report.courses ?? []);
  drawMaterials(doc, theme, report.materials ?? []);
  drawActiveDays(doc, theme, report.activeDays);
  drawUnitOutcomes(doc, theme, report.courses ?? []);
  drawConcepts(doc, theme, report.concepts);
  drawRemediationArcs(doc, theme, report);
  drawFeedbackNotes(doc, theme, report.pendingReview);
}

function drawHeader(doc, theme, report, { learnerName, mode }) {
  writeLine(doc, theme, 'Report Card', {
    font: 'bold', sizePt: 20, ink: 'text', gapAfterPt: 4,
  });
  writeLine(doc, theme, mode === 'frozen' ? 'FROZEN' : 'DRAFT', {
    font: 'bold', sizePt: 12, ink: mode === 'frozen' ? 'text' : 'muted', gapAfterPt: 8,
  });

  const displayName = isNonEmptyString(learnerName) ? learnerName : (report.learnerId ?? '—');
  writeLine(doc, theme, `Learner: ${displayName}`, { sizePt: 11, gapAfterPt: 3 });

  const period = report.period ?? {};
  const periodLabel = isNonEmptyString(period.label) ? period.label : (period.periodId ?? '—');
  const periodRange = isNonEmptyString(period.startsAt) && isNonEmptyString(period.endsAt)
    ? ` (${period.startsAt.slice(0, 10)} – ${period.endsAt.slice(0, 10)})`
    : '';
  writeLine(doc, theme, `Period: ${periodLabel}${periodRange}`, { sizePt: 11, gapAfterPt: 3 });

  if (mode === 'frozen') {
    writeLine(
      doc,
      theme,
      `Closed: ${formatTimestamp(report.closedAt)} by ${report.closedBy ?? '—'}`,
      { sizePt: 11, gapAfterPt: 3 },
    );
  } else {
    writeLine(doc, theme, `Generated: ${formatTimestamp(report.generatedAt)}`, { sizePt: 11, gapAfterPt: 3 });
  }

  writeLine(
    doc,
    theme,
    `Course grading policy: ${report.courses?.[0]?.policy ?? COURSE_GRADE_POLICY} (best graded session per unit, averaged across attempted units)`,
    { sizePt: 8, ink: 'muted', gapAfterPt: 2 },
  );
}

function drawCourses(doc, theme, courses) {
  sectionHeading(doc, theme, 'Courses');
  if (courses.length === 0) {
    writeLine(doc, theme, 'No courses assigned or worked this period.', { ink: 'muted', gapAfterPt: 10 });
    return;
  }
  for (const course of courses) {
    const unitGrades = course.unitGrades ?? [];
    const attempted = unitGrades.filter((u) => (u.attempts ?? 0) > 0).length;
    const passed = unitGrades.filter((u) => u.passed === true).length;
    writeLine(
      doc,
      theme,
      `${course.courseId} — ${formatPercent(course.coursePercent)} (${passed} passed / ${attempted} attempted, ${unitGrades.length} units)`,
      { sizePt: 11, gapAfterPt: 4 },
    );
  }
  doc.y += 6;
}

function drawMaterials(doc, theme, materials) {
  sectionHeading(doc, theme, 'Materials');
  if (materials.length === 0) {
    writeLine(doc, theme, 'No materials-framework progress recorded this period.', { ink: 'muted', gapAfterPt: 10 });
    return;
  }
  for (const material of materials) {
    writeLine(
      doc,
      theme,
      `${material.label ?? material.materialId} — ${material.unitsDone ?? 0} / ${material.unitTotal ?? '—'} units`,
      { sizePt: 11, gapAfterPt: 4 },
    );
  }
  doc.y += 6;
}

function drawActiveDays(doc, theme, activeDays) {
  sectionHeading(doc, theme, 'Active instructional days');
  writeLine(
    doc,
    theme,
    'A proxy for instructional time — days with at least one recorded attempt, never attendance.',
    { sizePt: 9, ink: 'muted', gapAfterPt: 6 },
  );
  const bySubject = activeDays?.bySubject ?? [];
  if (bySubject.length === 0) {
    writeLine(doc, theme, 'No recorded activity this period.', { ink: 'muted', gapAfterPt: 4 });
  } else {
    for (const { subjectId, days } of bySubject) {
      writeLine(doc, theme, `${subjectId}: ${days} day${days === 1 ? '' : 's'}`, { sizePt: 11, gapAfterPt: 3 });
    }
  }
  writeLine(doc, theme, `Total: ${activeDays?.total ?? 0} day${(activeDays?.total ?? 0) === 1 ? '' : 's'}`, {
    font: 'bold', sizePt: 11, gapAfterPt: 10,
  });
}

/**
 * UNIT pass/fail, rolled up from `unitOutcomes[].result` across every course
 * — deliberately labelled at the grain this section actually has ("Units"),
 * distinct from the DISCRETE-CONCEPT grain `drawConcepts` below renders (Task
 * 10's `report.concepts` facet). Neither section subsumes the other: a
 * learner can pass a unit while still developing one of its concepts (or the
 * reverse), so both stay on the printed page.
 */
function drawUnitOutcomes(doc, theme, courses) {
  sectionHeading(doc, theme, 'Units — passed / needs remediation');
  const passed = [];
  const needsRemediation = [];
  for (const course of courses) {
    for (const outcome of course.unitOutcomes ?? []) {
      if (outcome.result === 'passed') passed.push(outcome.unitId);
      else if (outcome.result === 'needs_remediation') needsRemediation.push(outcome.unitId);
    }
  }
  writeLine(
    doc,
    theme,
    `Passed (${passed.length}): ${passed.length ? passed.join(', ') : '—'}`,
    { sizePt: 11, gapAfterPt: 4 },
  );
  writeLine(
    doc,
    theme,
    `Needs remediation (${needsRemediation.length}): ${needsRemediation.length ? needsRemediation.join(', ') : '—'}`,
    { sizePt: 11, gapAfterPt: 10 },
  );
}

/**
 * DISCRETE-CONCEPT mastery (Task 10's `report.concepts`, `{mastered,
 * developing}` from `conceptMastery`), rendered only when there is something
 * to say — a report predating Task 10, or one with no wired/empty concept
 * registry, has `concepts` absent or both lists empty, and this section is
 * skipped entirely rather than printing a hollow "Concepts" heading with
 * nothing under it.
 */
function drawConcepts(doc, theme, concepts) {
  const mastered = concepts?.mastered ?? [];
  const developing = concepts?.developing ?? [];
  if (mastered.length === 0 && developing.length === 0) return;
  sectionHeading(doc, theme, 'Concepts — mastered / developing');
  const describe = (row) => `${row.label} (${formatPercent(row.ratio * 100)}, ${row.responses} response${row.responses === 1 ? '' : 's'})`;
  writeLine(
    doc,
    theme,
    `Mastered (${mastered.length}): ${mastered.length ? mastered.map(describe).join('; ') : '—'}`,
    { sizePt: 11, gapAfterPt: 4 },
  );
  writeLine(
    doc,
    theme,
    `Developing (${developing.length}): ${developing.length ? developing.map(describe).join('; ') : '—'}`,
    { sizePt: 11, gapAfterPt: 10 },
  );
}

function drawRemediationArcs(doc, theme, report) {
  sectionHeading(doc, theme, 'Remediation');
  const arcs = report.remediationArcs ?? [];
  if (arcs.length === 0) {
    writeLine(doc, theme, 'No remediation arcs this period.', { ink: 'muted', gapAfterPt: 10 });
    return;
  }
  // {unitId -> best in-period gradedPercent}, so an arc's "after" score can be
  // shown even though the arc record itself carries no percent (see module
  // comment for why).
  const unitPercent = new Map();
  for (const course of report.courses ?? []) {
    for (const outcome of course.unitOutcomes ?? []) {
      if (outcome.gradedPercent !== null && outcome.gradedPercent !== undefined) {
        unitPercent.set(outcome.unitId, outcome.gradedPercent);
      }
    }
  }
  for (const arc of arcs) {
    const after = unitPercent.has(arc.unitId) ? formatPercent(unitPercent.get(arc.unitId)) : (arc.result ?? '—');
    writeLine(doc, theme, `Unit ${arc.unitId}: needs remediation → tutored → ${after}`, {
      sizePt: 11, gapAfterPt: 4,
    });
  }
  doc.y += 6;
}

// Honest framing (not "Feedback"): this count is the review-queue BACKLOG at
// render time — items nobody has graded yet — not feedback a grown-up gave.
// One phrasing covers both draft (a live, still-growing backlog) and frozen
// (the backlog as it stood at close) without needing `mode` threaded in.
function drawFeedbackNotes(doc, theme, pendingReview) {
  sectionHeading(doc, theme, 'Feedback');
  writeLine(doc, theme, `Items awaiting review: ${pendingReview ?? 0}`, { sizePt: 11, gapAfterPt: 4 });
}

export default createReportCardPdfRenderer;
