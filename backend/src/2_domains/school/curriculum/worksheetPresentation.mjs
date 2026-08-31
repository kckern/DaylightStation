/**
 * Presentation facts for a bank-backed worksheet lesson card.
 *
 * A course may cite the curriculum that sets its pace while each unit cites
 * the printed text the learner actually opens. Those roles must never be
 * collapsed: `work.source.title` is not a worksheet reading source.
 */
import { compactCourseModuleLabel } from './display.mjs';
import { formatPageSpans } from '../questionBankV2.mjs';

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

function printableSource(value) {
  const label = text(value);
  if (!label) return null;
  const cleaned = label.replace(/\s+\b(?:EPUB|PDF|MOBI|HTML)\b/giu, '').trim();
  return cleaned && !/\.(?:epub|mobi|html?)\b/iu.test(cleaned) ? cleaned : null;
}

function explicitReading(value) {
  const reading = text(value);
  if (!reading || /\bassigned section\b|\b(?:EPUB|MOBI|HTML)\b|\.(?:epub|mobi|html?)\b/iu.test(reading)) {
    return null;
  }
  return /^read\s*:/iu.test(reading) ? reading : `Read: ${reading}`;
}

function referenceLine(references) {
  if (!Array.isArray(references) || !references.length) return null;
  return references.map((reference, index) => {
    const label = index === 0 ? 'Reference if needed:' : 'Also:';
    const pages = formatPageSpans(reference.pages);
    const pageLabel = reference.pages.length === 1 ? 'p.' : 'pp.';
    return `${label} ${reference.title}, ${pageLabel} ${pages} — ${reference.section}.`;
  }).join(' ');
}

export function worksheetPresentation({ unit = null, work = null, enrollment = null } = {}) {
  const printedPages = Array.isArray(unit?.provenance?.printed_pages)
    ? [...unit.provenance.printed_pages]
    : [];
  // The course reader title is learner-facing copy; unit provenance may keep
  // a fuller bibliographic edition for audit and source verification.
  const sourceTitle = printableSource(unit?.sourceTitle)
    ?? printableSource(work?.source?.reader?.title)
    ?? printableSource(unit?.provenance?.source);
  const studyReferenceLine = referenceLine(unit?.studyReferences);
  return {
    breadcrumb: compactCourseModuleLabel({
      work, enrollment, moduleId: unit?.module,
      fallbackCourse: unit?.courseTitle ?? unit?.courseId ?? 'Course',
      fallbackModule: unit?.module ?? unit?.title ?? 'Unit',
    }),
    sourceTitle,
    // When page locators exist, the document builder combines them with the
    // resolved printed source. An explicit prose instruction is only the
    // fallback for lessons with no page-locator contract.
    reading: studyReferenceLine ?? (printedPages.length ? null : explicitReading(unit?.reading)),
    printedPages,
    citation: text(unit?.description),
  };
}

export default worksheetPresentation;
